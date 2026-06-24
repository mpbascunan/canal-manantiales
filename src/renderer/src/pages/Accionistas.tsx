import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import { calcularMontoAcciones, calcularMultas, calcularTotal } from '../lib/formulas'
import type { Accionista, AccionistaType, Temporada } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'
import { AccionistaModal, type AccionistaEditForm } from '../components/AccionistaModal'

const TIPO_LABELS: Record<AccionistaType, string> = {
  PARCELA: 'Parcela',
  SITIO: 'Sitio',
  'PEQUEÑO_PROPIETARIO': 'Pequeño Prop.'
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
  const [editing, setEditing] = useState<AccionistaEditForm | null>(null)
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

  const pagoStatus = (a: AccionistaConStatus): 'pagado' | 'cubierto' | 'pendiente' => {
    if (a.pago_temporada_activa) return 'pagado'
    if (!activeTemporada || !a.total_abonado || a.total_abonado <= 0) return 'pendiente'
    const adeudadas = a.dc_temporadas_adeudadas ?? 1
    if (adeudadas <= 0) return 'pendiente'
    const totalDebt = calcularTotal(
      calcularMontoAcciones(activeTemporada.valor_accion, a.acciones, a.hectareas, adeudadas),
      calcularMultas(a.acciones, a.hectareas, adeudadas, activeTemporada.monto_multa_por_accion),
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
      (!q || nombreCompleto(a).toLowerCase().includes(q) || (a.numeros ?? a.numero ?? '').toLowerCase().includes(q))
    )
  }, [list, search, filterTipo])

  const openNew = () => {
    setEditing({
      nombre: '', apellido_paterno: '', apellido_materno: '', numero_socio: '',
      activo: true, notas: '',
      propiedades: [{ numero: '', tipo: 'PARCELA', acciones: 0, hectareas: 0, direccion: '', sector: '', comuna: '', marco: '' }]
    })
    setIsNew(true)
  }

  const openEdit = async (a: Accionista) => {
    const props = await api.propiedades.list(a.id)
    const propiedades = props.length > 0
      ? props.map((p: any) => ({
          id: p.id, numero: p.numero ?? '', tipo: p.tipo,
          acciones: p.acciones, hectareas: p.hectareas,
          direccion: p.direccion ?? '', sector: p.sector ?? '',
          comuna: p.comuna ?? '', marco: p.marco ?? ''
        }))
      : [{ numero: a.numero ?? '', tipo: a.tipo, acciones: a.acciones, hectareas: a.hectareas, direccion: '', sector: '', comuna: '', marco: '' }]
    setEditing({
      id: a.id, nombre: a.nombre,
      apellido_paterno: a.apellido_paterno ?? '', apellido_materno: a.apellido_materno ?? '',
      numero_socio: a.numero_socio ?? '', activo: a.activo, notas: a.notas ?? '', propiedades
    })
    setIsNew(false)
  }

  const save = async () => {
    if (!editing) return
    const payload = {
      id: editing.id, nombre: editing.nombre,
      apellido_paterno: editing.apellido_paterno || null,
      apellido_materno: editing.apellido_materno || null,
      numero_socio: editing.numero_socio || null,
      activo: editing.activo, notas: editing.notas || null,
      propiedades: editing.propiedades.map(p => ({
        ...p, numero: p.numero || null, direccion: p.direccion || null,
        sector: p.sector || null, comuna: p.comuna || null, marco: p.marco || null
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
                <td className="px-4 py-2 font-medium">{nombreCompleto(a)}</td>
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
