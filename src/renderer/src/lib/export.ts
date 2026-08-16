import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCLP, formatFecha, mesNombre, formatNumber } from './formulas'
import type { Pago, ResumenMensual, ResumenContable, Temporada, Accionista, Propiedad, AccionistaType, CargoResumen } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'
import { DEUDA_TIPO_LABELS } from './labels'
import type { DeudaPorTemporada, TemporadaBreakdown } from '../../../shared/deuda'

// ── Excel exports ────────────────────────────────────────────────────────────

export function exportPagosMes(pagos: Pago[], year: number, month: number): void {
  const mes = mesNombre(month).toUpperCase()
  const headers = ['Fecha', 'N° Ingreso', 'Accionista',
                   'N° Temporadas', 'Monto Acciones', 'Multas', 'Total']
  const rows = pagos.map(p => [
    formatFecha(p.fecha), p.numero_ingreso, p.accionista_nombre,
    p.temporadas_pagadas,
    p.monto_acciones, p.multas, p.total
  ])
  const totals = ['TOTALES', '', '', '',
    pagos.reduce((s, p) => s + p.monto_acciones, 0),
    pagos.reduce((s, p) => s + p.multas, 0),
    pagos.reduce((s, p) => s + p.total, 0)
  ]

  const wb = XLSX.utils.book_new()
  const wsData = [[`MES: ${mes} ${year}`], headers, ...rows, totals]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [14, 10, 30, 12, 16, 12, 14].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws, `${mes} ${year}`)
  XLSX.writeFile(wb, `Pagos_${mes}_${year}.xlsx`)
}

// Cargos named "Multa..." count as multa income; the rest get their own row
function splitCargosMulta(cargos: CargoResumen[]): { multaCargos: CargoResumen[]; otrosCargos: CargoResumen[] } {
  return {
    multaCargos: cargos.filter(c => /multa/i.test(c.nombre)),
    otrosCargos: cargos.filter(c => !/multa/i.test(c.nombre))
  }
}

export function exportResumenContable(
  resumen: ResumenContable,
  mensual: ResumenMensual[],
  temporada: Temporada,
  cargos: CargoResumen[] = []
): void {
  const wb = XLSX.utils.book_new()

  const { multaCargos, otrosCargos } = splitCargosMulta(cargos)
  const ingresoMultas = resumen.multas + multaCargos.reduce((s, c) => s + c.total_cobrado, 0)
  const totalConCargos = resumen.total + cargos.reduce((s, c) => s + c.total_cobrado, 0)

  const data: any[][] = [
    [`RESUMEN INGRESOS TEMPORADA ${temporada.nombre}`],
    [],
    ['CUENTA', 'MONTO'],
    ['Ingreso por Cuota Acciones', resumen.monto_acciones],
    ['Ingresos por Multas', ingresoMultas],
    ...otrosCargos.map(c => [c.nombre, c.total_cobrado]),
    ['TOTAL', totalConCargos],
    [],
    ['CANCELACIONES MENSUALES'],
    ['Mes', 'Monto Acciones', 'Multas', 'Total'],
    ...mensual.map(m => [
      mesNombre(m.mes).toUpperCase(),
      m.monto_acciones, m.multas, m.total
    ])
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [30, 16, 16, 16, 16, 16].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws, 'Resumen')
  XLSX.writeFile(wb, `Resumen_${temporada.nombre}.xlsx`)
}

/**
 * One deudor exactly as the Deudores table shows them, already reduced to the
 * temporada in scope. The page does that reduction, so the spreadsheet and the
 * screen can never disagree about what a season's figures are.
 */
export interface DeudorExportRow {
  nombre: string
  nombres_propiedades: string | null
  acciones: number
  hectareas: number
  temporadas: number
  cuotas: number
  cargos: number
  multas: number
  abonado: number
  pendiente: number
}

/** `periodo` labels the scope — a temporada name, or "Todas las temporadas". */
export function exportDeudores(deudores: DeudorExportRow[], periodo: string): void {
  const wb = XLSX.utils.book_new()
  const headers = ['Accionista', 'Propiedades', 'Acciones', 'Hectáreas', 'N° Temporadas',
                   'Cuotas', 'Cargos', 'Multas', 'Abonado', 'Pendiente']
  const rows = deudores.map(d => [
    d.nombre, d.nombres_propiedades ?? '',
    d.acciones || '', d.hectareas || '',
    d.temporadas, d.cuotas, d.cargos, d.multas, d.abonado, d.pendiente
  ])
  const sum = (pick: (d: DeudorExportRow) => number): number =>
    deudores.reduce((s, d) => s + pick(d), 0)
  const totals = ['TOTALES', '', '', '', '',
    sum(d => d.cuotas), sum(d => d.cargos), sum(d => d.multas),
    sum(d => d.abonado), sum(d => d.pendiente)
  ]
  const wsData = [[`DEUDORES ${periodo.toUpperCase()}`], headers, ...rows, totals]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [30, 36, 10, 10, 12, 14, 12, 12, 12, 14].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws, 'Deudores')
  XLSX.writeFile(wb, `Deudores_${periodo.replace(/[^\w-]+/g, '_')}.xlsx`)
}

// ── PDF exports ───────────────────────────────────────────────────────────────

const INSTITUTION = 'COM. DE AGUA DE RIEGO CANAL RINC. DE MANANTIALES'

function newPdf(): jsPDF {
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
}

export function exportPagosMesPdf(pagos: Pago[], year: number, month: number): void {
  const doc = newPdf()
  const mes = mesNombre(month).toUpperCase()
  doc.setFontSize(11).setFont('helvetica', 'bold')
  doc.text(INSTITUTION, 105, 14, { align: 'center' })
  doc.setFontSize(10).setFont('helvetica', 'normal')
  doc.text(`INGRESOS MES ${mes} ${year}`, 105, 20, { align: 'center' })

  autoTable(doc, {
    startY: 26,
    head: [['Fecha', 'N°', 'Accionista', 'Temporadas', 'Monto Acciones', 'Multas', 'Total']],
    body: pagos.map(p => [
      formatFecha(p.fecha), p.numero_ingreso, p.accionista_nombre ?? '',
      p.temporadas_pagadas, formatCLP(p.monto_acciones),
      formatCLP(p.multas), formatCLP(p.total)
    ]),
    foot: [['TOTALES', '', '', '',
      formatCLP(pagos.reduce((s, p) => s + p.monto_acciones, 0)),
      formatCLP(pagos.reduce((s, p) => s + p.multas, 0)),
      formatCLP(pagos.reduce((s, p) => s + p.total, 0))
    ]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [7, 89, 133] },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
  })

  doc.save(`Pagos_${mes}_${year}.pdf`)
}

export function exportResumenContablePdf(
  resumen: ResumenContable,
  mensual: ResumenMensual[],
  temporada: Temporada,
  cargos: CargoResumen[] = []
): void {
  const doc = newPdf()
  doc.setFontSize(11).setFont('helvetica', 'bold')
  doc.text(INSTITUTION, 105, 14, { align: 'center' })
  doc.setFontSize(10).setFont('helvetica', 'normal')
  doc.text(`RESUMEN CONTABLE — TEMPORADA ${temporada.nombre}`, 105, 20, { align: 'center' })

  const { multaCargos, otrosCargos } = splitCargosMulta(cargos)
  const ingresoMultas = resumen.multas + multaCargos.reduce((s, c) => s + c.total_cobrado, 0)
  const totalConCargos = resumen.total + cargos.reduce((s, c) => s + c.total_cobrado, 0)

  autoTable(doc, {
    startY: 28,
    head: [['Cuenta', 'Monto']],
    body: [
      ['Ingreso por Cuota Acciones', formatCLP(resumen.monto_acciones)],
      ['Ingresos por Multas', formatCLP(ingresoMultas)],
      ...otrosCargos.map(c => [c.nombre, formatCLP(c.total_cobrado)])
    ],
    foot: [['TOTAL', formatCLP(totalConCargos)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [7, 89, 133] },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } }
  })

  const lastY = (doc as any).lastAutoTable.finalY + 8
  doc.setFontSize(9).setFont('helvetica', 'bold')
  doc.text('DESGLOSE MENSUAL', 14, lastY)

  autoTable(doc, {
    startY: lastY + 4,
    head: [['Mes', 'Monto Acciones', 'Multas', 'Total']],
    body: mensual.map(m => [
      mesNombre(m.mes), formatCLP(m.monto_acciones), formatCLP(m.multas), formatCLP(m.total)
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [7, 89, 133] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
  })

  doc.save(`Resumen_${temporada.nombre}.pdf`)
}

const PROP_TIPO_LABELS: Record<AccionistaType, string> = {
  PARCELA: 'Parcela',
  SITIO: 'Sitio',
  PEQUEÑO_PROPIETARIO: 'Propiedad pequeña'
}

/**
 * How a property is named on paper. The listado's own name ("Parcela N°8 Lote
 * A-2") is what the accionista recognises, so it wins; the tipo is only a
 * fallback for properties typed in by hand without one.
 */
function etiquetaPropiedad(p: Pick<Propiedad, 'nombre' | 'tipo'>): string {
  return p.nombre?.trim() || PROP_TIPO_LABELS[p.tipo]
}

/**
 * One shareholder's aviso: who they are, and everything they owe.
 *
 * `deuda` is the whole `deudores:get-deuda` breakdown — every temporada plus the
 * pre-app debt (D13, D14) — because the aviso demands the *outstanding balance*,
 * not the current season's cuota. A shareholder two seasons behind receives one
 * sheet listing all of it, already net of their abonos.
 */
export interface AvisoDestinatario {
  accionista: Accionista
  deuda: DeudaPorTemporada
  /** Optional; the aviso falls back to `accionista.nombres_propiedades`. */
  propiedades?: Propiedad[]
}

/**
 * What a line of the aviso is, so the PDF can style it and a reader can tell an
 * amount that is being charged from one that is only informative.
 */
export type AvisoLineaTipo =
  | 'grupo'          // section heading — "Temporada 2024-2025"
  | 'inicial'        // one line of pre-app debt (D14)
  | 'cuota'
  | 'propiedad'      // the cuota split across properties, for recognition only
  | 'subtotal'       // the cuota itself, closing a per-property split
  | 'cargo'
  | 'cargo_pagado'   // already settled, shown for the record
  | 'multa'
  | 'sin_deuda'

/** One row of the aviso's table, before it is a PDF row. */
export interface AvisoLinea {
  tipo: AvisoLineaTipo
  concepto: string
  monto: number
  /**
   * True when this line is part of TOTAL A PAGAR. Headings, the per-property
   * split and settled cargos are shown but not charged, so the charged lines
   * always add up to `deuda.total_pendiente`.
   */
  cobrable: boolean
}

const SUBTOTAL_STYLES = { fontStyle: 'bold', fillColor: [248, 250, 252] }
const PAGADO_STYLES = { textColor: [180, 180, 180] }

/** "· abonado $12.000", or nothing when no abono has touched this line. */
function sufijoAbonado(abonado: number): string {
  return abonado > 0 ? `  · abonado ${formatCLP(abonado)}` : ''
}

/**
 * How a season is named on the aviso.
 *
 * `temporadas.nombre` is typed by the administration, and they write it both
 * ways — "2024-2025" and "Temporada 2024-2025" — so prefixing unconditionally
 * prints "Temporada Temporada 2024-2025" for half the client's data.
 */
function etiquetaTemporada(nombre: string): string {
  const limpio = nombre.trim()
  return /^temporada\b/i.test(limpio) ? limpio : `Temporada ${limpio}`
}

/** "12 acc + 3 ha" — what a property contributes to the cuota. */
function unidadesTexto(acciones: number, hectareas: number): string {
  const parts: string[] = []
  if (acciones > 0) parts.push(`${formatNumber(acciones)} acc`)
  if (hectareas > 0) parts.push(`${formatNumber(hectareas)} ha`)
  return parts.join(' + ')
}

/**
 * The lines for one temporada: its unpaid cuota, its unpaid cargos, its multa.
 *
 * Amounts are the *pendiente* of each line, so the column always adds up to what
 * is still owed. The per-property split only appears while nothing has been
 * abonado against the cuota — once part of it is paid, splitting the remainder
 * across properties would invent an allocation nobody decided.
 */
function lineasTemporada(
  t: TemporadaBreakdown,
  propiedades: Propiedad[],
  unidades: number,
  conEncabezado: boolean
): AvisoLinea[] {
  const lineas: AvisoLinea[] = []

  if (conEncabezado) {
    lineas.push({ tipo: 'grupo', concepto: etiquetaTemporada(t.nombre), monto: 0, cobrable: false })
  }

  if (t.pendiente_cuota > 0) {
    const detallar = propiedades.length > 1 && t.abonado === 0 && unidades > 0
    if (detallar) {
      for (const p of propiedades) {
        lineas.push({
          tipo: 'propiedad',
          concepto: `${etiquetaPropiedad(p)}  (${unidadesTexto(p.acciones, p.hectareas)})`,
          monto: Math.round(t.cuota * ((p.acciones + p.hectareas) / unidades)),
          cobrable: false
        })
      }
      lineas.push({
        tipo: 'subtotal', concepto: 'Subtotal cuota acciones',
        monto: t.pendiente_cuota, cobrable: true
      })
    } else {
      lineas.push({
        tipo: 'cuota', concepto: `Cuota por acciones${sufijoAbonado(t.abonado)}`,
        monto: t.pendiente_cuota, cobrable: true
      })
    }
  }

  for (const c of t.cargos) {
    if (c.pendiente > 0) {
      lineas.push({
        tipo: 'cargo', concepto: `${c.nombre}${sufijoAbonado(c.abonado)}`,
        monto: c.pendiente, cobrable: true
      })
    }
  }

  for (const c of t.cargos) {
    if (c.pendiente <= 0) {
      lineas.push({
        tipo: 'cargo_pagado', concepto: `${c.nombre}  (Pagado)`,
        monto: c.monto, cobrable: false
      })
    }
  }

  if (t.pendiente_multa > 0) {
    lineas.push({
      tipo: 'multa', concepto: `Multa por atraso${sufijoAbonado(t.multa_abonada)}`,
      monto: t.pendiente_multa, cobrable: true
    })
  }

  return lineas
}

/**
 * Everything one shareholder's aviso charges, in the order it is printed:
 * pre-app debt first, then every temporada still owing, oldest first — the same
 * order the abonos were allocated in (D3), so the sheet reads like the ledger.
 *
 * Separated from the PDF because it is the part that must be *right*: the
 * charged lines are the demand, and their sum is `deuda.total_pendiente`.
 */
export function construirLineasAviso(
  { accionista, deuda, propiedades = [] }: AvisoDestinatario
): AvisoLinea[] {
  const unidades = accionista.acciones + accionista.hectareas
  const inicialPendiente = deuda.deuda_inicial.filter(l => l.pendiente > 0)
  const temporadasConDeuda = deuda.temporadas.filter(t => t.pendiente > 0)
  // A per-season heading is noise when there is only one season on the sheet.
  const conEncabezados = temporadasConDeuda.length > 1 || inicialPendiente.length > 0

  const lineas: AvisoLinea[] = []

  if (inicialPendiente.length > 0) {
    lineas.push({ tipo: 'grupo', concepto: 'Temporadas anteriores', monto: 0, cobrable: false })
    for (const l of inicialPendiente) {
      lineas.push({
        tipo: 'inicial',
        concepto: `${DEUDA_TIPO_LABELS[l.tipo]} · ${l.concepto}${sufijoAbonado(l.abonado)}`,
        monto: l.pendiente,
        cobrable: true
      })
    }
  }

  for (const t of temporadasConDeuda) {
    lineas.push(...lineasTemporada(t, propiedades, unidades, conEncabezados))
  }

  if (lineas.length === 0) {
    lineas.push({ tipo: 'sin_deuda', concepto: 'Sin deuda pendiente', monto: 0, cobrable: false })
  }

  return lineas
}

type AvisoRow = { content: string; styles?: any }[]

/** The styling of a line is decided by what kind of line it is, nowhere else. */
function filaDeLinea(l: AvisoLinea): AvisoRow {
  const monto = l.tipo === 'grupo' ? '' : formatCLP(l.monto)
  switch (l.tipo) {
    case 'grupo':
      return [
        { content: l.concepto, styles: SUBTOTAL_STYLES },
        { content: monto, styles: SUBTOTAL_STYLES }
      ]
    case 'subtotal':
      return [
        { content: l.concepto, styles: SUBTOTAL_STYLES },
        { content: monto, styles: { ...SUBTOTAL_STYLES, halign: 'right' } }
      ]
    case 'cargo_pagado':
      return [
        { content: l.concepto, styles: PAGADO_STYLES },
        { content: monto, styles: { ...PAGADO_STYLES, halign: 'right' } }
      ]
    default:
      return [{ content: l.concepto }, { content: monto }]
  }
}

/** Exported for the tests: the finished document, before it is saved or previewed. */
export function buildAvisosCobroDoc(destinatarios: AvisoDestinatario[], temporada: Temporada): jsPDF {
  const doc = newPdf()

  destinatarios.forEach(({ accionista: a, deuda, propiedades = [] }, i) => {
    if (i > 0) doc.addPage()

    // ── Header ────────────────────────────────────────────────
    doc.setFontSize(12).setFont('helvetica', 'bold')
    doc.text(INSTITUTION, 105, 20, { align: 'center' })
    doc.setFontSize(11)
    doc.text(`AVISO DE COBRANZA — ${etiquetaTemporada(temporada.nombre).toUpperCase()}`, 105, 28, { align: 'center' })
    doc.setDrawColor(7, 89, 133).setLineWidth(0.5)
    doc.line(14, 32, 196, 32)

    doc.setFontSize(10).setFont('helvetica', 'normal')
    doc.text(`Estimado/a: ${nombreCompleto(a)}`, 14, 42)

    // ── Property list ─────────────────────────────────────────
    let propY = 49
    if (propiedades.length > 0) {
      propiedades.forEach((p, pi) => {
        doc.text(etiquetaPropiedad(p), 14, propY + pi * 6)
      })
      propY += propiedades.length * 6
    } else if (a.nombres_propiedades) {
      doc.text(`Propiedad: ${a.nombres_propiedades}`, 14, propY, { maxWidth: 182 })
      propY += 6
    }

    // ── Info fields ───────────────────────────────────────────
    doc.setFontSize(9)
    const info: [string, string][] = []
    info.push(['Valor acción:', formatCLP(temporada.valor_accion)])
    if (temporada.fecha_multa) info.push(['Fecha límite de pago:', formatFecha(temporada.fecha_multa)])

    let y = propY + 3
    for (const [k, v] of info) {
      doc.setFont('helvetica', 'bold').text(k, 14, y)
      doc.setFont('helvetica', 'normal').text(v, 70, y)
      y += 6
    }

    // ── Table rows ────────────────────────────────────────────
    const bodyRows = construirLineasAviso({ accionista: a, deuda, propiedades }).map(filaDeLinea)

    autoTable(doc, {
      startY: y + 4,
      head: [['Concepto', 'Monto']],
      body: bodyRows as any,
      foot: [['TOTAL A PAGAR', formatCLP(deuda.total_pendiente)]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [7, 89, 133] },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 14, right: 14 }
    })

    let noteY = (doc as any).lastAutoTable.finalY + 8

    // Money already paid that no debt consumed — the shareholder should see it
    // credited rather than wonder where it went.
    if (deuda.excedente > 0) {
      doc.setFontSize(9).setFont('helvetica', 'normal')
      doc.text(`Excedente a favor: ${formatCLP(deuda.excedente)}`, 14, noteY)
      noteY += 8
    }

    if (temporada.nota_aviso) {
      doc.setFontSize(8).setFont('helvetica', 'italic')
      doc.text(temporada.nota_aviso, 14, noteY, { maxWidth: 182 })
    }
  })

  return doc
}

export function previewAvisoCobro(
  destinatarios: AvisoDestinatario[],
  temporada: Temporada
): string {
  const doc = buildAvisosCobroDoc(destinatarios, temporada)
  return doc.output('bloburl').toString()
}

export function exportAvisosCobro(
  destinatarios: AvisoDestinatario[],
  temporada: Temporada
): void {
  const doc = buildAvisosCobroDoc(destinatarios, temporada)
  const filename = destinatarios.length === 1
    ? `Aviso_${nombreCompleto(destinatarios[0].accionista).replace(/\s+/g, '_')}.pdf`
    : `Avisos_Cobranza_${temporada.nombre}.pdf`
  doc.save(filename)
}

// ── Comprobante de abono ───────────────────────────────────────────────────────

interface ComprobanteAbonoData {
  accionista: Accionista
  temporada: Temporada
  fecha: string
  numero_ingreso: number
  monto: number
  multas: number
  total: number
  monto_restante: number   // remaining debt after this abono
}

export function exportComprobanteAbono(data: ComprobanteAbonoData): void {
  const doc = newPdf()
  const { accionista, temporada } = data

  doc.setFontSize(12).setFont('helvetica', 'bold')
  doc.text(INSTITUTION, 105, 20, { align: 'center' })
  doc.setFontSize(11)
  doc.text(`COMPROBANTE DE ABONO — TEMPORADA ${temporada.nombre}`, 105, 28, { align: 'center' })

  doc.setDrawColor(7, 89, 133).setLineWidth(0.5)
  doc.line(14, 32, 196, 32)

  doc.setFontSize(10).setFont('helvetica', 'normal')
  doc.text(`Accionista: ${nombreCompleto(accionista)}`, 14, 42)

  if (accionista.nombres_propiedades) {
    doc.text(`Propiedad: ${accionista.nombres_propiedades}`, 14, 49, { maxWidth: 182 })
  }

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold').text('Fecha:', 14, 56)
  doc.setFont('helvetica', 'normal').text(formatFecha(data.fecha), 50, 56)
  doc.setFont('helvetica', 'bold').text('N° Ingreso:', 14, 62)
  doc.setFont('helvetica', 'normal').text(String(data.numero_ingreso), 50, 62)

  const bodyRows: string[][] = []
  if (data.monto > 0)   bodyRows.push(['Cuota por acciones', formatCLP(data.monto)])
  if (data.multas > 0)  bodyRows.push(['Multas', formatCLP(data.multas)])
  if (bodyRows.length === 0) bodyRows.push(['Abono', formatCLP(data.total)])

  autoTable(doc, {
    startY: 68,
    head: [['Concepto', 'Monto']],
    body: bodyRows,
    foot: [['TOTAL ABONADO', formatCLP(data.total)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [7, 89, 133] },
    footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 }
  })

  const afterTable = (doc as any).lastAutoTable.finalY + 8

  // Remaining debt info
  if (data.monto_restante > 0) {
    doc.setFontSize(9).setFont('helvetica', 'bold')
    doc.text('SALDO PENDIENTE:', 14, afterTable)
    doc.setFont('helvetica', 'normal')
    doc.text(formatCLP(data.monto_restante), 14, afterTable + 6)
  } else {
    doc.setFontSize(9).setFont('helvetica', 'bold')
    doc.setTextColor(34, 197, 94)
    doc.text('✓ Deuda completamente cubierta', 14, afterTable)
    doc.setTextColor(0, 0, 0)
  }

  doc.save(`Abono_${nombreCompleto(accionista).replace(/\s+/g, '_')}_${data.fecha}.pdf`)
}
