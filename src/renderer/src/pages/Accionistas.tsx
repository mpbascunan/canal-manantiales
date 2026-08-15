import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import { calcularMontoAcciones, calcularMultas, calcularTotal } from '../lib/formulas'
import type { Accionista, Temporada } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'
import { AccionistaModal, type AccionistaEditForm } from '../components/AccionistaModal'

function formatNum(n: number): string {
  return n > 0 ? n.toLocaleString('es-CL', { maximumFractionDigits: 4 }) : '—'
}

type AccionistaConStatus = Accionista & {
  pago_temporada_activa?: number
  has_unpaid_cargos?: number
  total_abonado?: number
  dc_temporadas_adeudadas?: number
}

export default function Accionistas() {
  const [list, setList] = useState<AccionistaConStatus[]>([])
  const [activeTemporada, setActiveTemporada] = useState<Temporada | null>(null)
  const [search, setSearch] = useState('')
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
    if (a.pago_temporada_activa && !a.has_unpaid_cargos) return 'pagado'
    if (a.pago_temporada_activa && a.has_unpaid_cargos) return 'pendiente'
    if (!activeTemporada || !a.total_abonado || a.total_abonado <= 0) return 'pendiente'
    const adeudadas = a.dc_temporadas_adeudadas ?? 1
    if (adeudadas <= 0) return 'pendiente'
    const totalDebt = calcularTotal(
      calcularMontoAcciones(activeTemporada.valor_accion, a.acciones, a.hectareas, adeudadas),
      calcularMultas(a.acciones, a.hectareas, adeudadas, activeTemporada.monto_multa_por_accion)
    )
    return a.total_abonado >= totalDebt ? 'cubierto' : 'pendiente'
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return list.filter(a =>
      (!q || nombreCompleto(a).toLowerCase().includes(q) || (a.numeros ?? a.numero ?? '').toLowerCase().includes(q))
    )
  }, [list, search])

  const openNew = () => {
    setEditing({
      nombre: '', apellido_paterno: '', apellido_materno: '', rut: '', numero_socio: '',
      activo: true, notas: '',
      propiedades: [{ numero: '', tipo: 'PARCELA', acciones: 0, hectareas: 0, direccion: '', marco: '' }]
    })
    setIsNew(true)
  }

  const openEdit = async (a: Accionista) => {
    const props = await api.propiedades.list(a.id)
    const propiedades = props.length > 0
      ? props.map((p: any) => ({
          id: p.id, numero: p.numero ?? '', tipo: p.tipo,
          acciones: p.acciones, hectareas: p.hectareas,
          direccion: p.direccion ?? '', marco: p.marco ?? ''
        }))
      : [{ numero: a.numero ?? '', tipo: a.tipo, acciones: a.acciones, hectareas: a.hectareas, direccion: '', marco: '' }]
    setEditing({
      id: a.id, nombre: a.nombre,
      apellido_paterno: a.apellido_paterno ?? '', apellido_materno: a.apellido_materno ?? '',
      rut: a.rut ?? '', numero_socio: a.numero_socio ?? '', activo: a.activo, notas: a.notas ?? '', propiedades
    })
    setIsNew(false)
  }

  const save = async () => {
    if (!editing) return
    const payload = {
      id: editing.id, nombre: editing.nombre,
      apellido_paterno: editing.apellido_paterno || null,
      apellido_materno: editing.apellido_materno || null,
      rut: editing.rut || null,
      numero_socio: editing.numero_socio || null,
      activo: editing.activo, notas: editing.notas || null,
      propiedades: editing.propiedades.map(p => ({
        ...p, numero: p.numero || null, direccion: p.direccion || null,
        marco: p.marco || null
      }))
    }
    if (isNew) await api.accionistas.create(payload)
    else await api.accionistas.update(payload)
    setEditing(null)
    load()
  }

  return (
    <div className="space-y-4">
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
        <span className="text-sm text-gray-500 self-center">{filtered.length} accionistas</span>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-2 text-left">N° Socio</th>
              <th className="px-4 py-2 text-left">Nombre</th>
              <th className="px-4 py-2 text-left">Propiedades</th>
              <th className="px-4 py-2 text-right">Acciones</th>
              <th className="px-4 py-2 text-right">Hectáreas</th>
              <th className="px-4 py-2 text-center">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id} className="table-row cursor-pointer" onClick={() => navigate(`/accionistas/${a.id}`)}>
                <td className="px-4 py-2 text-gray-500 text-xs">{a.numero_socio ?? '—'}</td>
                <td className="px-4 py-2 font-medium">{nombreCompleto(a)}</td>
                <td className="px-4 py-2 text-gray-500 text-xs max-w-[120px] truncate" title={a.numeros ?? a.numero ?? ''}>
                  {a.numeros ?? a.numero ?? '—'}
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
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">Sin resultados</td></tr>
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
