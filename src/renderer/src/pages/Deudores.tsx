import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import { calcularMontoAcciones, calcularMultas, calcularTotal, formatCLP } from '../lib/formulas'
import { exportDeudores } from '../lib/export'
import type { Temporada, AccionistaType } from '../../../shared/types'

interface DeudorRow {
  id: number
  nombre: string
  tipo: AccionistaType
  acciones: number
  hectareas: number
  numeros: string | null
  temporadas_adeudadas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total_abonado: number
}

const TIPO_LABELS: Record<AccionistaType, string> = {
  PARCELA: 'Parcela', SITIO: 'Sitio', 'PEQUEÑO_PROPIETARIO': 'Pequeño Propietario'
}

export default function Deudores() {
  const navigate = useNavigate()
  const [temporada, setTemporada] = useState<Temporada | null>(null)
  const [rows, setRows] = useState<DeudorRow[]>([])
  const [filterTipo, setFilterTipo] = useState<AccionistaType | ''>('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState<number | null>(null)

  const load = async () => {
    const t = await api.temporadas.getActive()
    setTemporada(t)
    if (t) {
      const data = await api.deudores.list(t.id)
      setRows(data)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter(r =>
      (!filterTipo || r.tipo === filterTipo) &&
      (!q || r.nombre.toLowerCase().includes(q))
    )
  }, [rows, search, filterTipo])

  const computedRows = useMemo(() => {
    if (!temporada) return []
    return filtered.map(r => {
      const monto  = calcularMontoAcciones(temporada.valor_accion, r.acciones, r.hectareas, r.temporadas_adeudadas)
      const multas = calcularMultas(r.acciones, r.hectareas, r.temporadas_adeudadas)
      const total  = calcularTotal(monto, multas, r.cuota_extraordinaria, r.otros_ingresos)
      const restante = Math.max(0, total - r.total_abonado)
      return { ...r, monto_adeudado: monto, multas, total, restante }
    }).filter(r => r.restante > 0)   // hide fully covered rows
  }, [filtered, temporada])

  const grandTotal = computedRows.reduce((s, r) => s + r.restante, 0)

  const updateRow = (id: number, patch: Partial<DeudorRow>) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  const saveConfig = async (row: DeudorRow) => {
    if (!temporada) return
    setSaving(row.id)
    await api.deudores.upsertConfig({
      accionista_id: row.id,
      temporada_id: temporada.id,
      temporadas_adeudadas: row.temporadas_adeudadas,
      cuota_extraordinaria: row.cuota_extraordinaria,
      otros_ingresos: row.otros_ingresos
    })
    setSaving(null)
  }

  if (!temporada) {
    return <p className="text-gray-400 p-8 text-sm">No hay temporada activa.</p>
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deudores</h1>
          <p className="text-sm text-gray-500">Temporada {temporada.nombre} · {computedRows.length} pendientes</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => exportDeudores(computedRows as any, temporada)}>
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <input className="input max-w-xs" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input max-w-[200px]" value={filterTipo} onChange={e => setFilterTipo(e.target.value as any)}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-sm text-gray-500 ml-auto">Total pendiente: <strong>{formatCLP(grandTotal)}</strong></span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="table-header">
              <th className="px-3 py-2 text-left">Accionista</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-right">Acciones</th>
              <th className="px-3 py-2 text-right">Hectáreas</th>
              <th className="px-3 py-2 text-right">N° Temp.</th>
              <th className="px-3 py-2 text-right">Total Deuda</th>
              <th className="px-3 py-2 text-right">Abonado</th>
              <th className="px-3 py-2 text-right">Pendiente</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {computedRows.map((r) => {
              const row = rows.find(x => x.id === r.id)!
              return (
                <tr key={r.id} className="table-row">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.nombre}</div>
                    {r.numeros && <div className="text-xs text-gray-400">N° {r.numeros}</div>}
                  </td>
                  <td className="px-3 py-2"><span className="badge-blue">{TIPO_LABELS[r.tipo]}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.acciones > 0 ? r.acciones : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.hectareas > 0 ? r.hectareas : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number" min={1} className="input w-16 text-center py-0.5"
                      value={row.temporadas_adeudadas}
                      onChange={e => updateRow(r.id, { temporadas_adeudadas: Number(e.target.value) })}
                      onBlur={() => saveConfig(row)}
                      title={saving === r.id ? 'Guardando…' : ''}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatCLP(r.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.total_abonado > 0
                      ? <span className="text-canal-600">{formatCLP(r.total_abonado)}</span>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700">
                    {formatCLP(r.restante)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        className="btn-secondary btn-sm text-xs"
                        onClick={() => navigate(`/pagos/nuevo?accionista=${r.id}&mode=abono`)}
                        title="Registrar abono parcial"
                      >
                        Abonar
                      </button>
                      <button
                        className="btn-primary btn-sm text-xs"
                        onClick={() => navigate(`/pagos/nuevo?accionista=${r.id}`)}
                        title="Pago completo"
                      >
                        Pagar
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {computedRows.length === 0 && (
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
