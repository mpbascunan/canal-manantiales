import * as XLSX from 'xlsx'
import type { TipoDeudaInicial } from '../../../shared/types'
import type { FilaPagoOmitida, RawPago } from './importParser'
import { DEUDA_TIPO_LABELS } from './labels'

/**
 * The workbook handed back after an import: every row that did not make it in,
 * with the reason and what to do about it.
 *
 * The preview says the same things on screen, but the screen closes. What is
 * left over is a worklist — payments to type in by hand, names to fix in the
 * spreadsheet, receipt numbers to check — and a worklist is only useful if you
 * can keep it open next to the file you are correcting.
 */

/** What every rejected row has, whichever import produced it. */
interface FilaBase {
  fila: number
  motivo: string
  accion: string
  /** The money at stake, for the per-motivo summary. */
  monto: number
}

interface Columna<T> {
  header: string
  width: number
  value: (f: T) => string | number | null
}

/**
 * Writes the report: a summary per motivo, then one row per rejection ordered by
 * its line in the original file, so the two can be read side by side.
 *
 * `yaExplicado` decides which of the import's own error messages the detail
 * sheet already covers. Without it every rejection would appear twice — once as
 * a row and once as an "error" — turning 143 problems into 286.
 */
function construirWorkbook<T extends FilaBase>(
  titulo: string,
  filas: T[],
  columnas: Columna<T>[],
  errores: string[],
  yaExplicado: (mensaje: string) => boolean
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  const porMotivo = new Map<string, { n: number; monto: number }>()
  for (const f of filas) {
    const acc = porMotivo.get(f.motivo) ?? { n: 0, monto: 0 }
    acc.n++; acc.monto += f.monto
    porMotivo.set(f.motivo, acc)
  }

  const data: (string | number | null)[][] = [
    [titulo],
    [],
    ['Motivo', 'Filas', 'Monto'],
    ...[...porMotivo].map(([motivo, x]) => [motivo, x.n, x.monto]),
    ['TOTAL', filas.length, filas.reduce((s, f) => s + f.monto, 0)],
    [],
    ['Fila', 'Motivo', ...columnas.map(c => c.header), 'Qué hacer'],
    ...filas.map(f => [f.fila, f.motivo, ...columnas.map(c => c.value(f)), f.accion])
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [8, 34, ...columnas.map(c => c.width), 80].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'No importadas')

  const inesperados = errores.filter(e => !yaExplicado(e))
  if (inesperados.length > 0) {
    const wsErr = XLSX.utils.aoa_to_sheet([
      ['ERRORES INESPERADOS DEL SISTEMA'],
      ['Estas filas fallaron por un motivo distinto a los de la hoja anterior.'],
      [],
      ...inesperados.map(e => [e])
    ])
    wsErr['!cols'] = [120].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, wsErr, 'Errores')
  }

  return wb
}

function descargar(wb: XLSX.WorkBook, prefijo: string, temporadaNombre: string): void {
  XLSX.writeFile(wb, `${prefijo}_${temporadaNombre.replace(/\s+/g, '_')}.xlsx`)
}

// ── Pagos ─────────────────────────────────────────────────────────────────────

export interface FilaNoImportada extends FilaBase {
  numero_ingreso: number | null
  fecha: string
  numero_socio: string | null
  accionista_nombre: string
  monto_acciones: number
  multas: number
  otros: number
  total: number
}

export interface PagoRechazado {
  numero_ingreso: number
  fecha: string
  accionista_nombre: string
  total: number
  fila: number
  otros: number
  numero_socio: string | null
}

/** The shape the preview hands over — declared structurally so this module does
 *  not depend on the main process's IPC types. */
export interface ResumenNoImportado {
  omitidas: FilaPagoOmitida[]
  con_otros_ingresos: PagoRechazado[]
  duplicados_en_archivo: PagoRechazado[]
  duplicates: PagoRechazado[]
  sin_coincidencia: { nombre: string; pagos: PagoRechazado[] }[]
  /** Names the user resolved by hand — those did import, so they are excluded. */
  asignaciones: Record<string, number>
  /** The parsed rows, for the amounts the preview does not carry. */
  rows: RawPago[]
  errores: string[]
}

const MOTIVO_OMISION: Record<FilaPagoOmitida['motivo'], { motivo: string; accion: string }> = {
  sin_accionista: {
    motivo: 'Sin accionista',
    accion: 'La fila tiene monto pero la celda del accionista está vacía. Averigua de quién es el pago y regístralo a mano.'
  },
  sin_numero_ingreso: {
    motivo: 'Sin N° Ingreso',
    accion: 'Falta el número de ingreso, que es lo que identifica el pago. Búscalo en el comprobante y regístralo a mano.'
  },
  sin_fecha: {
    motivo: 'Sin fecha válida',
    accion: 'La fecha no se pudo leer. Corrígela en la planilla y vuelve a importar.'
  }
}

export function armarNoImportados(d: ResumenNoImportado): FilaNoImportada[] {
  const porFila = new Map(d.rows.map(r => [r.fila, r]))

  const desde = (p: PagoRechazado, motivo: string, accion: string): FilaNoImportada => {
    const raw = porFila.get(p.fila)
    return {
      motivo, accion,
      fila: p.fila,
      numero_ingreso: p.numero_ingreso,
      fecha: p.fecha,
      numero_socio: p.numero_socio,
      accionista_nombre: p.accionista_nombre,
      monto_acciones: raw?.monto_acciones ?? 0,
      multas: raw?.multas ?? 0,
      otros: p.otros,
      total: p.total,
      monto: p.total
    }
  }

  const filas: FilaNoImportada[] = [
    ...d.omitidas.map(o => ({
      motivo: MOTIVO_OMISION[o.motivo].motivo,
      accion: MOTIVO_OMISION[o.motivo].accion,
      fila: o.fila,
      numero_ingreso: o.numero_ingreso,
      fecha: '',
      numero_socio: null,
      accionista_nombre: o.accionista_nombre,
      monto_acciones: 0,
      multas: 0,
      otros: 0,
      total: o.total,
      monto: o.total
    })),

    ...d.con_otros_ingresos.map(p => desde(p,
      'Cuota extraordinaria u otros ingresos',
      'El sistema solo desglosa acciones y multas, así que no puede guardar este monto. Regístralo a mano; si no corresponde a un accionista, va como cargo o como ingreso aparte.')),

    ...d.duplicados_en_archivo.map(p => desde(p,
      'N° Ingreso repetido en el archivo',
      'Otra fila de la misma planilla usa este mismo N° Ingreso. Revisa cuál es el correcto, corrígelo y vuelve a importar.')),

    ...d.duplicates.map(p => desde(p,
      'Ya estaba registrado',
      'Ese N° Ingreso ya existe en el sistema. No se hizo nada; verifica que sea el mismo pago.')),

    // Only the names left unresolved: the ones matched by hand did import.
    ...d.sin_coincidencia
      .filter(g => d.asignaciones[g.nombre] === undefined)
      .flatMap(g => g.pagos.map(p => desde(p,
        'Accionista no encontrado',
        `Ningún accionista registrado coincide con "${g.nombre}". Corrige el nombre en la planilla, agrega la columna N° Socio, o vuelve a importar y emparéjalo en la vista previa.`)))
  ]

  return filas.sort((a, b) => a.fila - b.fila)
}

const COLUMNAS_PAGOS: Columna<FilaNoImportada>[] = [
  { header: 'N° Ingreso',     width: 12, value: f => f.numero_ingreso },
  { header: 'Fecha',          width: 12, value: f => f.fecha },
  { header: 'N° Socio',       width: 10, value: f => f.numero_socio },
  { header: 'Accionista',     width: 34, value: f => f.accionista_nombre },
  { header: 'Monto Acciones', width: 16, value: f => f.monto_acciones || null },
  { header: 'Multas',         width: 12, value: f => f.multas || null },
  { header: 'Otros',          width: 14, value: f => f.otros || null },
  { header: 'Total',          width: 14, value: f => f.total }
]

export function buildNoImportadosWorkbook(
  d: ResumenNoImportado,
  temporadaNombre: string
): XLSX.WorkBook {
  const filas = armarNoImportados(d)
  // A payment is identified in error messages by its receipt number.
  const explicados = new Set(filas.map(f => f.numero_ingreso).filter(Boolean))
  return construirWorkbook(
    `FILAS NO IMPORTADAS — ${temporadaNombre}`,
    filas, COLUMNAS_PAGOS, d.errores,
    e => [...e.matchAll(/N°\s*(\d+)/g)].some(m => explicados.has(Number(m[1])))
  )
}

export function descargarNoImportados(d: ResumenNoImportado, temporadaNombre: string): void {
  descargar(buildNoImportadosWorkbook(d, temporadaNombre), 'No_importadas', temporadaNombre)
}

// ── Deuda anterior ────────────────────────────────────────────────────────────

export interface LineaDeudaRechazada {
  fila: number
  numero_socio: string | null
  accionista_nombre: string
  concepto: string
  tipo: TipoDeudaInicial
  monto: number
}

export interface ResumenDeudaNoImportada {
  sin_coincidencia: { nombre: string; lineas: LineaDeudaRechazada[] }[]
  asignaciones: Record<string, number>
  errores: string[]
}

export interface FilaDeudaNoImportada extends FilaBase {
  numero_socio: string | null
  accionista_nombre: string
  concepto: string
  tipo: string
}

export function armarDeudaNoImportada(d: ResumenDeudaNoImportada): FilaDeudaNoImportada[] {
  return d.sin_coincidencia
    .filter(g => d.asignaciones[g.nombre] === undefined)
    .flatMap(g => g.lineas.map(l => ({
      fila: l.fila,
      motivo: 'Accionista no encontrado',
      accion: `Ningún accionista registrado coincide con "${g.nombre}". Corrige el nombre en la planilla, agrega la columna N° Socio, o vuelve a importar y emparéjalo en la vista previa.`,
      numero_socio: l.numero_socio,
      accionista_nombre: l.accionista_nombre,
      concepto: l.concepto,
      tipo: DEUDA_TIPO_LABELS[l.tipo],
      monto: l.monto
    })))
    .sort((a, b) => a.fila - b.fila)
}

const COLUMNAS_DEUDA: Columna<FilaDeudaNoImportada>[] = [
  { header: 'N° Socio',   width: 10, value: f => f.numero_socio },
  { header: 'Accionista', width: 34, value: f => f.accionista_nombre },
  { header: 'Concepto',   width: 34, value: f => f.concepto },
  { header: 'Tipo',       width: 10, value: f => f.tipo },
  { header: 'Monto',      width: 14, value: f => f.monto }
]

export function buildDeudaNoImportadaWorkbook(d: ResumenDeudaNoImportada): XLSX.WorkBook {
  const filas = armarDeudaNoImportada(d)
  // Deuda errors name the spreadsheet row: "Fila 9: no se encontró...".
  const explicadas = new Set(filas.map(f => f.fila))
  return construirWorkbook(
    'DEUDA ANTERIOR NO IMPORTADA',
    filas, COLUMNAS_DEUDA, d.errores,
    e => [...e.matchAll(/Fila\s*(\d+)/gi)].some(m => explicadas.has(Number(m[1])))
  )
}

export function descargarDeudaNoImportada(d: ResumenDeudaNoImportada): void {
  descargar(buildDeudaNoImportadaWorkbook(d), 'Deuda_anterior', 'no_importada')
}
