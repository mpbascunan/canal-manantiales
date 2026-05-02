import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import { formatCLP } from '../lib/formulas'
import type { Temporada } from '../../../shared/types'

const EMPTY: Omit<Temporada, 'id'> = {
  nombre: '',
  fecha_inicio: '',
  fecha_fin: '',
  valor_accion: 41000,
  activa: false,
  nota_aviso: ''
}

export default function Temporadas() {
  const [list, setList] = useState<Temporada[]>([])
  const [editing, setEditing] = useState<Partial<Temporada> | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = () => api.temporadas.list().then(setList)
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!editing) return
    if (isNew) {
      await api.temporadas.create(editing)
    } else {
      await api.temporadas.update(editing as Temporada)
    }
    setEditing(null)
    load()
  }

  const setActive = async (id: number) => {
    await api.temporadas.setActive(id)
    load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Temporadas</h1>
        <button className="btn-primary" onClick={() => { setEditing({ ...EMPTY }); setIsNew(true) }}>
          + Nueva temporada
        </button>
      </div>

      <div className="card divide-y divide-gray-100">
        {list.length === 0 && (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">Sin temporadas registradas.</p>
        )}
        {list.map(t => (
          <div key={t.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{t.nombre}</span>
                {t.activa ? (
                  <span className="badge-green">Activa</span>
                ) : (
                  <span className="badge-gray">Inactiva</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {t.fecha_inicio} → {t.fecha_fin} · Acción: {formatCLP(t.valor_accion)}
              </div>
            </div>
            <div className="flex gap-2">
              {!t.activa && (
                <button className="btn-secondary btn-sm" onClick={() => setActive(t.id)}>
                  Activar
                </button>
              )}
              <button className="btn-secondary btn-sm" onClick={() => { setEditing({ ...t }); setIsNew(false) }}>
                Editar
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {editing && (
        <Modal title={isNew ? 'Nueva temporada' : 'Editar temporada'} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <Field label="Nombre (ej: 2025-2026)">
              <input className="input" value={editing.nombre ?? ''} onChange={e => setEditing({ ...editing, nombre: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha inicio">
                <input type="date" className="input" value={editing.fecha_inicio ?? ''} onChange={e => setEditing({ ...editing, fecha_inicio: e.target.value })} />
              </Field>
              <Field label="Fecha fin">
                <input type="date" className="input" value={editing.fecha_fin ?? ''} onChange={e => setEditing({ ...editing, fecha_fin: e.target.value })} />
              </Field>
            </div>
            <Field label="Valor acción (CLP)">
              <input type="number" className="input" value={editing.valor_accion ?? 41000} onChange={e => setEditing({ ...editing, valor_accion: Number(e.target.value) })} />
            </Field>
            <Field label="Nota en avisos de cobro (opcional)">
              <textarea className="input" rows={3} value={editing.nota_aviso ?? ''} onChange={e => setEditing({ ...editing, nota_aviso: e.target.value })} placeholder="Texto que aparecerá al pie de los avisos de cobro..." />
            </Field>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
            <button className="btn-primary" onClick={save}>Guardar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
