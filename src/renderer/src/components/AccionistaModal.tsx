import { useState } from 'react'
import type { AccionistaType, PropiedadInput } from '../../../shared/types'

const COMUNAS_OHIGGINS = [
  // Provincia de Cachapoal
  'Rancagua', 'Codegua', 'Coinco', 'Coltauco', 'Doñihue', 'Graneros',
  'Las Cabras', 'Machalí', 'Malloa', 'Mostazal', 'Olivar', 'Peumo',
  'Pichidegua', 'Quinta de Tilcoco', 'Rengo', 'Requínoa', 'San Vicente de Tagua Tagua',
  // Provincia de Colchagua
  'San Fernando', 'Chépica', 'Chimbarongo', 'Lolol', 'Nancagua', 'Palmilla',
  'Peralillo', 'Placilla', 'Pumanque', 'Santa Cruz',
  // Provincia de Cardenal Caro
  'Pichilemu', 'La Estrella', 'Litueche', 'Marchihue', 'Navidad', 'Paredones'
]

const DEFAULT_DIRECCIONES = ['Rinconada de manantiales', 'La tuna', 'Las canchillas']
const DEFAULT_MARCOS = [
  'Canal principal', 'El cerrillo', 'Cerro al peñon', 'El durazno',
  'La luquita', 'Los ortices', 'Plaza manantiales', 'Ramal 1'
]

function loadStoredOptions(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]')
  } catch {
    return []
  }
}

function saveStoredOptions(key: string, custom: string[]): void {
  localStorage.setItem(key, JSON.stringify(custom))
}

function ExtendableSelect({
  storageKey,
  defaults,
  value,
  onChange,
  className
}: {
  storageKey: string
  defaults: string[]
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const [customOptions, setCustomOptions] = useState<string[]>(() => loadStoredOptions(storageKey))
  const [adding, setAdding] = useState(false)
  const [newOption, setNewOption] = useState('')

  const allOptions = [...new Set([...defaults, ...customOptions])]
  // Ensure current value appears even if it predates the option list
  const displayOptions = value && !allOptions.includes(value) ? [...allOptions, value] : allOptions

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '__add__') {
      setAdding(true)
      setNewOption('')
    } else {
      onChange(e.target.value)
    }
  }

  const confirmAdd = () => {
    const trimmed = newOption.trim()
    if (!trimmed) { setAdding(false); return }
    if (!allOptions.includes(trimmed)) {
      const updated = [...customOptions, trimmed]
      setCustomOptions(updated)
      saveStoredOptions(storageKey, updated)
    }
    onChange(trimmed)
    setAdding(false)
    setNewOption('')
  }

  if (adding) {
    return (
      <div className="flex gap-1">
        <input
          autoFocus
          className={className ?? 'input text-sm'}
          value={newOption}
          onChange={e => setNewOption(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmAdd() }
            if (e.key === 'Escape') { setAdding(false); setNewOption('') }
          }}
          onBlur={confirmAdd}
          placeholder="Nueva opción..."
        />
      </div>
    )
  }

  return (
    <select className={className ?? 'input text-sm'} value={value} onChange={handleChange}>
      <option value="">— Seleccionar —</option>
      {displayOptions.map(o => <option key={o} value={o}>{o}</option>)}
      <option disabled>──────────</option>
      <option value="__add__">+ Agregar opción…</option>
    </select>
  )
}

export interface AccionistaEditForm {
  id?: number
  nombre: string
  apellido_paterno: string
  apellido_materno: string
  numero_socio: string
  activo: boolean
  notas: string
  propiedades: PropiedadInput[]
}

export const EMPTY_ACCIONISTA_FORM: AccionistaEditForm = {
  nombre: '',
  apellido_paterno: '',
  apellido_materno: '',
  numero_socio: '',
  activo: true,
  notas: '',
  propiedades: [{ numero: '', tipo: 'PARCELA', acciones: 0, hectareas: 0, direccion: '', sector: '', comuna: '', marco: '' }]
}

export function AccionistaModal({ value, isNew, onChange, onSave, onClose }: {
  value: AccionistaEditForm
  isNew: boolean
  onChange: (f: AccionistaEditForm) => void
  onSave: () => void
  onClose: () => void
}) {
  const set = (patch: Partial<AccionistaEditForm>) => onChange({ ...value, ...patch })

  const setPropiedad = (i: number, patch: Partial<PropiedadInput>) => {
    const props = value.propiedades.map((p, j) => j === i ? { ...p, ...patch } : p)
    set({ propiedades: props })
  }

  const addPropiedad = () => {
    const lastTipo = value.propiedades[value.propiedades.length - 1]?.tipo ?? 'PARCELA'
    set({ propiedades: [...value.propiedades, { numero: '', tipo: lastTipo, acciones: 0, hectareas: 0, direccion: '', sector: '', comuna: '', marco: '' }] })
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
          {/* Name fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Nombre</label>
              <input className="input" value={value.nombre} onChange={e => set({ nombre: e.target.value })} />
            </div>
            <div>
              <label className="label">Apellido paterno</label>
              <input className="input" value={value.apellido_paterno} onChange={e => set({ apellido_paterno: e.target.value })} />
            </div>
            <div>
              <label className="label">Apellido materno</label>
              <input className="input" value={value.apellido_materno} onChange={e => set({ apellido_materno: e.target.value })} />
            </div>
          </div>

          {/* Número socio */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Número socio</label>
              <input className="input" value={value.numero_socio} onChange={e => set({ numero_socio: e.target.value })} placeholder="Ej: 042" />
            </div>
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

            <div className="space-y-3">
              {value.propiedades.map((p, i) => (
                <div key={i} className="bg-gray-50 rounded p-3 space-y-2">
                  {/* Row 1: N°, Tipo, Acciones, Hectáreas, Remove */}
                  <div className="flex gap-2 items-center">
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
                        value={p.acciones === 0 ? '' : p.acciones}
                        onChange={e => setPropiedad(i, { acciones: e.target.value === '' ? 0 : Number(e.target.value) })}
                        title="Acciones"
                      />
                      <span className="text-xs text-gray-400">acc</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" step="0.0001" min="0"
                        className="input w-24 text-sm text-right"
                        placeholder="Hect."
                        value={p.hectareas === 0 ? '' : p.hectareas}
                        onChange={e => setPropiedad(i, { hectareas: e.target.value === '' ? 0 : Number(e.target.value) })}
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
                  {/* Row 2: Address fields */}
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="text-xs text-gray-500">Dirección</label>
                      <ExtendableSelect
                        storageKey="canal:direccion_options"
                        defaults={DEFAULT_DIRECCIONES}
                        value={p.direccion ?? ''}
                        onChange={v => setPropiedad(i, { direccion: v })}
                        className="input text-sm w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Sector</label>
                      <input
                        className="input text-sm"
                        placeholder="Sector"
                        value={p.sector ?? ''}
                        onChange={e => setPropiedad(i, { sector: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Comuna</label>
                      <select
                        className="input text-sm"
                        value={p.comuna ?? ''}
                        onChange={e => setPropiedad(i, { comuna: e.target.value })}
                      >
                        <option value="">— Seleccionar —</option>
                        {COMUNAS_OHIGGINS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Marco</label>
                      <ExtendableSelect
                        storageKey="canal:marco_options"
                        defaults={DEFAULT_MARCOS}
                        value={p.marco ?? ''}
                        onChange={v => setPropiedad(i, { marco: v })}
                        className="input text-sm w-full"
                      />
                    </div>
                  </div>
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
