import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import { formatCLP } from '../lib/formulas'
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

export default function Deudores() {
  const navigate = useNavigate()
  const [temporada, setTemporada] = useState<Temporada | null>(null)
  const [rows, setRows] = useState<DeudorRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    setLoading(true)
    const [t, data] = await Promise.all([
      api.temporadas.getActive(),
      api.deudores.listDeuda()
    ])
    setTemporada(t)
    setRows(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter(r => !q || r.nombre.toLowerCase().includes(q))
  }, [rows, search])

  const grandTotal = filtered.reduce((s, r) => s + r.deuda.total_pendiente, 0)

  /** Temporadas actually owing something, for the "N° temp." column. */
  const temporadasConDeuda = (d: DeudaPorTemporada): number =>
    d.temporadas.filter(t => t.pendiente > 0).length

  /** Only the cuota is settled; what remains is cargos and/or old debt. */
  const soloExtras = (d: DeudaPorTemporada): boolean =>
    d.temporadas.every(t => t.pendiente_cuota === 0 && t.pendiente_multa === 0) &&
    d.total_pendiente > 0

  if (loading) return <p className="text-gray-400 p-8 text-sm">Cargando…</p>
  if (!temporada) return <p className="text-gray-400 p-8 text-sm">No hay temporada activa.</p>

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deudores</h1>
          <p className="text-sm text-gray-500">
            Temporada {temporada.nombre} · {filtered.length} pendientes
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => exportDeudores(filtered as any, temporada)}>
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <input className="input max-w-xs" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
        <span className="text-sm text-gray-500 ml-auto">
          Total pendiente: <strong>{formatCLP(grandTotal)}</strong>
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="table-header">
              <th className="px-3 py-2 text-left">Accionista</th>
              <th className="px-3 py-2 text-right">Acciones</th>
              <th className="px-3 py-2 text-right">Hectáreas</th>
              <th className="px-3 py-2 text-right">N° Temp.</th>
              <th className="px-3 py-2 text-right">Cuotas</th>
              <th className="px-3 py-2 text-right">Multas</th>
              <th className="px-3 py-2 text-right">Abonado</th>
              <th className="px-3 py-2 text-right">Pendiente</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const d = r.deuda
              return (
                <tr key={r.id} className="table-row">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.nombre}</div>
                    {r.nombres_propiedades && <div className="text-xs text-gray-400">{r.nombres_propiedades}</div>}
                    {soloExtras(d) && (
                      <span className="text-xs text-indigo-600 font-medium">Cuota pagada</span>
                    )}
                    {d.total_deuda_inicial > 0 && (
                      <span className="text-xs text-gray-400 block">Incluye deuda anterior</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.acciones > 0 ? r.acciones : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hectareas > 0 ? r.hectareas : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{temporadasConDeuda(d) || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {d.total_cuotas > 0 ? formatCLP(d.total_cuotas) : '—'}
                    {d.total_cargos > 0 && (
                      <div className="text-xs text-indigo-500">+ {formatCLP(d.total_cargos)} cargos</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-600">
                    {d.total_multas > 0 ? formatCLP(d.total_multas) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.total_abonado > 0
                      ? <span className="text-canal-600">{formatCLP(d.total_abonado)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700">
                    {formatCLP(d.total_pendiente)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        className="btn-secondary btn-sm text-xs"
                        onClick={() => navigate(`/pagos/nuevo?accionista=${r.id}&mode=abono`)}
                        title="Registrar abono"
                      >
                        Abonar
                      </button>
                      {!soloExtras(d) && (
                        <button
                          className="btn-primary btn-sm text-xs"
                          onClick={() => navigate(`/pagos/nuevo?accionista=${r.id}`)}
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
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                {rows.length === 0 ? '¡Todos los accionistas han pagado!' : 'Sin resultados'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
