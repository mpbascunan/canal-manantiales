import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import { calcularMontoAcciones, calcularMultas, calcularTotal } from '../lib/formulas'
import type { Accionista, AccionistaType, PropiedadInput, Temporada } from '../../../shared/types'

const TIPO_LABELS: Record<AccionistaType, string> = {
  PARCELA: 'Parcela',
  SITIO: 'Sitio',
  'PEQUEÑO_PROPIETARIO': 'Pequeño Prop.'
}

interface EditForm {
  id?: number
  nombre: string
  activo: boolean
  notas: string
  propiedades: PropiedadInput[]
}

const EMPTY_FORM: EditForm = {
  nombre: '',
  activo: true,
  notas: '',
  propiedades: [{ numero: '', tipo: 'PARCELA', acciones: 0, hectareas: 0 }]
}

function formatNum(n: number): string {
  return n > 0 ? n.toLocaleString('es-CL', { maximumFractionDigits: 4 }) : '—'
}

type AccionistaConStatus = Accionista & {
  pago_temporada_activa?: number
  total_abonado?: number
  dc_temporadas_adeudadas?: number
  dc_cuota_extraordinaria?: number
  dc_otros_ingresos?: number
}

export default function Accionistas() {
  const [list, setList] = useState<AccionistaConStatus[]>([])
  const [activeTemporada, setActiveTemporada] = useState<Temporada | null>(null)
  const [search, setSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState<AccionistaType | ''>('')
  const [editing, setEditing] = useState<EditForm | null>(null)
  const [isNew, setIsNew] = useState(false)
  const navigate = useNavigate()

  const load = async () => {
    const temporada = await api.temporadas.getActive()
    setActiveTemporada(temporada ?? null)
    if (temporada) {
      const data = await api.accionistas.withPagoStatus(temporada.id)
      setList(data)
    } else {
      const data = await api.accionistas.list()
      setList(data)
    }
  }

  // Compute 3-state payment status for an accionista row
  const pagoStatus = (a: AccionistaConStatus): 'pagado' | 'cubierto' | 'pendiente' => {
    if (a.pago_temporada_activa) return 'pagado'
    if (!activeTemporada || !a.total_abonado || a.total_abonado <= 0) return 'pendiente'
    const adeudadas = a.dc_temporadas_adeudadas ?? 1
    if (adeudadas <= 0) return 'pendiente'
    const totalDebt = calcularTotal(
      calcularMontoAcciones(activeTemporada.valor_accion, a.acciones, a.hectareas, adeudadas),
      calcularMultas(a.acciones, a.hectareas, adeudadas),
      a.dc_cuota_extraordinaria ?? 0,
      a.dc_otros_ingresos ?? 0
    )
    return a.total_abonado >= totalDebt ? 'cubierto' : 'pendiente'
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return list.filter(a =>
      (!filterTipo || a.tipo === filterTipo) &&
      (!q || a.nombre.toLowerCase().includes(q) || (a.numeros ?? a.numero ?? '').toLowerCase().includes(q))
    )
  }, [list, search, filterTipo])

  const openNew = () => {
    setEditing({ ...EMPTY_FORM, propiedades: [{ numero: '', tipo: 'PARCELA', acciones: 0, hectareas: 0 }] })
    setIsNew(true)
  }

  const openEdit = async (a: Accionista) => {
    const props = await api.propiedades.list(a.id)
    const propiedades: PropiedadInput[] = props.length > 0
      ? props.map((p: any) => ({ id: p.id, numero: p.numero ?? '', tipo: p.tipo, acciones: p.acciones, hectareas: p.hectareas }))
      : [{ numero: a.numero ?? '', tipo: a.tipo, acciones: a.acciones, hectareas: a.hectareas }]
    setEditing({ id: a.id, nombre: a.nombre, activo: a.activo, notas: a.notas ?? '', propiedades })
    setIsNew(false)
  }

  const save = async () => {
    if (!editing) return
    const payload = {
      id: editing.id,
      nombre: editing.nombre,
      activo: editing.activo,
      notas: editing.notas || null,
      propiedades: editing.propiedades.map(p => ({
        ...p,
        numero: p.numero || null
      }))
    }
    if (isNew) await api.accionistas.create(payload)
    else await api.accionistas.update(payload)
    setEditing(null)
    load()
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accionistas</h1>
        <button className="btn-primary" onClick={openNew}>+ Nuevo accionista</button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          className="input max-w-xs"
          placeholder="Buscar por nombre o N°..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input max-w-[200px]" value={filterTipo} onChange={e => setFilterTipo(e.target.value as any)}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-sm text-gray-500 self-center">{filtered.length} accionistas</span>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-2 text-left">N°</th>
              <th className="px-4 py-2 text-left">Nombre</th>
              <th className="px-4 py-2 text-left">Tipo</th>
              <th className="px-4 py-2 text-right">Acciones</th>
              <th className="px-4 py-2 text-right">Hectáreas</th>
              <th className="px-4 py-2 text-center">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id} className="table-row cursor-pointer" onClick={() => navigate(`/accionistas/${a.id}`)}>
                <td className="px-4 py-2 text-gray-500 text-xs max-w-[120px] truncate" title={a.numeros ?? a.numero ?? ''}>
                  {a.numeros ?? a.numero ?? '—'}
                </td>
                <td className="px-4 py-2 font-medium">{a.nombre}</td>
                <td className="px-4 py-2">
                  <span className="badge-blue text-xs">{TIPO_LABELS[a.tipo]}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNum(a.acciones)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatNum(a.hectareas)}</td>
                <td className="px-4 py-2 text-center">
                  {(() => {
                    const s = pagoStatus(a)
                    if (s === 'pagado')   return <span className="badge-green">Pagado</span>
                    if (s === 'cubierto') return <span className="inline-block px-2 py-0.5 text-xs font-medium bg-canal-100 text-canal-700 rounded-full">Cubierto</span>
                    return <span className="badge-yellow">Pendiente</span>
                  })()}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={e => { e.stopPropagation(); openEdit(a) }}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <AccionistaModal
          value={editing}
          isNew={isNew}
          onChange={setEditing}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function AccionistaModal({ value, isNew, onChange, onSave, onClose }: {
  value: EditForm
  isNew: boolean
  onChange: (f: EditForm) => void
  onSave: () => void
  onClose: () => void
}) {
  const set = (patch: Partial<EditForm>) => onChange({ ...value, ...patch })

  const setPropiedad = (i: number, patch: Partial<PropiedadInput>) => {
    const props = value.propiedades.map((p, j) => j === i ? { ...p, ...patch } : p)
    set({ propiedades: props })
  }

  const addPropiedad = () => {
    const lastTipo = value.propiedades[value.propiedades.length - 1]?.tipo ?? 'PARCELA'
    set({ propiedades: [...value.propiedades, { numero: '', tipo: lastTipo, acciones: 0, hectareas: 0 }] })
  }

  const removePropiedad = (i: number) => {
    set({ propiedades: value.propiedades.filter((_, j) => j !== i) })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{isNew ? 'Nuevo accionista' : 'Editar accionista'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="space-y-4">
          {/* Basic info */}
          <div>
            <label className="label">Nombre completo</label>
            <input className="input" value={value.nombre} onChange={e => set({ nombre: e.target.value })} />
          </div>
          <div>
            <label className="label">Notas</label>
            <textarea className="input" rows={2} value={value.notas} onChange={e => set({ notas: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.activo} onChange={e => set({ activo: e.target.checked })} />
            Activo
          </label>

          {/* Propiedades */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Propiedades (parcelas / sitios)</label>
              <button type="button" className="text-xs text-canal-600 hover:underline" onClick={addPropiedad}>
                + Agregar propiedad
              </button>
            </div>

            {value.propiedades.length === 0 && (
              <p className="text-xs text-gray-400 mb-2">Sin propiedades. Agrega al menos una.</p>
            )}

            <div className="space-y-2">
              {value.propiedades.map((p, i) => (
                <div key={i} className="flex gap-2 items-center bg-gray-50 rounded p-2">
                  <input
                    className="input w-20 text-sm"
                    placeholder="N°"
                    value={p.numero ?? ''}
                    onChange={e => setPropiedad(i, { numero: e.target.value })}
                    title="Número de parcela/sitio"
                  />
                  <select
                    className="input flex-1 text-sm"
                    value={p.tipo}
                    onChange={e => setPropiedad(i, { tipo: e.target.value as AccionistaType })}
                  >
                    <option value="PARCELA">Parcela</option>
                    <option value="SITIO">Sitio</option>
                    <option value="PEQUEÑO_PROPIETARIO">Pequeño Propietario</option>
                  </select>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" step="0.0001" min="0"
                      className="input w-24 text-sm text-right"
                      placeholder="Acc."
                      value={p.acciones}
                      onChange={e => setPropiedad(i, { acciones: Number(e.target.value) })}
                      title="Acciones"
                    />
                    <span className="text-xs text-gray-400">acc</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" step="0.0001" min="0"
                      className="input w-24 text-sm text-right"
                      placeholder="Hect."
                      value={p.hectareas}
                      onChange={e => setPropiedad(i, { hectareas: Number(e.target.value) })}
                      title="Hectáreas"
                    />
                    <span className="text-xs text-gray-400">ha</span>
                  </div>
                  {value.propiedades.length > 1 && (
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-600 text-lg leading-none ml-1"
                      onClick={() => removePropiedad(i)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {value.propiedades.length > 1 && (
              <p className="text-xs text-gray-400 mt-1">
                Total: {value.propiedades.reduce((s, p) => s + p.acciones, 0).toLocaleString('es-CL', { maximumFractionDigits: 4 })} acc &nbsp;·&nbsp;
                {value.propiedades.reduce((s, p) => s + p.hectareas, 0).toLocaleString('es-CL', { maximumFractionDigits: 4 })} ha
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={onSave}>Guardar</button>
        </div>
      </div>
    </div>
  )
}
