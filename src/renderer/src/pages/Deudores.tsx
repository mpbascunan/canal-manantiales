import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import { formatCLP, formatNumber } from '../lib/formulas'
import { exportDeudores } from '../lib/export'
import type { Temporada } from '../../../shared/types'
import type { DeudaPorTemporada } from '../../../shared/deuda'

interface DeudorRow {
  id: number
  nombre: string
  acciones: number
  hectareas: number
  nombres_propiedades: string | null
  /** Every temporada, not just the active one (D13). */
  deuda: DeudaPorTemporada
}

/** Which temporadas the table is showing: one of them, or the lot. */
type Seleccion = number | 'todas'

const TODAS = 'todas' as const

/**
 * One row's debt reduced to the temporada in scope.
 *
 * The engine always computes every temporada (D13) because abonos are allocated
 * oldest-debt-first and a season's figures are only knowable once the older ones
 * have drawn from the pot. Narrowing to one season is therefore a *view* over
 * that result, never a separate calculation.
 */
interface VistaDeuda {
  temporadas: number
  cuotas: number
  cargos: number
  multas: number
  abonado: number
  pendiente: number
  /** Pre-app debt (D14) belongs to no temporada, so only "todas" counts it. */
  deudaInicial: number
  /** Cuota and multa settled; what is left is cargos and/or old debt. */
  soloExtras: boolean
}

function vistaDe(d: DeudaPorTemporada, seleccion: Seleccion): VistaDeuda {
  if (seleccion === TODAS) {
    return {
      temporadas: d.temporadas.filter(t => t.pendiente > 0).length,
      cuotas: d.total_cuotas,
      cargos: d.total_cargos,
      multas: d.total_multas,
      abonado: d.total_abonado,
      pendiente: d.total_pendiente,
      deudaInicial: d.total_deuda_inicial,
      soloExtras:
        d.temporadas.every(t => t.pendiente_cuota === 0 && t.pendiente_multa === 0) &&
        d.total_pendiente > 0
    }
  }

  const t = d.temporadas.find(x => x.temporada_id === seleccion)
  if (!t) {
    return {
      temporadas: 0, cuotas: 0, cargos: 0, multas: 0,
      abonado: 0, pendiente: 0, deudaInicial: 0, soloExtras: false
    }
  }
  return {
    temporadas: t.pendiente > 0 ? 1 : 0,
    cuotas: t.cuota,
    cargos: t.total_cargos,
    multas: t.multa,
    abonado: t.abonado + t.cargos.reduce((s, c) => s + c.abonado, 0) + t.multa_abonada,
    pendiente: t.pendiente,
    deudaInicial: 0,
    soloExtras: t.pendiente_cuota === 0 && t.pendiente_multa === 0 && t.pendiente > 0
  }
}

export default function Deudores() {
  const navigate = useNavigate()
  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null)
  const [rows, setRows] = useState<DeudorRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    setLoading(true)
    const [ts, activa, data] = await Promise.all([
      api.temporadas.list(),
      api.temporadas.getActive(),
      api.deudores.listDeuda()
    ])
    setTemporadas(ts)
    // The active temporada is what the administration is collecting right now,
    // so it is the default scope rather than every season ever.
    setSeleccion(activa ? activa.id : TODAS)
    setRows(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  /** Rows with their debt already narrowed to the selection, still owing something. */
  const filtered = useMemo(() => {
    if (seleccion === null) return []
    const q = search.toLowerCase()
    return rows
      .map(r => ({ ...r, vista: vistaDe(r.deuda, seleccion) }))
      .filter(r => r.vista.pendiente > 0)
      .filter(r => !q || r.nombre.toLowerCase().includes(q))
  }, [rows, search, seleccion])

  const grandTotal = filtered.reduce((s, r) => s + r.vista.pendiente, 0)

  const periodo = seleccion === TODAS || seleccion === null
    ? 'Todas las temporadas'
    : temporadas.find(t => t.id === seleccion)?.nombre ?? ''

  /**
   * The debt detail lives on the accionista page, which already breaks the debt
   * down temporada by temporada — `from` lets it send the user back here.
   */
  const verDetalle = (accionistaId: number): void => {
    navigate(`/accionistas/${accionistaId}`, { state: { from: '/deudores' } })
  }

  const handleExport = (): void => {
    exportDeudores(
      filtered.map(r => ({
        nombre: r.nombre,
        nombres_propiedades: r.nombres_propiedades,
        acciones: r.acciones,
        hectareas: r.hectareas,
        temporadas: r.vista.temporadas,
        cuotas: r.vista.cuotas,
        cargos: r.vista.cargos,
        multas: r.vista.multas,
        abonado: r.vista.abonado,
        pendiente: r.vista.pendiente
      })),
      periodo
    )
  }

  if (loading) return <p className="text-gray-400 p-8 text-sm">Cargando…</p>
  if (temporadas.length === 0) return <p className="text-gray-400 p-8 text-sm">No hay temporadas registradas.</p>

  const verTodas = seleccion === TODAS

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deudores</h1>
          <p className="text-sm text-gray-500">
            {verTodas ? 'Todas las temporadas' : `Temporada ${periodo}`} · {filtered.length} pendientes
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={handleExport}>
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <input className="input max-w-xs" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
        <select
          className="input max-w-[220px]"
          value={seleccion === TODAS ? TODAS : String(seleccion)}
          onChange={e => setSeleccion(e.target.value === TODAS ? TODAS : Number(e.target.value))}
        >
          {temporadas.map(t => (
            <option key={t.id} value={String(t.id)}>Temporada {t.nombre}</option>
          ))}
          <option value={TODAS}>Todas las temporadas</option>
        </select>
        <span className="text-xs text-gray-400">Haz clic en un accionista para ver el detalle</span>
        <span className="text-sm text-gray-500 ml-auto">
          Total pendiente: <strong>{formatCLP(grandTotal)}</strong>
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header whitespace-nowrap">
              <th className="px-3 py-2 text-left">Accionista</th>
              <th className="px-3 py-2 text-right">Acciones</th>
              <th className="px-3 py-2 text-right">Hectáreas</th>
              {/* Always 1 when a single temporada is in scope, so it only earns
                  its column when every season is shown. */}
              {verTodas && <th className="px-3 py-2 text-right">N° Temp.</th>}
              <th className="px-3 py-2 text-right">Cuotas</th>
              <th className="px-3 py-2 text-right">Multas</th>
              <th className="px-3 py-2 text-right">Abonado</th>
              <th className="px-3 py-2 text-right">Pendiente</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const v = r.vista
              return (
                <tr
                  key={r.id}
                  className="table-row cursor-pointer"
                  onClick={() => verDetalle(r.id)}
                  title="Ver detalle de la deuda"
                >
                  {/* The propiedades list is one nowrap line per shareholder and some
                      own a dozen — it is truncated so it cannot push the money
                      columns off the right edge of the card. */}
                  <td className="px-3 py-2 max-w-[20rem]">
                    <div className="font-medium truncate">{r.nombre}</div>
                    {r.nombres_propiedades && (
                      <div className="text-xs text-gray-400 truncate" title={r.nombres_propiedades}>
                        {r.nombres_propiedades}
                      </div>
                    )}
                    {v.soloExtras && (
                      <span className="text-xs text-indigo-600 font-medium">Cuota pagada</span>
                    )}
                    {v.deudaInicial > 0 && (
                      <span className="text-xs text-gray-400 block">Incluye deuda anterior</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatNumber(r.acciones)}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatNumber(r.hectareas)}</td>
                  {verTodas && (
                    <td className="px-3 py-2 text-right tabular-nums">{v.temporadas || '—'}</td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">
                    {v.cuotas > 0 ? formatCLP(v.cuotas) : '—'}
                    {v.cargos > 0 && (
                      <div className="text-xs text-indigo-500">+ {formatCLP(v.cargos)} cargos</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-600 whitespace-nowrap">
                    {v.multas > 0 ? formatCLP(v.multas) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {v.abonado > 0
                      ? <span className="text-canal-600">{formatCLP(v.abonado)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700 whitespace-nowrap">
                    {formatCLP(v.pendiente)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end whitespace-nowrap">
                      <button
                        className="btn-secondary btn-sm text-xs"
                        onClick={e => { e.stopPropagation(); navigate(`/pagos/nuevo?accionista=${r.id}&mode=abono`) }}
                        title="Registrar abono"
                      >
                        Abonar
                      </button>
                      {!v.soloExtras && (
                        <button
                          className="btn-primary btn-sm text-xs"
                          onClick={e => { e.stopPropagation(); navigate(`/pagos/nuevo?accionista=${r.id}`) }}
                          title="Pago completo"
                        >
                          Pagar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={verTodas ? 9 : 8} className="px-4 py-8 text-center text-gray-400">
                {rows.length === 0
                  ? '¡Todos los accionistas han pagado!'
                  : search
                    ? 'Sin resultados'
                    : `Sin deudores en ${verTodas ? 'ninguna temporada' : `la temporada ${periodo}`}.`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
