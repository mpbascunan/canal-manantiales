import { Fragment, useState, useEffect } from 'react'
import { api } from '../lib/ipc'
import { parsePropiedades, parseDeudaInicial, parsePagos } from '../lib/importParser'
import {
  descargarPlantillaAccionistas, descargarPlantillaDeudaInicial, descargarPlantillaPagos
} from '../lib/plantillas'
import {
  armarDeudaNoImportada, armarNoImportados,
  descargarDeudaNoImportada, descargarNoImportados
} from '../lib/importReport'
import type { Temporada, TipoDeudaInicial } from '../../../shared/types'
import { DEUDA_TIPO_LABELS } from '../lib/labels'
import { formatCLP, formatNumber } from '../lib/formulas'

type Step = 'accionistas' | 'pagos' | 'deuda-inicial'
type Phase = 'idle' | 'parsing' | 'preview' | 'importing' | 'done'

interface PropiedadPreviewRow {
  nombre: string | null
  tipo: string
  acciones: number
  hectareas: number
  hoja: string
  fila: number
}
interface AccionistaPreviewGroup {
  numero_socio: string
  nombre: string
  accionista_id: number | null
  nombre_actual: string | null
  propiedades_actuales: number
  propiedades: PropiedadPreviewRow[]
  total_acciones: number
  total_hectareas: number
}
interface PropiedadSinSocio {
  nombre: string
  hoja: string
  fila: number
}
interface PagoPreviewRow {
  numero_ingreso: number
  fecha: string
  accionista_nombre: string
  total: number
  fila: number
  otros: number
  numero_socio: string | null
  matched_by?: 'numero_socio' | 'nombre' | 'manual'
}
interface Sugerencia {
  accionista_id: number
  nombre: string
  numero_socio: string | null
  score: number
}
interface NombreSinCoincidencia {
  nombre: string
  pagos: PagoPreviewRow[]
  total: number
  sugerencias: Sugerencia[]
}
interface FilaPagoOmitida {
  fila: number
  motivo: 'sin_accionista' | 'sin_numero_ingreso' | 'sin_fecha'
  numero_ingreso: number | null
  accionista_nombre: string
  total: number
}
interface DeudaInicialPreviewRow {
  numero_socio: string | null
  accionista_nombre: string
  concepto: string
  tipo: TipoDeudaInicial
  monto: number
  fila: number
  matched_by?: 'numero_socio' | 'nombre'
}
interface DeudaSinCoincidencia {
  nombre: string
  lineas: DeudaInicialPreviewRow[]
  total: number
  sugerencias: Sugerencia[]
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
    nuevos: AccionistaPreviewGroup[]
    actualizados: AccionistaPreviewGroup[]
    sin_socio: PropiedadSinSocio[]
    rows: any[]
  } | null>(null)

  // Spreadsheet name → accionista the user picked for it in the preview.
  const [asignaciones, setAsignaciones] = useState<Record<string, number>>({})

  const [pagoPreview, setPagoPreview] = useState<{
    new_pagos: PagoPreviewRow[]
    duplicates: PagoPreviewRow[]
    duplicados_en_archivo: PagoPreviewRow[]
    missing_accionistas: PagoPreviewRow[]
    sin_coincidencia: NombreSinCoincidencia[]
    con_otros_ingresos: PagoPreviewRow[]
    total_archivo: number
    total_importable: number
    omitidas: FilaPagoOmitida[]
    rows: any[]
  } | null>(null)

  const [deudaPreview, setDeudaPreview] = useState<{
    new_lineas: DeudaInicialPreviewRow[]
    reemplaza: DeudaInicialPreviewRow[]
    missing_accionistas: DeudaInicialPreviewRow[]
    sin_coincidencia: DeudaSinCoincidencia[]
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
    // Copy into a standalone ArrayBuffer — data.buffer is typed ArrayBufferLike,
    // which xlsx will not accept.
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
    return buffer
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
      const rows = parsePropiedades(buffer)
      if (rows.length === 0) {
        setResult({
          imported: 0, skipped: 0,
          errors: ['No se encontraron filas. El archivo debe tener las hojas PARCELAS, SITIOS y/o PEQUEÑOS PROPIETARIOS, cada una con una fila de encabezados.']
        })
        setPhase('done')
        return
      }
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
      const { pagos, omitidas } = parsePagos(buffer)
      if (pagos.length === 0 && omitidas.length === 0) {
        setResult({
          imported: 0, skipped: 0,
          errors: ['No se reconocieron pagos en el archivo. Debe tener una fila de encabezados con Fecha, N° Ingreso, Accionista y Total.']
        })
        setPhase('done')
        return
      }
      const preview = await api.import.previewPagos(pagos, selectedTemporada)
      setAsignaciones({})
      setPagoPreview({ ...preview, omitidas, rows: pagos })
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
      const res = await api.import.pagos(pagoPreview.rows, selectedTemporada, asignaciones)
      setResult(res)
      setPhase('done')
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message] })
      setPhase('done')
    }
  }

  // ── DEUDA INICIAL ────────────────────────────────────────────────────────────

  const handleSelectDeudaInicial = async () => {
    const filePath = await api.import.selectFile()
    if (!filePath) return
    setPhase('parsing')
    setResult(null)
    setDeudaPreview(null)
    try {
      const buffer = await readExcel(filePath)
      const rows = parseDeudaInicial(buffer)
      if (rows.length === 0) {
        setResult({
          imported: 0, skipped: 0,
          errors: ['No se reconocieron columnas en el archivo. Debe tener una columna de accionista o nombre, y al menos una de monto, multa o cuota.']
        })
        setPhase('done')
        return
      }
      const preview = await api.deudaInicial.previewImport(rows)
      setAsignaciones({})
      setDeudaPreview({ ...preview, rows })
      setPhase('preview')
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message] })
      setPhase('done')
    }
  }

  const handleConfirmDeudaInicial = async () => {
    if (!deudaPreview) return
    setPhase('importing')
    try {
      const res = await api.deudaInicial.import(deudaPreview.rows, asignaciones)
      setResult(res)
      setPhase('done')
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message] })
      setPhase('done')
    }
  }

  // Everything the import left behind, assembled from the preview the user just
  // confirmed. Built on demand so the button can say how many rows there are.
  const noImportadasRows = pagoPreview
    ? armarNoImportados({ ...pagoPreview, asignaciones, errores: result?.errors ?? [] })
    : []
  const noImportadas = noImportadasRows.length

  const deudaNoImportadaRows = deudaPreview
    ? armarDeudaNoImportada({ ...deudaPreview, asignaciones, errores: result?.errors ?? [] })
    : []
  const deudaNoImportada = deudaNoImportadaRows.length

  const descargarReporteDeuda = () => {
    if (!deudaPreview) return
    descargarDeudaNoImportada({ ...deudaPreview, asignaciones, errores: result?.errors ?? [] })
  }

  const descargarReporte = () => {
    if (!pagoPreview) return
    const t = temporadas.find(x => x.id === selectedTemporada)
    descargarNoImportados(
      { ...pagoPreview, asignaciones, errores: result?.errors ?? [] },
      t?.nombre ?? 'temporada'
    )
  }

  const handleCancel = () => {
    setPhase('idle')
    setAsignaciones({})
    setAccPreview(null)
    setPagoPreview(null)
    setDeudaPreview(null)
    setResult(null)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Importar Excel</h1>
        <p className="text-sm text-gray-500 mt-1">
          Migra los datos de los archivos Excel existentes a la base de datos.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {([
          ['accionistas', '1. Accionistas'],
          ['pagos', '2. Pagos'],
          ['deuda-inicial', '3. Deuda anterior']
        ] as const).map(([s, label]) => (
          <button
            key={s}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              step === s ? 'border-canal-600 text-canal-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => { setStep(s); setPhase('idle'); setResult(null); setAccPreview(null); setPagoPreview(null); setDeudaPreview(null) }}
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
                Selecciona el archivo <strong>Listado de Accionistas XXXX-XXXX.xlsx</strong>.
                Se importarán las hojas: PARCELAS, SITIOS y PEQUEÑOS PROPIETARIOS.
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>Cada hoja debe tener una fila de encabezados con:</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-400">
                  <li>una columna <strong>Propietario / Razón Social</strong></li>
                  <li>una columna <strong>N° Socio</strong>, que es la que identifica al accionista</li>
                  <li>una columna <strong>Acciones</strong> y una columna <strong>Unidad</strong> que dice si el valor son acciones o hectáreas</li>
                  <li>una columna <strong>Predio</strong> o <strong>Nombre propiedad</strong> con el nombre de la propiedad</li>
                </ul>
              </div>
              <p className="text-xs text-amber-700">
                Los accionistas se identifican por su <strong>N° Socio</strong>: varias filas con el mismo
                N° Socio son una sola persona con varias propiedades. A cada accionista que aparezca en el
                archivo se le reemplazan todas sus propiedades por las de la planilla. Se te mostrará un
                resumen antes de confirmar.
              </p>
              <div className="flex gap-3 items-center">
                <button className="btn-primary" onClick={handleSelectAccionistas}>
                  Seleccionar archivo
                </button>
                <BotonPlantilla onClick={descargarPlantillaAccionistas} />
              </div>
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
              <div className="flex gap-3 items-center">
                <button className="btn-primary" disabled={!selectedTemporada} onClick={handleSelectPagos}>
                  Seleccionar archivo
                </button>
                <BotonPlantilla onClick={descargarPlantillaPagos} />
              </div>
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
              asignaciones={asignaciones}
              onAsignar={(nombre, id) => setAsignaciones(a => {
                const next = { ...a }
                if (id === null) delete next[nombre]
                else next[nombre] = id
                return next
              })}
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
              {noImportadas > 0 && (
                <ReporteNoImportadas cantidad={noImportadas} onDescargar={descargarReporte} />
              )}
              <button className="btn-secondary mt-2" onClick={() => { setPhase('idle'); setResult(null) }}>
                Importar otro archivo
              </button>
            </>
          )}
        </div>
      )}

      {/* ── DEUDA INICIAL STEP ── */}
      {step === 'deuda-inicial' && (
        <div className="space-y-4">
          {phase === 'idle' && (
            <div className="card p-4 space-y-3">
              <h2 className="font-semibold text-sm">Importar deuda de temporadas anteriores</h2>
              <p className="text-sm text-gray-600">
                Selecciona la planilla con las multas y cuotas que los accionistas arrastran de
                temporadas anteriores a la puesta en marcha del sistema.
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>La planilla debe tener una fila de encabezados con:</p>
                <ul className="list-disc list-inside space-y-0.5 text-gray-400">
                  <li>una columna <strong>Accionista</strong> o <strong>Nombre</strong> (obligatoria)</li>
                  <li>idealmente una columna <strong>N° socio</strong>, que identifica mejor que el nombre</li>
                  <li>una columna <strong>Multa</strong> y/o <strong>Cuota</strong>, o bien una columna <strong>Monto</strong> con una columna <strong>Tipo</strong></li>
                  <li>opcionalmente una columna <strong>Concepto</strong> con el detalle de cada línea</li>
                </ul>
              </div>
              <p className="text-xs text-amber-700">
                Estos montos se registran tal cual: el sistema no los recalcula. Los abonos los
                descuentan antes que cualquier temporada.
              </p>
              <div className="flex gap-3 items-center">
                <button className="btn-primary" onClick={handleSelectDeudaInicial}>
                  Seleccionar archivo
                </button>
                <BotonPlantilla onClick={descargarPlantillaDeudaInicial} />
              </div>
            </div>
          )}

          {phase === 'parsing' && (
            <div className="card p-4 text-center text-sm text-gray-500">
              <div className="animate-spin text-canal-500 text-2xl mb-2">⟳</div>
              Analizando archivo...
            </div>
          )}

          {phase === 'preview' && deudaPreview && (
            <DeudaInicialPreviewPanel
              preview={deudaPreview}
              asignaciones={asignaciones}
              onAsignar={(nombre, id) => setAsignaciones(a => {
                const next = { ...a }
                if (id === null) delete next[nombre]
                else next[nombre] = id
                return next
              })}
              onConfirm={handleConfirmDeudaInicial}
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
              {deudaNoImportada > 0 && (
                <ReporteNoImportadas
                  cantidad={deudaNoImportada}
                  onDescargar={descargarReporteDeuda}
                />
              )}
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

/**
 * The worklist offer, once an import is done. Shown for both files because the
 * question after either one is the same: what did not get in, and what do I do
 * about it now that the preview is gone.
 */
function ReporteNoImportadas({ cantidad, onDescargar }: {
  cantidad: number
  onDescargar: () => void
}) {
  return (
    <div className="card p-4 mt-2 border-amber-200 bg-amber-50 space-y-2">
      <p className="text-sm font-medium text-amber-800">
        {cantidad} {cantidad === 1 ? 'fila quedó' : 'filas quedaron'} fuera
      </p>
      <p className="text-xs text-gray-600">
        Descarga la lista con el motivo de cada una y qué hacer al respecto. Sirve como pauta
        para registrarlas a mano o para corregir la planilla y volver a importarla.
      </p>
      <button className="btn-secondary" onClick={onDescargar}>
        ↓ Descargar Excel de filas no importadas
      </button>
    </div>
  )
}

/**
 * Downloads an empty workbook shaped exactly the way the importer on this tab
 * reads it. Sits next to "Seleccionar archivo" because the moment someone
 * wonders what the file should look like is the moment they are about to pick
 * one.
 */
function BotonPlantilla({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-sm text-canal-600 hover:text-canal-700 hover:underline"
      onClick={onClick}
      title="Descarga un Excel de ejemplo con las columnas que espera el sistema"
    >
      ↓ Descargar plantilla
    </button>
  )
}

// ── Preview panels ─────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  PARCELA: 'Parcela', SITIO: 'Sitio', PEQUEÑO_PROPIETARIO: 'Pequeño Prop.'
}

function AccionistasPreviewPanel({ preview, onConfirm, onCancel }: {
  preview: {
    nuevos: AccionistaPreviewGroup[]
    actualizados: AccionistaPreviewGroup[]
    sin_socio: PropiedadSinSocio[]
  }
  onConfirm: () => void
  onCancel: () => void
}) {
  const grupos = [...preview.nuevos, ...preview.actualizados]
  const totalPropiedades = grupos.reduce((s, g) => s + g.propiedades.length, 0)
  const propiedadesBorradas = preview.actualizados.reduce((s, g) => s + g.propiedades_actuales, 0)
  const renombrados = preview.actualizados.filter(g => g.nombre_actual)
  const hasSinSocio = preview.sin_socio.length > 0

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={`card p-4 space-y-2 ${hasSinSocio ? 'border-amber-200 bg-amber-50' : 'border-green-100'}`}>
        <h3 className="font-semibold text-sm">Resumen de importación</h3>
        <div className="flex flex-wrap gap-6 text-sm">
          <span className="text-green-700 font-medium">✓ {preview.nuevos.length} accionistas nuevos</span>
          {preview.actualizados.length > 0 && (
            <span className="text-canal-700 font-medium">↻ {preview.actualizados.length} accionistas ya registrados</span>
          )}
          <span className="text-gray-700 font-medium">{totalPropiedades} propiedades en total</span>
          {hasSinSocio && (
            <span className="text-amber-700 font-medium">⚠ {preview.sin_socio.length} filas sin N° Socio (se omitirán)</span>
          )}
        </div>
        {propiedadesBorradas > 0 && (
          <p className="text-xs text-canal-700">
            A los {preview.actualizados.length} accionistas ya registrados se les borrarán sus{' '}
            {propiedadesBorradas} propiedades actuales y se registrarán las de esta planilla.
            Los accionistas que no aparecen en el archivo no se tocan.
          </p>
        )}
        {renombrados.length > 0 && (
          <p className="text-xs text-gray-500">
            {renombrados.length} accionistas tienen un nombre distinto al de la planilla. Se conserva
            el nombre ya registrado en el sistema.
          </p>
        )}
        {grupos.length === 0 && (
          <p className="text-sm text-gray-500">No hay datos que se puedan importar.</p>
        )}
      </div>

      {preview.nuevos.length > 0 && (
        <AccionistasGroupTable
          title={`Accionistas nuevos (${preview.nuevos.length})`}
          color="green"
          grupos={preview.nuevos}
        />
      )}

      {preview.actualizados.length > 0 && (
        <AccionistasGroupTable
          title={`Ya registrados — se reemplazan sus propiedades (${preview.actualizados.length})`}
          color="blue"
          grupos={preview.actualizados}
        />
      )}

      {hasSinSocio && (
        <div className="card p-3 border-amber-200">
          <p className="text-sm font-medium text-amber-700 mb-2">
            Filas sin N° Socio (no se importarán):
          </p>
          <div className="max-h-32 overflow-y-auto text-xs space-y-0.5">
            {preview.sin_socio.map((r, i) => (
              <div key={i} className="text-amber-700">• {r.hoja} fila {r.fila} — {r.nombre || '(sin propietario)'}</div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={grupos.length === 0}
          onClick={onConfirm}
        >
          Confirmar e importar {totalPropiedades > 0 ? `(${totalPropiedades} propiedades)` : ''}
        </button>
      </div>
    </div>
  )
}

/**
 * Everything that will not survive the import, stated before it happens.
 *
 * The ingresos sheet is the association's accounting record, so the number that
 * matters is not how many rows import — it is how much money does. The panel
 * leads with that reconciliation and lists every peso that falls out of it.
 */
function PagosPreviewPanel({ preview, asignaciones, onAsignar, onConfirm, onCancel }: {
  preview: {
    new_pagos: PagoPreviewRow[]
    duplicates: PagoPreviewRow[]
    duplicados_en_archivo: PagoPreviewRow[]
    missing_accionistas: PagoPreviewRow[]
    sin_coincidencia: NombreSinCoincidencia[]
    con_otros_ingresos: PagoPreviewRow[]
    total_archivo: number
    total_importable: number
    omitidas: FilaPagoOmitida[]
  }
  asignaciones: Record<string, number>
  onAsignar: (nombre: string, accionistaId: number | null) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  // What the user resolves by hand counts towards the money that will land.
  const resueltos = preview.sin_coincidencia.filter(g => asignaciones[g.nombre] !== undefined)
  const pendientes = preview.sin_coincidencia.length - resueltos.length
  const totalImportable =
    preview.total_importable + resueltos.reduce((s, g) => s + g.total, 0)
  const pagosAImportar =
    preview.new_pagos.length + resueltos.reduce((s, g) => s + g.pagos.length, 0)

  // The unreadable rows never reached the preview, so their money has to be
  // added back in for "total en el archivo" to mean what it says.
  const totalArchivo =
    preview.total_archivo + preview.omitidas.reduce((s, o) => s + o.total, 0)
  const diferencia = totalArchivo - totalImportable
  const hayProblemas =
    pendientes > 0 ||
    preview.duplicados_en_archivo.length > 0 ||
    preview.omitidas.length > 0 ||
    preview.con_otros_ingresos.length > 0

  return (
    <div className="space-y-4">
      {/* Money first: what the file says, against what would be recorded. */}
      <div className={`card p-4 space-y-3 ${hayProblemas ? 'border-red-200 bg-red-50' : 'border-green-100'}`}>
        <h3 className="font-semibold text-sm">Resumen de importación</h3>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-500">Total en el archivo</div>
            <div className="font-semibold tabular-nums">{formatCLP(totalArchivo)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Se importará</div>
            <div className="font-semibold text-green-700 tabular-nums">{formatCLP(totalImportable)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Queda fuera</div>
            <div className={`font-semibold tabular-nums ${diferencia > 0 ? 'text-red-700' : 'text-gray-400'}`}>
              {formatCLP(diferencia)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm border-t border-gray-200/70 pt-2">
          <span className="text-green-700 font-medium">✓ {pagosAImportar} pagos nuevos</span>
          {preview.duplicates.length > 0 && (
            <span className="text-amber-700">⚠ {preview.duplicates.length} ya registrados</span>
          )}
          {preview.duplicados_en_archivo.length > 0 && (
            <span className="text-red-700 font-medium">✗ {preview.duplicados_en_archivo.length} N° Ingreso repetido</span>
          )}
          {pendientes > 0 && (
            <span className="text-red-700 font-medium">✗ {pendientes} nombres sin emparejar</span>
          )}
          {resueltos.length > 0 && (
            <span className="text-canal-700 font-medium">↔ {resueltos.length} emparejados por ti</span>
          )}
          {preview.omitidas.length > 0 && (
            <span className="text-red-700 font-medium">✗ {preview.omitidas.length} filas ilegibles</span>
          )}
          {preview.con_otros_ingresos.length > 0 && (
            <span className="text-red-700 font-medium">
              ✗ {preview.con_otros_ingresos.length} con otros ingresos
            </span>
          )}
        </div>

        {diferencia > 0 && (
          <p className="text-xs text-red-700">
            La diferencia de {formatCLP(diferencia)} no quedará registrada. Corrige el archivo
            y vuelve a importarlo, o continúa sabiendo que ese monto falta.
          </p>
        )}
      </div>

      {preview.sin_coincidencia.length > 0 && (
        <EmparejarNombres
          grupos={preview.sin_coincidencia.map(g => ({
            nombre: g.nombre,
            total: g.total,
            detalle: `${g.pagos.length} ${g.pagos.length === 1 ? 'pago' : 'pagos'} · N° ${g.pagos.map(p => p.numero_ingreso).join(', ')}`,
            sugerencias: g.sugerencias
          }))}
          asignaciones={asignaciones}
          onAsignar={onAsignar}
          queNoSeImporta="esos pagos quedan fuera"
        />
      )}

      {preview.duplicados_en_archivo.length > 0 && (
        <PagosWarning
          title={`N° Ingreso repetido dentro del archivo (${preview.duplicados_en_archivo.length})`}
          tone="red"
          nota="Dos filas distintas usan el mismo N° Ingreso. Como el sistema identifica cada pago por ese número, solo se guardará el primero: revisa cuál es el correcto antes de importar."
          rows={preview.duplicados_en_archivo}
        />
      )}

      {preview.omitidas.length > 0 && (
        <div className="card p-3 border-red-200">
          <p className="text-sm font-medium text-red-700">
            Filas que no se pudieron leer ({preview.omitidas.length})
          </p>
          <p className="text-xs text-gray-600 mt-1 mb-2">
            Tienen monto pero les falta un dato obligatorio, así que no se importarán.
          </p>
          <div className="max-h-40 overflow-y-auto text-xs space-y-0.5">
            {preview.omitidas.map((r, i) => (
              <div key={i} className="text-red-600">
                • Fila {r.fila} — {MOTIVO_OMISION[r.motivo]}
                {r.numero_ingreso ? ` (N°${r.numero_ingreso})` : ''}
                {r.accionista_nombre ? ` — ${r.accionista_nombre}` : ''}
                {' · '}{formatCLP(r.total)}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.con_otros_ingresos.length > 0 && (
        <PagosWarning
          title={`Cuota extraordinaria u otros ingresos — NO se importarán (${preview.con_otros_ingresos.length})`}
          tone="red"
          nota="El sistema solo desglosa acciones y multas, así que no tiene dónde guardar estos montos. Para no registrar un total que después ninguna pantalla pueda explicar, estas filas se dejan fuera completas: anótalas y regístralas a mano. Si el monto no corresponde a un accionista (un aporte, una devolución), va como cargo o como ingreso aparte."
          rows={preview.con_otros_ingresos}
          mostrarOtros
        />
      )}

      {preview.duplicates.length > 0 && (
        <PagosWarning
          title={`Ya registrados — se omitirán (${preview.duplicates.length})`}
          tone="amber"
          nota="Ese N° Ingreso ya existe en la base de datos."
          rows={preview.duplicates}
        />
      )}

      <div className="flex gap-3">
        <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={pagosAImportar === 0}
          onClick={onConfirm}
        >
          Confirmar e importar {pagosAImportar > 0 ? `(${pagosAImportar} pagos)` : ''}
        </button>
      </div>
    </div>
  )
}

/** What EmparejarNombres needs, whichever import is asking. */
interface GrupoEmparejable {
  nombre: string
  total: number
  /** "3 pagos · N° 500, 501" — whatever identifies the rows behind this name. */
  detalle: string
  sugerencias: Sugerencia[]
}

/**
 * Resolves the names the two spreadsheets spell differently.
 *
 * The ingresos sheet writes "María Patricia Figueroa C." where the listado has
 * "MARIA PATRICIA FIGUEROA CUBILLOS", and no rule can safely tell that apart
 * from "Miguel Galdames González" versus "MIGUEL ANTONIO GALDAMEZ GONZALEZ" —
 * one is an abbreviation, the other is a different person. So the system ranks
 * candidates and the user decides; nothing is matched on a score alone.
 *
 * Grouped by name because the decision is about a person: settling one name
 * admits every payment they made.
 */
function EmparejarNombres({ grupos, asignaciones, onAsignar, queNoSeImporta }: {
  grupos: GrupoEmparejable[]
  asignaciones: Record<string, number>
  onAsignar: (nombre: string, accionistaId: number | null) => void
  /** What is lost by leaving a name unresolved, in this import's own words. */
  queNoSeImporta: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const pendientes = grupos.filter(g => asignaciones[g.nombre] === undefined)
  const totalPendiente = pendientes.reduce((s, g) => s + g.total, 0)

  return (
    <div className={`card ${pendientes.length > 0 ? 'border-red-200' : 'border-green-200'}`}>
      <button
        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium ${
          pendientes.length > 0 ? 'text-red-700' : 'text-green-700'
        }`}
        onClick={() => setCollapsed(c => !c)}
      >
        <span>
          {pendientes.length > 0
            ? `Nombres que no coinciden con ningún accionista (${pendientes.length} sin resolver)`
            : `Nombres emparejados (${grupos.length})`}
        </span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums font-normal">{formatCLP(totalPendiente)}</span>
          <span className="text-gray-400">{collapsed ? '▸' : '▾'}</span>
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-100">
          <p className="text-xs text-gray-600 px-4 py-2 bg-gray-50">
            Elige a qué accionista corresponde cada nombre del archivo. Lo que dejes
            <strong> sin emparejar no se importará</strong> ({queNoSeImporta}). Se comparan sin
            distinguir mayúsculas ni acentos, así que lo que queda aquí son diferencias reales
            de escritura («Figueroa C.» frente a «FIGUEROA CUBILLOS»).
          </p>

          <div className="max-h-[28rem] overflow-y-auto divide-y divide-gray-100">
            {grupos.map(g => {
              const elegido = asignaciones[g.nombre]
              return (
                <div key={g.nombre} className={`px-4 py-3 ${elegido !== undefined ? 'bg-green-50/50' : ''}`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{g.nombre}</div>
                      <div className="text-xs text-gray-500">{g.detalle}</div>
                    </div>
                    <div className="text-sm tabular-nums whitespace-nowrap">{formatCLP(g.total)}</div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <select
                      className="input text-sm flex-1"
                      value={elegido ?? ''}
                      onChange={e => onAsignar(g.nombre, e.target.value === '' ? null : Number(e.target.value))}
                    >
                      <option value="">— No importar —</option>
                      {g.sugerencias.map(sug => (
                        <option key={sug.accionista_id} value={sug.accionista_id}>
                          {sug.nombre}
                          {sug.numero_socio ? ` · N° socio ${sug.numero_socio}` : ''}
                          {`  (${sug.score}%)`}
                        </option>
                      ))}
                    </select>
                    {elegido !== undefined && <span className="text-green-600 text-sm">✓</span>}
                  </div>

                  {g.sugerencias.length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      Ningún accionista se parece a este nombre. Puede que no esté en el listado,
                      o que no sea un accionista (por ejemplo, un ingreso de otra fuente).
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const MOTIVO_OMISION: Record<FilaPagoOmitida['motivo'], string> = {
  sin_accionista: 'sin accionista',
  sin_numero_ingreso: 'sin N° Ingreso',
  sin_fecha: 'sin fecha válida'
}

function PagosWarning({ title, tone, nota, rows, mostrarOtros = false }: {
  title: string
  tone: 'red' | 'amber'
  nota: string
  rows: PagoPreviewRow[]
  mostrarOtros?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const border = tone === 'red' ? 'border-red-200' : 'border-amber-200'
  const text = tone === 'red' ? 'text-red-700' : 'text-amber-700'
  const total = rows.reduce((s, r) => s + (mostrarOtros ? r.otros : r.total), 0)

  return (
    <div className={`card ${border}`}>
      <button
        className={`w-full flex items-center justify-between px-4 py-2 text-sm font-medium ${text}`}
        onClick={() => setCollapsed(c => !c)}
      >
        <span>{title}</span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums font-normal">{formatCLP(total)}</span>
          <span className="text-gray-400">{collapsed ? '▸' : '▾'}</span>
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-gray-100">
          <p className="text-xs text-gray-600 px-4 py-2">{nota}</p>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-gray-500">
                  <th className="px-3 py-1.5 font-medium">Fila</th>
                  <th className="px-3 py-1.5 font-medium">N° Ingreso</th>
                  <th className="px-3 py-1.5 font-medium">Fecha</th>
                  <th className="px-3 py-1.5 font-medium">Accionista</th>
                  {mostrarOtros && <th className="px-3 py-1.5 font-medium text-right">Otros</th>}
                  <th className="px-3 py-1.5 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r, i) => (
                  <tr key={`${r.numero_ingreso}-${i}`}>
                    <td className="px-3 py-1.5 text-gray-400">{r.fila || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-600">{r.numero_ingreso}</td>
                    <td className="px-3 py-1.5 text-gray-500">{r.fecha}</td>
                    <td className="px-3 py-1.5">{r.accionista_nombre || '—'}</td>
                    {mostrarOtros && (
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatCLP(r.otros)}</td>
                    )}
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCLP(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The listado is a list of properties but the import writes accionistas, so the
 * preview shows it the way it will be stored: one block per socio, its
 * properties underneath. Seeing them grouped is the only way to catch a socio
 * number that gathers rows which do not belong together.
 */
function AccionistasGroupTable({ title, color, grupos }: {
  title: string
  color: 'green' | 'blue'
  grupos: AccionistaPreviewGroup[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  const colors = {
    green: 'text-green-700 border-green-200',
    blue: 'text-canal-700 border-canal-200'
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
        <div className="max-h-96 overflow-y-auto border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-gray-600">
                <th className="px-3 py-1.5 font-medium">N° Socio</th>
                <th className="px-3 py-1.5 font-medium">Accionista / propiedad</th>
                <th className="px-3 py-1.5 font-medium">Tipo</th>
                <th className="px-3 py-1.5 font-medium text-right">Acc.</th>
                <th className="px-3 py-1.5 font-medium text-right">Ha.</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(g => (
                <Fragment key={g.numero_socio}>
                  <tr className="border-t border-gray-200 bg-gray-50/60">
                    <td className="px-3 py-1.5 font-medium text-gray-700">{g.numero_socio}</td>
                    <td className="px-3 py-1.5 font-medium">
                      {g.nombre}
                      {g.nombre_actual && (
                        <span className="ml-1 text-gray-400 font-normal">
                          (en el sistema: {g.nombre_actual})
                        </span>
                      )}
                      {g.propiedades_actuales > 0 && (
                        <span className="ml-1 text-canal-600 font-normal">
                          · reemplaza {g.propiedades_actuales}{' '}
                          {g.propiedades_actuales === 1 ? 'propiedad' : 'propiedades'}
                        </span>
                      )}
                    </td>
                    <td />
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {g.total_acciones > 0 ? formatNumber(g.total_acciones) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {g.total_hectareas > 0 ? formatNumber(g.total_hectareas) : '—'}
                    </td>
                  </tr>
                  {g.propiedades.map((p, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td />
                      <td className="px-3 py-1 pl-6 text-gray-600">{p.nombre ?? '(sin nombre)'}</td>
                      <td className="px-3 py-1 text-gray-500">{TIPO_LABELS[p.tipo] ?? p.tipo}</td>
                      <td className="px-3 py-1 text-right text-gray-500 tabular-nums">
                        {p.acciones > 0 ? formatNumber(p.acciones) : '—'}
                      </td>
                      <td className="px-3 py-1 text-right text-gray-500 tabular-nums">
                        {p.hectareas > 0 ? formatNumber(p.hectareas) : '—'}
                      </td>
                    </tr>
                  ))}
                </Fragment>
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

/**
 * Shows what the parser understood before a single row is written. The columns
 * are guessed from header text, so seeing the amounts next to the names is the
 * only way to catch a sheet that was read the wrong way round.
 */
function DeudaInicialPreviewPanel({ preview, asignaciones, onAsignar, onConfirm, onCancel }: {
  preview: {
    new_lineas: DeudaInicialPreviewRow[]
    reemplaza: DeudaInicialPreviewRow[]
    missing_accionistas: DeudaInicialPreviewRow[]
    sin_coincidencia: DeudaSinCoincidencia[]
  }
  asignaciones: Record<string, number>
  onAsignar: (nombre: string, accionistaId: number | null) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  // Names settled by hand import too, so they count towards the totals shown.
  const resueltos = preview.sin_coincidencia.filter(g => asignaciones[g.nombre] !== undefined)
  const pendientes = preview.sin_coincidencia.length - resueltos.length
  const lineasResueltas = resueltos.flatMap(g => g.lineas)

  const importables = [...preview.new_lineas, ...preview.reemplaza, ...lineasResueltas]
  const total = importables.reduce((acc, l) => acc + l.monto, 0)
  const afectados = new Set(importables.map(l => l.numero_socio ?? l.accionista_nombre)).size
  const hasMissing = pendientes > 0

  return (
    <div className="space-y-4">
      <div className={`card p-4 space-y-2 ${hasMissing ? 'border-amber-200 bg-amber-50' : 'border-green-100'}`}>
        <h3 className="font-semibold text-sm">Resumen de importación</h3>
        <div className="flex flex-wrap gap-6 text-sm">
          <span className="text-green-700 font-medium">
            ✓ {importables.length} líneas para {afectados} accionistas
          </span>
          <span className="text-gray-700 font-medium">Total: {formatCLP(total)}</span>
          {preview.reemplaza.length > 0 && (
            <span className="text-canal-700 font-medium">
              ↻ {preview.reemplaza.length} reemplazan deuda ya registrada
            </span>
          )}
          {hasMissing && (
            <span className="text-red-700 font-medium">
              ✗ {pendientes} nombres sin emparejar
            </span>
          )}
          {resueltos.length > 0 && (
            <span className="text-canal-700 font-medium">
              ↔ {resueltos.length} emparejados por ti
            </span>
          )}
        </div>
        {preview.reemplaza.length > 0 && (
          <p className="text-xs text-canal-700">
            Para cada accionista que aparece en la planilla se borra su deuda anterior y se
            registra la de este archivo. Los accionistas que no aparecen no se tocan.
          </p>
        )}
        {importables.length === 0 && (
          <p className="text-sm text-gray-500">No hay líneas que se puedan importar.</p>
        )}
      </div>

      {preview.new_lineas.length > 0 && (
        <DeudaInicialTable title={`Deuda nueva (${preview.new_lineas.length})`} color="green" rows={preview.new_lineas} />
      )}
      {preview.reemplaza.length > 0 && (
        <DeudaInicialTable title={`Reemplazan deuda existente (${preview.reemplaza.length})`} color="blue" rows={preview.reemplaza} />
      )}
      {preview.sin_coincidencia.length > 0 && (
        <EmparejarNombres
          grupos={preview.sin_coincidencia.map(g => ({
            nombre: g.nombre,
            total: g.total,
            detalle: `${g.lineas.length} ${g.lineas.length === 1 ? 'línea' : 'líneas'} · ${
              [...new Set(g.lineas.map(l => DEUDA_TIPO_LABELS[l.tipo]))].join(' + ')
            } · fila ${g.lineas.map(l => l.fila).join(', ')}`,
            sugerencias: g.sugerencias
          }))}
          asignaciones={asignaciones}
          onAsignar={onAsignar}
          queNoSeImporta="esa deuda no queda registrada"
        />
      )}

      <div className="flex gap-3">
        <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
        <button className="btn-primary" onClick={onConfirm} disabled={importables.length === 0}>
          Confirmar importación
        </button>
      </div>
    </div>
  )
}

function DeudaInicialTable({ title, color, rows }: {
  title: string
  color: 'green' | 'blue' | 'amber'
  rows: DeudaInicialPreviewRow[]
}) {
  const [collapsed, setCollapsed] = useState(false)
  const border = { green: 'border-green-200', blue: 'border-canal-200', amber: 'border-amber-200' }[color]

  return (
    <div className={`card ${border}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-gray-700"
        onClick={() => setCollapsed(c => !c)}
      >
        <span>{title}</span>
        <span className="text-gray-400">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="max-h-80 overflow-y-auto border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-1.5 font-medium">Fila</th>
                <th className="px-3 py-1.5 font-medium">N° socio</th>
                <th className="px-3 py-1.5 font-medium">Accionista</th>
                <th className="px-3 py-1.5 font-medium">Concepto</th>
                <th className="px-3 py-1.5 font-medium">Tipo</th>
                <th className="px-3 py-1.5 font-medium text-right">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r, i) => (
                <tr key={`${r.fila}-${r.tipo}-${i}`}>
                  <td className="px-3 py-1.5 text-gray-400">{r.fila}</td>
                  <td className="px-3 py-1.5 text-gray-500">
                    {r.numero_socio ?? '—'}
                    {r.matched_by === 'nombre' && (
                      <span className="ml-1 text-amber-600" title="Se encontró por nombre, no por N° socio">·</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{r.accionista_nombre}</td>
                  <td className="px-3 py-1.5 text-gray-600">{r.concepto}</td>
                  <td className="px-3 py-1.5 text-gray-500">{DEUDA_TIPO_LABELS[r.tipo]}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatCLP(r.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
