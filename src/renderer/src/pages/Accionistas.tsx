import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import type { Accionista } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'
import { AccionistaModal, BLANK_PROPIEDAD, type AccionistaEditForm } from '../components/AccionistaModal'

function formatNum(n: number): string {
  return n > 0 ? n.toLocaleString('es-CL', { maximumFractionDigits: 4 }) : '—'
}

type AccionistaConStatus = Accionista & {
  pago_temporada_activa?: number
  has_unpaid_cargos?: number
  total_abonado?: number
}

export default function Accionistas() {
  const [list, setList] = useState<AccionistaConStatus[]>([])
  /** `total_pendiente` per accionista, from the one debt engine (D13). */
  const [pendientes, setPendientes] = useState<Map<number, number>>(new Map())
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AccionistaEditForm | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const navigate = useNavigate()

  const load = async () => {
    const temporada = await api.temporadas.getActive()
    // Every accionista, settled ones included: a row with no debt is exactly
    // what marks it "Cubierto" below.
    const [data, deudas] = await Promise.all([
      temporada ? api.accionistas.withPagoStatus(temporada.id) : api.accionistas.list(),
      api.deudores.listDeuda(undefined, true)
    ])
    setList(data)
    setPendientes(new Map(deudas.map((d: any) => [d.id, d.deuda.total_pendiente])))
  }

  /**
   * "Cubierto" means the abonos already cover everything owed, without a pago
   * row closing the season. It is read straight off the debt engine — this used
   * to re-derive the total from `temporadas_adeudadas` at the active season's
   * rate, and so disagreed with every other screen (context.md G4, G7).
   */
  const pagoStatus = (a: AccionistaConStatus): 'pagado' | 'cubierto' | 'pendiente' => {
    if (a.pago_temporada_activa && !a.has_unpaid_cargos) return 'pagado'
    const pendiente = pendientes.get(a.id)
    if (pendiente !== undefined && pendiente <= 0) return 'cubierto'
    return 'pendiente'
  }

  useEffect(() => { load() }, [])

  /** Numbers already taken, so the form can say so before SQLite does (D17). */
  const numerosSocioEnUso = useMemo(
    () => new Set(
      list
        .filter(a => a.id !== editing?.id)
        .map(a => (a.numero_socio ?? '').trim())
        .filter(Boolean)
    ),
    [list, editing?.id]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return list.filter(a =>
      (!q || nombreCompleto(a).toLowerCase().includes(q) || (a.nombres_propiedades ?? '').toLowerCase().includes(q))
    )
  }, [list, search])

  const openNew = () => {
    setEditing({
      nombre: '', apellido_paterno: '', apellido_materno: '', rut: '', numero_socio: '',
      activo: true, notas: '',
      propiedades: [BLANK_PROPIEDAD]
    })
    setIsNew(true)
  }

  const openEdit = async (a: Accionista) => {
    const props = await api.propiedades.list(a.id)
    const propiedades = props.length > 0
      ? props.map((p: any) => ({
          id: p.id, nombre: p.nombre ?? '', tipo: p.tipo,
          acciones: p.acciones, hectareas: p.hectareas,
          direccion: p.direccion ?? '', marco: p.marco ?? ''
        }))
      : [BLANK_PROPIEDAD]
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
        ...p, nombre: p.nombre || null, direccion: p.direccion || null,
        marco: p.marco || null
      }))
    }
    // The N° socio is unique in the database (D17), so a collision the form did
    // not catch — an inactive accionista holds it, another window just took it —
    // comes back as an error here rather than as a silent failure to save.
    try {
      if (isNew) await api.accionistas.create(payload)
      else await api.accionistas.update(payload)
    } catch (e: any) {
      setSaveError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']*':\s*/, ''))
      return
    }
    setSaveError(null)
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
                <td className="px-4 py-2 text-gray-500 text-xs max-w-[200px] truncate" title={a.nombres_propiedades ?? ''}>
                  {a.nombres_propiedades ?? '—'}
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
          numerosSocioEnUso={numerosSocioEnUso}
          error={saveError}
          onChange={f => { setSaveError(null); setEditing(f) }}
          onSave={save}
          onClose={() => { setSaveError(null); setEditing(null) }}
        />
      )}
    </div>
  )
}
