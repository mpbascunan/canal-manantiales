import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import { formatCLP } from '../lib/formulas'
import type { DeudaInicial, TipoDeudaInicial } from '../../../shared/types'
import { DEUDA_TIPO_CONCEPTO, DEUDA_TIPO_LABELS } from '../lib/labels'

interface Linea {
  concepto: string
  tipo: TipoDeudaInicial
  monto: string
  /** Kept as the raw input string; empty means "not recorded". */
  temporadas: string
}

/**
 * Debt an accionista carried in from before the system existed (context.md D14).
 *
 * Bulk entry is the Excel import; this is for correcting one person by hand.
 * Saving replaces the whole set in one transaction rather than patching lines
 * individually, so a half-applied edit is not reachable.
 */
export function DeudaInicialPanel({ accionistaId, onChange }: {
  accionistaId: number
  onChange?: () => void
}) {
  const [lineas, setLineas] = useState<DeudaInicial[]>([])
  const [editing, setEditing] = useState<Linea[] | null>(null)
  const [saving, setSaving] = useState(false)

  const load = (): void => {
    api.deudaInicial.listByAccionista(accionistaId).then(setLineas)
  }

  useEffect(load, [accionistaId])

  const total = lineas.reduce((acc, l) => acc + l.monto, 0)

  const startEdit = (): void => {
    setEditing(lineas.map(l => ({
      concepto: l.concepto,
      tipo: l.tipo,
      monto: String(l.monto),
      temporadas: l.temporadas_adeudadas === null ? '' : String(l.temporadas_adeudadas)
    })))
  }

  const setLinea = (index: number, patch: Partial<Linea>): void => {
    setEditing(prev => prev && prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  const addLinea = (): void => {
    setEditing(prev => [...(prev ?? []), { concepto: '', tipo: 'MULTA', monto: '', temporadas: '' }])
  }

  const removeLinea = (index: number): void => {
    setEditing(prev => prev && prev.filter((_, i) => i !== index))
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    const payload = editing
      .filter(l => Number(l.monto) > 0)
      .map(l => ({
        accionista_id: accionistaId,
        concepto: l.concepto.trim() || DEUDA_TIPO_CONCEPTO[l.tipo],
        tipo: l.tipo,
        monto: Number(l.monto),
        // Blank stays blank: the main process turns anything that is not a whole
        // count of at least one season into null.
        temporadas_adeudadas: l.temporadas.trim() === '' ? null : Number(l.temporadas),
        notas: null
      }))

    setSaving(true)
    try {
      await api.deudaInicial.replaceForAccionista(accionistaId, payload)
      setEditing(null)
      load()
      onChange?.()
    } finally {
      setSaving(false)
    }
  }

  if (lineas.length === 0 && !editing) {
    return (
      <div className="card p-4 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm text-gray-700">Deuda de temporadas anteriores</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Sin deuda anterior registrada.
          </p>
        </div>
        <button className="btn-secondary btn-sm" onClick={startEdit}>Agregar</button>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-sm text-gray-700">Deuda de temporadas anteriores</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Montos tomados de los registros de la administración. El sistema no los recalcula.
          </p>
        </div>
        {!editing && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-amber-700 tabular-nums">{formatCLP(total)}</span>
            <button className="btn-secondary btn-sm" onClick={startEdit}>Editar</button>
          </div>
        )}
      </div>

      {!editing ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-2 text-left">Concepto</th>
              <th className="px-4 py-2 text-left">Tipo</th>
              <th className="px-4 py-2 text-right">Temporadas</th>
              <th className="px-4 py-2 text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map(l => (
              <tr key={l.id} className="table-row">
                <td className="px-4 py-2">{l.concepto}</td>
                <td className="px-4 py-2"><TipoDeudaTag tipo={l.tipo} /></td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">
                  {l.temporadas_adeudadas ?? '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCLP(l.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="p-4 space-y-3">
          {editing.length === 0 && (
            <p className="text-xs text-gray-400">No hay líneas. Agrega una para registrar deuda anterior.</p>
          )}
          {editing.map((l, i) => (
            <div key={i} className="flex gap-2 items-start">
              <input
                className="input flex-1"
                placeholder="Ej: Multa temporada 2024-2025"
                value={l.concepto}
                onChange={e => setLinea(i, { concepto: e.target.value })}
              />
              <select
                className="input w-32"
                value={l.tipo}
                onChange={e => setLinea(i, { tipo: e.target.value as Linea['tipo'] })}
              >
                <option value="CUOTA">Cuota</option>
                <option value="OTRO">Otro</option>
                <option value="MULTA">Multa</option>
              </select>
              <input
                className="input w-24 text-right"
                type="number"
                min={1}
                step={1}
                placeholder="N° temp."
                title="Cuántas temporadas cubre este monto (opcional)"
                value={l.temporadas}
                onChange={e => setLinea(i, { temporadas: e.target.value })}
              />
              <input
                className="input w-32 text-right"
                type="number"
                min={0}
                placeholder="0"
                value={l.monto}
                onChange={e => setLinea(i, { monto: e.target.value })}
              />
              <button
                className="text-gray-400 hover:text-red-500 px-2 py-1.5"
                title="Quitar línea"
                onClick={() => removeLinea(i)}
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button className="btn-secondary btn-sm" onClick={addLinea}>+ Agregar línea</button>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setEditing(null)} disabled={saving}>
                Cancelar
              </button>
              <button className="btn-primary btn-sm" onClick={save} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
          <p className="text-xs text-amber-700">
            Los abonos descuentan esta deuda antes que cualquier temporada.
          </p>
          <p className="text-xs text-gray-400">
            El N° de temporadas es solo referencial: indica cuántas temporadas cubre el monto y
            no se usa para calcular la deuda.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * The kind of a pre-app debt line, shown next to its concepto.
 *
 * The concepto is free text transcribed from the administration's records, so it
 * may or may not mention what the amount is for. The tipo is what the system
 * actually charges on — cuota first, then otros, then multa — and it belongs on
 * screen next to the figure it governs rather than only in the edit form.
 */
export function TipoDeudaTag({ tipo }: { tipo: TipoDeudaInicial }) {
  const estilo: Record<TipoDeudaInicial, string> = {
    CUOTA: 'bg-canal-100 text-canal-700',
    MULTA: 'bg-red-100 text-red-700',
    OTRO: 'bg-gray-200 text-gray-700'
  }
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${estilo[tipo]}`}>
      {DEUDA_TIPO_LABELS[tipo]}
    </span>
  )
}
