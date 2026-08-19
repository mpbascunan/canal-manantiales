import * as XLSX from 'xlsx'
import type { AccionistaType, TipoDeudaInicial } from '../../../shared/types'
import { normalizarTemporadasAdeudadas } from '../../../shared/deuda'
import { DEUDA_TIPO_CONCEPTO } from './labels'

/**
 * One property line off the association's "Listado de Accionistas" workbook.
 *
 * The sheet is a list of *properties*, not of people: an accionista with four
 * parcelas occupies four rows, all repeating the same `N° Socio`. Grouping them
 * into accionistas happens in the main process, so the preview and the import
 * agree on what a person is.
 */
export interface RawPropiedad {
  /** `N° Socio` — the association's own identifier, and the only match key. */
  numero_socio: string | null
  /** Owner as typed on this row; spellings vary between rows of one socio. */
  nombre: string
  tipo: AccionistaType
  /** `Predio` / `Nombre propiedad`, e.g. "Parcela N°8 Lote A-2". */
  nombre_propiedad: string | null
  acciones: number
  hectareas: number
  /** Where the row came from, so the preview can point at what it skipped. */
  hoja: string
  fila: number
}

export interface RawPago {
  fecha: string
  numero_ingreso: number
  /**
   * `N° Socio`, when the sheet carries the column. Preferred over the name for
   * exactly the reason the listado uses it: the association assigns it, so it
   * identifies a person outright where spellings never agree between files.
   */
  numero_socio: string | null
  accionista_nombre: string
  temporadas_pagadas: number
  monto_acciones: number
  multas: number
  total: number
  /**
   * `Cuota extraordinaria` + `Otros ingresos`. The system has nowhere to record
   * these, but they are part of the row's TOTAL, so they are read in order to
   * show that `total` is more than `monto_acciones + multas` rather than let the
   * difference disappear.
   */
  otros: number
  fila: number
}

/**
 * A row that looked like a payment but could not be read as one.
 *
 * Kept rather than dropped: the ingresos sheet is the accounting record, so a
 * line quietly skipped is money that vanishes between the spreadsheet and the
 * system with nothing on screen to say so.
 */
export interface FilaPagoOmitida {
  fila: number
  motivo: 'sin_accionista' | 'sin_numero_ingreso' | 'sin_fecha'
  numero_ingreso: number | null
  accionista_nombre: string
  total: number
}

export interface PagosParseResult {
  pagos: RawPago[]
  omitidas: FilaPagoOmitida[]
}

/** One `deuda_inicial` line read off a spreadsheet, before it is matched to an accionista. */
export interface RawDeudaInicial {
  /** Preferred match key — assigned by the association, so unambiguous. */
  numero_socio: string | null
  accionista_nombre: string
  concepto: string
  tipo: TipoDeudaInicial
  monto: number
  /** How many seasons the row says the debt covers; `null` when the sheet is silent. */
  temporadas_adeudadas: number | null
  /** 1-based row in the sheet, so the preview can point at what it could not read. */
  fila: number
}

function toIso(v: any): string {
  if (!v) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    // Excel date serial
    const d = XLSX.SSF.parse_date_code(v)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`
  }
  const s = String(v)
  // Try dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return s.slice(0, 10)
}

function toNum(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function cleanName(v: any): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ')
}


/** A run this long of blank rows ends a sheet. */
const BLANK_ROW_RUN = 50

/**
 * The range that actually holds cells.
 *
 * A sheet's declared `!ref` is not to be trusted — the SITIOS sheet of the 2025
 * listado claims all 1,048,576 rows, and reading it verbatim builds a million
 * empty arrays before the first name is seen. The real cells are enumerable, so
 * the last row is taken from them instead.
 */
function usedRange(ws: XLSX.WorkSheet): XLSX.Range | undefined {
  const ref = ws['!ref']
  if (!ref) return undefined
  const range = XLSX.utils.decode_range(ref)
  let last = range.s.r
  for (const key of Object.keys(ws)) {
    if (key.charCodeAt(0) === 33 /* ! */) continue
    const r = XLSX.utils.decode_cell(key).r
    if (r > last) last = r
  }
  range.e.r = Math.min(range.e.r, last)
  return range
}

/** True when the `Unidad` cell (or a column header) means hectáreas. */
function isHectareas(v: any): boolean {
  return /hect[aá]rea/i.test(String(v ?? ''))
}

/**
 * Reads the "Listado de Accionistas" workbook: one row per property, spread over
 * the PARCELAS, SITIOS and PEQUEÑOS PROPIETARIOS sheets (anything else, such as
 * the RESUMEN sheet, is ignored).
 *
 * Columns are found by header text, not position. The one that needs care is the
 * amount: a single column holds either acciones or hectáreas, and the `Unidad`
 * column next to it says which — pequeños propietarios are measured in hectáreas
 * and a few sitios are too, so reading it as acciones would bill them as water
 * shares.
 */
export function parsePropiedades(buffer: ArrayBuffer): RawPropiedad[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const results: RawPropiedad[] = []

  const sheetTypeMap: Record<string, AccionistaType> = {
    'PARCELAS': 'PARCELA',
    'SITIOS': 'SITIO',
    'PEQUEÑOS PROPIETARIOS': 'PEQUEÑO_PROPIETARIO'
  }

  for (const sheetName of wb.SheetNames) {
    const tipo = sheetTypeMap[sheetName.toUpperCase().trim()]
    if (!tipo) continue

    const ws = wb.Sheets[sheetName]
    const range = usedRange(ws)
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      range
    })
    // Row numbers are reported as the spreadsheet shows them, so a preview
    // pointing at "fila 12" means the twelfth row of the sheet.
    const filaOffset = (range?.s.r ?? 0) + 1

    // Header row = one naming the owner column *and* an amount or socio column.
    // Naming the owner alone is not enough: a sheet may open with a title like
    // "LISTADO DE ACCIONISTAS 2025-2026", which would otherwise be read as the
    // header and turn the real header into a data row.
    const isOwnerHeader = (v: any): boolean =>
      /propietario|accionista|raz[oó]n social/i.test(String(v ?? ''))
    const isAmountHeader = (v: any): boolean => {
      const h = String(v ?? '').toLowerCase().trim()
      return h === 'acciones' || /^hect[aá]reas$/.test(h) || /socio/.test(h)
    }

    let headerIdx = -1
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i] ?? []
      if (row.some(isOwnerHeader) && row.some(isAmountHeader)) {
        headerIdx = i
        break
      }
    }
    if (headerIdx < 0) continue

    const header = rows[headerIdx].map(v => String(v ?? '').toLowerCase().trim())
    const iNombre = header.findIndex(h => /propietario|accionista|raz[oó]n social/.test(h))
    const iSocio  = header.findIndex(h => /socio/.test(h))
    // Both spellings appear: "Predio" on two sheets, "Nombre propiedad" on the third.
    const iPredio = header.findIndex(h => /^predio|nombre\s+propiedad/.test(h))
    const iUnidad = header.findIndex(h => h === 'unidad')
    const iValor  = header.findIndex(h => h === 'acciones' || /^hect[aá]reas$/.test(h))

    let blankRun = 0

    for (let i = headerIdx + 1; i < rows.length && blankRun < BLANK_ROW_RUN; i++) {
      const row = rows[i] ?? []
      if (!row.some(v => v !== null && v !== '')) { blankRun++; continue }
      blankRun = 0

      const nombre = cleanName(row[iNombre])
      if (!nombre || nombre.toUpperCase() === 'TOTALES') continue
      // Repeated section headers inside the sheet.
      if (/^temporada|^valor acción/i.test(nombre)) continue

      // The unit is per row; the column header is the fallback for sheets that
      // do not carry a Unidad column at all.
      const enHectareas = iUnidad >= 0
        ? isHectareas(row[iUnidad])
        : isHectareas(iValor >= 0 ? header[iValor] : '')
      const valor = iValor >= 0 ? toNum(row[iValor]) : 0

      results.push({
        numero_socio: iSocio >= 0 ? String(row[iSocio] ?? '').trim() || null : null,
        nombre,
        tipo,
        nombre_propiedad: iPredio >= 0 ? cleanName(row[iPredio]) || null : null,
        acciones:  enHectareas ? 0 : valor,
        hectareas: enHectareas ? valor : 0,
        hoja: sheetName,
        fila: i + filaOffset
      })
    }
  }

  return results
}

/** Subtotal and decorative rows, which are not payments and are not reported. */
const NO_ES_PAGO = /^\s*(totales?|resumen|mes\s*:|temporada|valor acci[oó]n)/i

/**
 * Reads the ingresos workbook: the association's month-by-month record of money
 * received.
 *
 * The sheet is not a table. It repeats a header for every month, carries a
 * separate summary block in the columns to the right, and ends with a DEUDORES
 * listing whose rows look exactly like payments minus the date. So the columns
 * are re-read at each header, the deudores heading stops the scan wherever it
 * appears, and any row that looks like a payment but cannot be read as one is
 * returned in `omitidas` — never dropped on the floor, because every one of them
 * is money that would otherwise disappear between the spreadsheet and the system.
 */
export function parsePagos(buffer: ArrayBuffer): PagosParseResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const range = usedRange(ws)
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, range })
  const filaOffset = (range?.s.r ?? 0) + 1

  const pagos: RawPago[] = []
  const omitidas: FilaPagoOmitida[] = []

  let inSection = false
  let colFecha = -1, colIngreso = -1, colAcc = -1, colTemps = -1,
      colMonto = -1, colMultas = -1, colTotal = -1, colSocio = -1
  const colsOtros: number[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? []
    const fila = i + filaOffset

    // The deudores listing repeats the payment columns but is a list of what is
    // owed, not received. Its heading may sit in any column, so the whole row is
    // checked — matching only the accionista column let all 92 rows through.
    if (row.some(v => /^\s*deudores\b/i.test(String(v ?? '')))) break

    // Every month restarts with its own header row.
    if (row.some(v => /^fecha$/i.test(String(v ?? '').trim()))) {
      const h = row.map(v => String(v ?? '').toLowerCase().trim())
      colFecha   = h.findIndex(v => v === 'fecha')
      colIngreso = h.findIndex(v => /ingreso/.test(v) && !/otros/.test(v))
      colSocio   = h.findIndex(v => /socio/.test(v))
      colAcc     = h.findIndex(v => /accionista/.test(v))
      colTemps   = h.findIndex(v => /temporadas/.test(v) && !/monto/.test(v))
      colMonto   = h.findIndex(v => /monto/.test(v))
      colMultas  = h.findIndex(v => v === 'multas')
      colTotal   = h.findIndex(v => v === 'total')
      // Bounded by the payment block's own TOTAL column: the summary block to
      // the right repeats "CUOTA EXTRAORDINARIA" and "OTROS INGRESOS" as its own
      // headers, on the very same rows, and counting those too doubled the
      // amount read off every line that had one.
      colsOtros.length = 0
      h.forEach((v, idx) => {
        if (colTotal >= 0 && idx >= colTotal) return
        if (/cuota extraordinaria|otros ingresos/.test(v)) colsOtros.push(idx)
      })
      inSection = true
      continue
    }

    if (!inSection) continue
    if (NO_ES_PAGO.test(String(row[0] ?? ''))) continue

    const fecha = row[colFecha]
    const numIngreso = row[colIngreso]
    const accionistaNombre = row[colAcc]
    const total = toNum(row[colTotal])
    const otros = colsOtros.reduce((s, idx) => s + toNum(row[idx]), 0)

    // Anything carrying money, or stamped with a receipt number, is a payment
    // line: if it cannot be read, that is worth saying out loud. Everything else
    // is spacing and formatting.
    const esFilaDePago = total !== 0 || Boolean(numIngreso)
    if (!esFilaDePago) continue

    const isoFecha = toIso(fecha)
    const nombre = cleanName(accionistaNombre)

    const motivo: FilaPagoOmitida['motivo'] | null =
      !nombre                            ? 'sin_accionista'
      : !numIngreso                      ? 'sin_numero_ingreso'
      : !isoFecha || isoFecha.length < 8 ? 'sin_fecha'
      : null

    if (motivo) {
      omitidas.push({
        fila,
        motivo,
        numero_ingreso: numIngreso ? toNum(numIngreso) : null,
        accionista_nombre: nombre,
        total
      })
      continue
    }

    pagos.push({
      fecha: isoFecha,
      numero_ingreso: toNum(numIngreso),
      numero_socio: colSocio >= 0 ? String(row[colSocio] ?? '').trim() || null : null,
      accionista_nombre: nombre,
      temporadas_pagadas: toNum(row[colTemps]) || 1,
      monto_acciones: toNum(row[colMonto]),
      multas: toNum(row[colMultas]),
      total,
      otros,
      fila
    })
  }

  return { pagos, omitidas }
}

/**
 * Reads opening balances (context.md D14) off a spreadsheet.
 *
 * Two layouts are accepted, because the administration's file may be either:
 *
 *   1. One row per accionista, with `cuota`, `otro` and `multa` columns — each
 *      non-zero amount becomes its own line.
 *   2. One row per line, with a single `monto` column and a `tipo` column
 *      saying whether it is a cuota or a multa.
 *
 * Columns are matched by header text rather than position, since nobody is
 * going to keep the column order stable. Anything unreadable is skipped here and
 * reported by the preview, never guessed at.
 */
/**
 * True for a header that announces a *count of seasons*, not a concepto that
 * happens to mention them.
 *
 * The distinction matters because the concepto column is free text and is often
 * titled something like "Deuda temporadas anteriores": read as a count it would
 * shadow the real column and contribute nothing but nulls. So the header has to
 * be the count and little else — optionally prefixed by N°/cantidad, optionally
 * qualified as adeudadas/impagas.
 */
function esColumnaTemporadas(v: string): boolean {
  return /^(n[°ºo.]?|nro\.?|num\.?|cant\.?|cantidad)?\s*(de\s+)?temporadas?(\s+(adeudadas?|impagas?|pendientes?|atrasadas?|debidas?))?$/
    .test(v)
}

export function parseDeudaInicial(buffer: ArrayBuffer): RawDeudaInicial[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  let colSocio = -1, colNombre = -1, colConcepto = -1, colTipo = -1
  let colMonto = -1, colMulta = -1, colCuota = -1, colOtro = -1, colTemporadas = -1
  let headerRow = -1

  for (let i = 0; i < rows.length; i++) {
    const h = (rows[i] ?? []).map(v => String(v ?? '').toLowerCase().trim())
    const nombreAt = h.findIndex(v => /accionista|nombre/.test(v))
    if (nombreAt === -1) continue

    colNombre   = nombreAt
    colSocio    = h.findIndex(v => /socio/.test(v))
    colConcepto = h.findIndex(v => /concepto|detalle|glosa|descripcion|descripción/.test(v))
    colTipo     = h.findIndex(v => v === 'tipo')
    // "monto multa" must not also register as the generic monto column.
    colMulta    = h.findIndex(v => /multa/.test(v))
    colCuota    = h.findIndex(v => /cuota/.test(v))
    colOtro     = h.findIndex(v => /^otros?\b/.test(v))
    colMonto    = h.findIndex(v =>
      /^(monto|total|deuda|saldo)/.test(v) && !/multa|cuota|otros?/.test(v))
    colTemporadas = h.findIndex(esColumnaTemporadas)
    headerRow   = i
    break
  }

  if (headerRow === -1) return []

  const results: RawDeudaInicial[] = []

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const nombre = cleanName(row[colNombre])
    if (!nombre) continue
    if (/^(totales?|deudores?)$/i.test(nombre)) break

    const socio = colSocio === -1 ? null : String(row[colSocio] ?? '').trim() || null
    const conceptoCell = colConcepto === -1 ? '' : cleanName(row[colConcepto])
    const fila = i + 1
    // A row's season count describes the row, so every line it produces carries
    // it: a person four seasons behind owes four seasons of cuota *and* of multa,
    // and the sheet states the span once for both. Purely descriptive either way
    // — nothing prices a line off it (D14).
    const temporadas =
      colTemporadas === -1 ? null : normalizarTemporadasAdeudadas(row[colTemporadas])

    const push = (tipo: TipoDeudaInicial, monto: number, fallback: string): void => {
      if (monto <= 0) return
      results.push({
        numero_socio: socio,
        accionista_nombre: nombre,
        concepto: conceptoCell || fallback,
        tipo,
        monto: Math.round(monto),
        temporadas_adeudadas: temporadas,
        fila
      })
    }

    // Layout 2 — a single amount, typed by a `tipo` column. Anything the column
    // does not name as a cuota or an otro is a multa, as it always was.
    if (colMonto !== -1 && colMulta === -1 && colCuota === -1 && colOtro === -1) {
      const declarado = colTipo === -1 ? '' : String(row[colTipo] ?? '').toUpperCase()
      const tipo: TipoDeudaInicial =
        declarado.includes('CUOTA') ? 'CUOTA'
        : declarado.includes('OTRO') ? 'OTRO'
        : 'MULTA'
      push(tipo, toNum(row[colMonto]), DEUDA_TIPO_CONCEPTO[tipo])
      continue
    }

    // Layout 1 — separate columns, each becoming its own line.
    if (colCuota !== -1) push('CUOTA', toNum(row[colCuota]), DEUDA_TIPO_CONCEPTO.CUOTA)
    if (colOtro  !== -1) push('OTRO',  toNum(row[colOtro]),  DEUDA_TIPO_CONCEPTO.OTRO)
    if (colMulta !== -1) push('MULTA', toNum(row[colMulta]), DEUDA_TIPO_CONCEPTO.MULTA)
  }

  return results
}
