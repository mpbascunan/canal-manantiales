import { useState, useEffect } from 'react'
import { api } from '../lib/ipc'
import { parseAccionistas, parsePagos } from '../lib/importParser'
import type { Temporada } from '../../../shared/types'

type Step = 'accionistas' | 'pagos'
type Phase = 'idle' | 'parsing' | 'preview' | 'importing' | 'done'

interface AccionistaPreviewRow {
  nombre: string
  numero: string | null
  tipo: string
  acciones: number
  hectareas: number
}
interface PagoPreviewRow {
  numero_ingreso: number
  fecha: string
  accionista_nombre: string
  total: number
}
interface StepResult {
  imported: number
  skipped: number
  errors: string[]
}

export default function ImportarExcel() {
  const [step, setStep] = useState<Step>('accionistas')
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<StepResult | null>(null)
  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [selectedTemporada, setSelectedTemporada] = useState<number>(0)

  // Preview data
  const [accPreview, setAccPreview] = useState<{
    new_accionistas: AccionistaPreviewRow[]
    new_propiedades: AccionistaPreviewRow[]
    duplicates: AccionistaPreviewRow[]
    rows: any[]
  } | null>(null)

  const [pagoPreview, setPagoPreview] = useState<{
    new_pagos: PagoPreviewRow[]
    duplicates: PagoPreviewRow[]
    missing_accionistas: PagoPreviewRow[]
    rows: any[]
  } | null>(null)

  useEffect(() => {
    api.temporadas.list().then((ts: Temporada[]) => {
      setTemporadas(ts)
      const active = ts.find((t: Temporada) => t.activa)
      if (active) setSelectedTemporada(active.id)
    })
  }, [])

  const readExcel = async (filePath: string): Promise<ArrayBuffer> => {
    const data: Uint8Array = await api.import.readFile(filePath)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }

  // ── ACCIONISTAS ──────────────────────────────────────────────────────────────

  const handleSelectAccionistas = async () => {
    const filePath = await api.import.selectFile()
    if (!filePath) return
    setPhase('parsing')
    setResult(null)
    setAccPreview(null)
    try {
      const buffer = await readExcel(filePath)
      const rows = parseAccionistas(buffer)
      const preview = await api.import.previewAccionistas(rows)
      setAccPreview({ ...preview, rows })
      setPhase('preview')
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message] })
      setPhase('done')
    }
  }

  const handleConfirmAccionistas = async () => {
    if (!accPreview) return
    setPhase('importing')
    try {
      const res = await api.import.accionistas(accPreview.rows)
      setResult(res)
      setPhase('done')
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message] })
      setPhase('done')
    }
  }

  // ── PAGOS ────────────────────────────────────────────────────────────────────

  const handleSelectPagos = async () => {
    if (!selectedTemporada) return alert('Selecciona una temporada primero')
    const filePath = await api.import.selectFile()
    if (!filePath) return
    setPhase('parsing')
    setResult(null)
    setPagoPreview(null)
    try {
      const buffer = await readExcel(filePath)
      const rows = parsePagos(buffer)
      const preview = await api.import.previewPagos(rows, selectedTemporada)
      setPagoPreview({ ...preview, rows })
      setPhase('preview')
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message] })
      setPhase('done')
    }
  }

  const handleConfirmPagos = async () => {
    if (!pagoPreview) return
    setPhase('importing')
    try {
      const res = await api.import.pagos(pagoPreview.rows, selectedTemporada)
      setResult(res)
      setPhase('done')
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message] })
      setPhase('done')
    }
  }

  const handleCancel = () => {
    setPhase('idle')
    setAccPreview(null)
    setPagoPreview(null)
    setResult(null)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Importar Excel</h1>
        <p className="text-sm text-gray-500 mt-1">
          Migra los datos de los archivos Excel existentes a la base de datos.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {([['accionistas', '1. Accionistas'], ['pagos', '2. Pagos']] as const).map(([s, label]) => (
          <button
            key={s}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              step === s ? 'border-canal-600 text-canal-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => { setStep(s); setPhase('idle'); setResult(null); setAccPreview(null); setPagoPreview(null) }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── ACCIONISTAS STEP ── */}
      {step === 'accionistas' && (
        <div className="space-y-4">
          {phase === 'idle' && (
            <div className="card p-4 space-y-3">
              <h2 className="font-semibold text-sm">Importar Accionistas</h2>
              <p className="text-sm text-gray-600">
                Selecciona el archivo <strong>LISTADO DE ACCIONISTAS XXXX-XXXX.xlsx</strong>.
                Se importarán las hojas: PARCELAS, SITIOS y PEQUEÑOS PROPIETARIOS.
              </p>
              <p className="text-xs text-gray-400">
                Si un accionista ya existe, se agregarán sus propiedades faltantes. Se te mostrará un resumen antes de confirmar.
              </p>
              <button className="btn-primary" onClick={handleSelectAccionistas}>
                Seleccionar archivo
              </button>
            </div>
          )}

          {phase === 'parsing' && (
            <div className="card p-4 text-center text-sm text-gray-500">
              <div className="animate-spin text-canal-500 text-2xl mb-2">⟳</div>
              Analizando archivo...
            </div>
          )}

          {phase === 'preview' && accPreview && (
            <AccionistasPreviewPanel
              preview={accPreview}
              onConfirm={handleConfirmAccionistas}
              onCancel={handleCancel}
            />
          )}

          {phase === 'importing' && (
            <div className="card p-4 text-center text-sm text-gray-500">
              <div className="animate-spin text-canal-500 text-2xl mb-2">⟳</div>
              Importando...
            </div>
          )}

          {phase === 'done' && result && (
            <>
              <ImportResult result={result} />
              {result.errors.length === 0 && (
                <button className="btn-secondary" onClick={() => { setStep('pagos'); setPhase('idle'); setResult(null) }}>
                  Continuar con pagos →
                </button>
              )}
              <button className="btn-secondary ml-2" onClick={() => { setPhase('idle'); setResult(null) }}>
                Importar otro archivo
              </button>
            </>
          )}
        </div>
      )}

      {/* ── PAGOS STEP ── */}
      {step === 'pagos' && (
        <div className="space-y-4">
          {phase === 'idle' && (
            <div className="card p-4 space-y-3">
              <h2 className="font-semibold text-sm">Importar Pagos</h2>
              <p className="text-sm text-gray-600">
                Selecciona el archivo <strong>Ingresos Temp. XXXX-XXXX.xlsx</strong>.
              </p>
              <div>
                <label className="label">Temporada a la que corresponden los pagos</label>
                <select className="input max-w-xs" value={selectedTemporada} onChange={e => setSelectedTemporada(Number(e.target.value))}>
                  <option value={0}>— Seleccionar —</option>
                  {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>
              <p className="text-xs text-gray-400">
                Se te mostrará un resumen antes de confirmar. Los accionistas deben estar importados primero.
              </p>
              <button className="btn-primary" disabled={!selectedTemporada} onClick={handleSelectPagos}>
                Seleccionar archivo
              </button>
            </div>
          )}

          {phase === 'parsing' && (
            <div className="card p-4 text-center text-sm text-gray-500">
              <div className="animate-spin text-canal-500 text-2xl mb-2">⟳</div>
              Analizando archivo...
            </div>
          )}

          {phase === 'preview' && pagoPreview && (
            <PagosPreviewPanel
              preview={pagoPreview}
              onConfirm={handleConfirmPagos}
              onCancel={handleCancel}
            />
          )}

          {phase === 'importing' && (
            <div className="card p-4 text-center text-sm text-gray-500">
              <div className="animate-spin text-canal-500 text-2xl mb-2">⟳</div>
              Importando...
            </div>
          )}

          {phase === 'done' && result && (
            <>
              <ImportResult result={result} />
              <button className="btn-secondary mt-2" onClick={() => { setPhase('idle'); setResult(null) }}>
                Importar otro archivo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Preview panels ─────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  PARCELA: 'Parcela', SITIO: 'Sitio', PEQUEÑO_PROPIETARIO: 'Pequeño Prop.'
}

function AccionistasPreviewPanel({ preview, onConfirm, onCancel }: {
  preview: { new_accionistas: any[]; new_propiedades: any[]; duplicates: any[] }
  onConfirm: () => void
  onCancel: () => void
}) {
  const totalNew = preview.new_accionistas.length + preview.new_propiedades.length
  const hasDuplicates = preview.duplicates.length > 0

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={`card p-4 space-y-2 ${hasDuplicates ? 'border-amber-200 bg-amber-50' : 'border-green-100'}`}>
        <h3 className="font-semibold text-sm">Resumen de importación</h3>
        <div className="flex gap-6 text-sm">
          <span className="text-green-700 font-medium">✓ {preview.new_accionistas.length} nuevos accionistas</span>
          {preview.new_propiedades.length > 0 && (
            <span className="text-canal-700 font-medium">+ {preview.new_propiedades.length} propiedades nuevas</span>
          )}
          {hasDuplicates && (
            <span className="text-amber-700 font-medium">⚠ {preview.duplicates.length} ya existen (se omitirán)</span>
          )}
        </div>
        {totalNew === 0 && (
          <p className="text-sm text-gray-500">No hay datos nuevos para importar.</p>
        )}
      </div>

      {/* New accionistas */}
      {preview.new_accionistas.length > 0 && (
        <CollapsibleTable
          title={`Nuevos accionistas (${preview.new_accionistas.length})`}
          color="green"
          rows={preview.new_accionistas}
        />
      )}

      {/* New propiedades */}
      {preview.new_propiedades.length > 0 && (
        <CollapsibleTable
          title={`Propiedades nuevas para accionistas existentes (${preview.new_propiedades.length})`}
          color="blue"
          rows={preview.new_propiedades}
        />
      )}

      {/* Duplicates */}
      {hasDuplicates && (
        <CollapsibleTable
          title={`Ya existen — se omitirán (${preview.duplicates.length})`}
          color="amber"
          rows={preview.duplicates}
          defaultCollapsed
        />
      )}

      <div className="flex gap-3">
        <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={totalNew === 0}
          onClick={onConfirm}
        >
          Confirmar e importar {totalNew > 0 ? `(${totalNew})` : ''}
        </button>
      </div>
    </div>
  )
}

function PagosPreviewPanel({ preview, onConfirm, onCancel }: {
  preview: { new_pagos: PagoPreviewRow[]; duplicates: PagoPreviewRow[]; missing_accionistas: PagoPreviewRow[] }
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-4">
      <div className={`card p-4 space-y-2 ${preview.missing_accionistas.length > 0 ? 'border-red-200 bg-red-50' : 'border-green-100'}`}>
        <h3 className="font-semibold text-sm">Resumen de importación</h3>
        <div className="flex gap-6 text-sm">
          <span className="text-green-700 font-medium">✓ {preview.new_pagos.length} nuevos pagos</span>
          {preview.duplicates.length > 0 && (
            <span className="text-amber-700">⚠ {preview.duplicates.length} ya existen (se omitirán)</span>
          )}
          {preview.missing_accionistas.length > 0 && (
            <span className="text-red-700 font-medium">✗ {preview.missing_accionistas.length} accionistas no encontrados</span>
          )}
        </div>
      </div>

      {preview.missing_accionistas.length > 0 && (
        <div className="card p-3 border-red-200">
          <p className="text-sm font-medium text-red-700 mb-2">Accionistas no encontrados (estos pagos NO se importarán):</p>
          <div className="max-h-32 overflow-y-auto text-xs space-y-0.5">
            {preview.missing_accionistas.map((r, i) => (
              <div key={i} className="text-red-600">• N°{r.numero_ingreso} — {r.accionista_nombre}</div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={preview.new_pagos.length === 0}
          onClick={onConfirm}
        >
          Confirmar e importar {preview.new_pagos.length > 0 ? `(${preview.new_pagos.length} pagos)` : ''}
        </button>
      </div>
    </div>
  )
}

function CollapsibleTable({ title, color, rows, defaultCollapsed = false }: {
  title: string
  color: 'green' | 'blue' | 'amber'
  rows: any[]
  defaultCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const colors = {
    green: 'text-green-700 border-green-200',
    blue: 'text-canal-700 border-canal-200',
    amber: 'text-amber-700 border-amber-200'
  }
  return (
    <div className={`card border ${colors[color]}`}>
      <button
        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium ${colors[color]}`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span>{title}</span>
        <span>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="max-h-48 overflow-y-auto border-t border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-1.5 text-left text-gray-600">Nombre</th>
                <th className="px-3 py-1.5 text-left text-gray-600">N°</th>
                <th className="px-3 py-1.5 text-left text-gray-600">Tipo</th>
                <th className="px-3 py-1.5 text-right text-gray-600">Acc.</th>
                <th className="px-3 py-1.5 text-right text-gray-600">Ha.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-50">
                  <td className="px-3 py-1 font-medium">{r.nombre}</td>
                  <td className="px-3 py-1 text-gray-500">{r.numero ?? '—'}</td>
                  <td className="px-3 py-1">{TIPO_LABELS[r.tipo] ?? r.tipo}</td>
                  <td className="px-3 py-1 text-right">{r.acciones > 0 ? r.acciones : '—'}</td>
                  <td className="px-3 py-1 text-right">{r.hectareas > 0 ? r.hectareas : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ImportResult({ result }: { result: StepResult }) {
  return (
    <div className={`card p-4 space-y-2 ${result.errors.length > 0 ? 'border-red-200' : 'border-green-200'}`}>
      <div className="flex gap-4 text-sm">
        <span className="text-green-600 font-medium">✓ {result.imported} importados</span>
        <span className="text-gray-500">{result.skipped} omitidos</span>
        {result.errors.length > 0 && <span className="text-red-600">{result.errors.length} errores</span>}
      </div>
      {result.errors.length > 0 && (
        <div className="max-h-40 overflow-y-auto text-xs text-red-600 space-y-0.5">
          {result.errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}
    </div>
  )
}
