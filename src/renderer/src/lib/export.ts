import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCLP, formatFecha, mesNombre, formatNumber, calcularMontoAcciones } from './formulas'
import type { Pago, ResumenMensual, ResumenContable, Deudor, Temporada, Accionista, Propiedad, AccionistaType } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'

// ── Excel exports ────────────────────────────────────────────────────────────

export function exportPagosMes(pagos: Pago[], year: number, month: number): void {
  const mes = mesNombre(month).toUpperCase()
  const headers = ['Fecha', 'N° Ingreso', 'Accionista', 'Acciones', 'Hectáreas',
                   'N° Temporadas', 'Monto Acciones', 'Multas', 'Cuota Extra.', 'Otros', 'Total']
  const rows = pagos.map(p => [
    formatFecha(p.fecha), p.numero_ingreso, p.accionista_nombre,
    p.accionista_tipo === 'PEQUEÑO_PROPIETARIO' ? '' : '',
    '', p.temporadas_pagadas,
    p.monto_acciones, p.multas, p.cuota_extraordinaria, p.otros_ingresos, p.total
  ])
  const totals = ['TOTALES', '', '', '', '', '',
    pagos.reduce((s, p) => s + p.monto_acciones, 0),
    pagos.reduce((s, p) => s + p.multas, 0),
    pagos.reduce((s, p) => s + p.cuota_extraordinaria, 0),
    pagos.reduce((s, p) => s + p.otros_ingresos, 0),
    pagos.reduce((s, p) => s + p.total, 0)
  ]

  const wb = XLSX.utils.book_new()
  const wsData = [[`MES: ${mes} ${year}`], headers, ...rows, totals]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [14, 10, 30, 10, 10, 12, 16, 12, 12, 12, 14].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws, `${mes} ${year}`)
  XLSX.writeFile(wb, `Pagos_${mes}_${year}.xlsx`)
}

export function exportResumenContable(
  resumen: ResumenContable,
  mensual: ResumenMensual[],
  temporada: Temporada
): void {
  const wb = XLSX.utils.book_new()

  const data: any[][] = [
    [`RESUMEN INGRESOS TEMPORADA ${temporada.nombre}`],
    [],
    ['CUENTA', 'MONTO'],
    ['Ingreso por Cuota Acciones', resumen.monto_acciones],
    ['Ingresos por Multas', resumen.multas],
    ['Cuota Extraordinaria', resumen.cuota_extraordinaria],
    ['Otros Ingresos', resumen.otros_ingresos],
    ['TOTAL', resumen.total],
    [],
    ['CANCELACIONES MENSUALES'],
    ['Mes', 'Monto Acciones', 'Multas', 'Cuota Extra.', 'Otros', 'Total'],
    ...mensual.map(m => [
      mesNombre(m.mes).toUpperCase(),
      m.monto_acciones, m.multas, m.cuota_extraordinaria, m.otros_ingresos, m.total
    ])
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [30, 16, 16, 16, 16, 16].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws, 'Resumen')
  XLSX.writeFile(wb, `Resumen_${temporada.nombre}.xlsx`)
}

export function exportDeudores(deudores: Deudor[], temporada: Temporada): void {
  const wb = XLSX.utils.book_new()
  const headers = ['Accionista', 'N°', 'Acciones', 'Hectáreas', 'N° Temporadas',
                   'Monto Adeudado', 'Multas', 'Cuota Extra.', 'Otros', 'Total']
  const rows = deudores.map(d => [
    nombreCompleto(d), (d as any).numeros ?? d.numero ?? '',
    d.acciones || '', d.hectareas || '',
    d.temporadas_adeudadas, d.monto_adeudado, d.multas,
    d.cuota_extraordinaria, d.otros_ingresos, d.total
  ])
  const wsData = [[`DEUDORES TEMPORADA ${temporada.nombre}`], headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [30, 14, 10, 10, 12, 16, 12, 12, 12, 14].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws, 'Deudores')
  XLSX.writeFile(wb, `Deudores_${temporada.nombre}.xlsx`)
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
      formatFecha(p.fecha), p.numero_ingreso, p.accionista_nombre,
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
  temporada: Temporada
): void {
  const doc = newPdf()
  doc.setFontSize(11).setFont('helvetica', 'bold')
  doc.text(INSTITUTION, 105, 14, { align: 'center' })
  doc.setFontSize(10).setFont('helvetica', 'normal')
  doc.text(`RESUMEN CONTABLE — TEMPORADA ${temporada.nombre}`, 105, 20, { align: 'center' })

  autoTable(doc, {
    startY: 28,
    head: [['Cuenta', 'Monto']],
    body: [
      ['Ingreso por Cuota Acciones', formatCLP(resumen.monto_acciones)],
      ['Ingresos por Multas', formatCLP(resumen.multas)],
      ['Cuota Extraordinaria', formatCLP(resumen.cuota_extraordinaria)],
      ['Otros Ingresos', formatCLP(resumen.otros_ingresos)]
    ],
    foot: [['TOTAL', formatCLP(resumen.total)]],
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
    head: [['Mes', 'Monto Acciones', 'Multas', 'Cuota Extra.', 'Otros', 'Total']],
    body: mensual.map(m => [
      mesNombre(m.mes), formatCLP(m.monto_acciones), formatCLP(m.multas),
      formatCLP(m.cuota_extraordinaria), formatCLP(m.otros_ingresos), formatCLP(m.total)
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [7, 89, 133] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
  })

  doc.save(`Resumen_${temporada.nombre}.pdf`)
}

const PROP_TIPO_LABELS: Record<AccionistaType, string> = {
  PARCELA: 'Parcela',
  SITIO: 'Sitio',
  PEQUEÑO_PROPIETARIO: 'Propiedad pequeña'
}

export interface AvisoCargo {
  nombre: string
  monto: number
  pagado: boolean | number
}

function buildAvisosCobroDoc(
  accionistas: Accionista[],
  temporada: Temporada,
  valorAccion: number,
  multaVencimiento = 0,
  propiedades: Propiedad[] = [],
  cargosAviso: AvisoCargo[] = []
): jsPDF {
  const doc = newPdf()

  accionistas.forEach((a, i) => {
    if (i > 0) doc.addPage()

    const montoAcc = calcularMontoAcciones(valorAccion, a.acciones, a.hectareas, 1)
    const cargosPendientes = cargosAviso.filter(c => !c.pagado)
    const totalCargos = cargosPendientes.reduce((s, c) => s + c.monto, 0)
    const total = montoAcc + multaVencimiento + totalCargos

    // ── Header ────────────────────────────────────────────────
    doc.setFontSize(12).setFont('helvetica', 'bold')
    doc.text(INSTITUTION, 105, 20, { align: 'center' })
    doc.setFontSize(11)
    doc.text(`AVISO DE COBRANZA — TEMPORADA ${temporada.nombre}`, 105, 28, { align: 'center' })
    doc.setDrawColor(7, 89, 133).setLineWidth(0.5)
    doc.line(14, 32, 196, 32)

    doc.setFontSize(10).setFont('helvetica', 'normal')
    doc.text(`Estimado/a: ${nombreCompleto(a)}`, 14, 42)

    // ── Property list ─────────────────────────────────────────
    let propY = 49
    if (propiedades.length > 0) {
      propiedades.forEach((p, pi) => {
        const label = PROP_TIPO_LABELS[p.tipo]
        const num = p.numero ? ` N° ${p.numero}` : ''
        doc.text(`${label}${num}`, 14, propY + pi * 6)
      })
      propY += propiedades.length * 6
    } else {
      const displayNumeros = a.numeros || a.numero
      if (displayNumeros) {
        doc.text(`N° Parcela/Sitio: ${displayNumeros}`, 14, propY)
        propY += 6
      }
    }

    // ── Info fields ───────────────────────────────────────────
    doc.setFontSize(9)
    const info: [string, string][] = []
    info.push(['Valor acción:', formatCLP(valorAccion)])
    if (temporada.fecha_multa) info.push(['Fecha límite de pago:', formatFecha(temporada.fecha_multa)])

    let y = propY + 3
    for (const [k, v] of info) {
      doc.setFont('helvetica', 'bold').text(k, 14, y)
      doc.setFont('helvetica', 'normal').text(v, 70, y)
      y += 6
    }

    // ── Table rows ────────────────────────────────────────────
    const bodyRows: (string | { content: string; styles?: any })[][] = []

    if (propiedades.length > 1) {
      // Per-property breakdown
      propiedades.forEach(p => {
        const label = PROP_TIPO_LABELS[p.tipo]
        const num = p.numero ? ` N° ${p.numero}` : ''
        const propMonto = valorAccion * (p.acciones + p.hectareas)
        const parts: string[] = []
        if (p.acciones > 0) parts.push(`${formatNumber(p.acciones)} acc`)
        if (p.hectareas > 0) parts.push(`${formatNumber(p.hectareas)} ha`)
        bodyRows.push([`${label}${num}  (${parts.join(' + ')})`, formatCLP(propMonto)])
      })
      if (multaVencimiento > 0 || cargosAviso.length > 0) {
        bodyRows.push([
          { content: 'Subtotal cuota acciones', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } },
          { content: formatCLP(montoAcc), styles: { fontStyle: 'bold', fillColor: [248, 250, 252], halign: 'right' } }
        ])
      }
    } else {
      bodyRows.push(['Cuota por acciones (1 temporada)', formatCLP(montoAcc)])
    }

    if (multaVencimiento > 0) {
      bodyRows.push(['Multa por mora', formatCLP(multaVencimiento)])
    }

    // All cargos — pending first, then paid (grayed out)
    for (const c of cargosAviso) {
      if (!c.pagado) {
        bodyRows.push([c.nombre, formatCLP(c.monto)])
      }
    }
    for (const c of cargosAviso) {
      if (c.pagado) {
        bodyRows.push([
          { content: `${c.nombre}  (Pagado)`, styles: { textColor: [180, 180, 180] } },
          { content: formatCLP(c.monto), styles: { textColor: [180, 180, 180], halign: 'right' } }
        ])
      }
    }

    autoTable(doc, {
      startY: y + 4,
      head: [['Concepto', 'Monto']],
      body: bodyRows as any,
      foot: [['TOTAL A PAGAR', formatCLP(total)]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [7, 89, 133] },
      footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 14, right: 14 }
    })

    if (temporada.nota_aviso) {
      const noteY = (doc as any).lastAutoTable.finalY + 8
      doc.setFontSize(8).setFont('helvetica', 'italic')
      doc.text(temporada.nota_aviso, 14, noteY, { maxWidth: 182 })
    }
  })

  return doc
}

export function previewAvisoCobro(
  accionistas: Accionista[],
  temporada: Temporada,
  valorAccion: number,
  multaVencimiento = 0,
  propiedades: Propiedad[] = [],
  cargosAviso: AvisoCargo[] = []
): string {
  const doc = buildAvisosCobroDoc(accionistas, temporada, valorAccion, multaVencimiento, propiedades, cargosAviso)
  return doc.output('bloburl') as string
}

export function exportAvisosCobro(
  accionistas: Accionista[],
  temporada: Temporada,
  valorAccion: number,
  multaVencimiento = 0,
  propiedades: Propiedad[] = [],
  cargosAviso: AvisoCargo[] = []
): void {
  const doc = buildAvisosCobroDoc(accionistas, temporada, valorAccion, multaVencimiento, propiedades, cargosAviso)
  const filename = accionistas.length === 1
    ? `Aviso_${nombreCompleto(accionistas[0]).replace(/\s+/g, '_')}.pdf`
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
  cuota_extraordinaria: number
  otros_ingresos: number
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

  const displayNumeros = accionista.numeros || accionista.numero
  if (displayNumeros) doc.text(`N° Parcela/Sitio: ${displayNumeros}`, 14, 49)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold').text('Fecha:', 14, 56)
  doc.setFont('helvetica', 'normal').text(formatFecha(data.fecha), 50, 56)
  doc.setFont('helvetica', 'bold').text('N° Ingreso:', 14, 62)
  doc.setFont('helvetica', 'normal').text(String(data.numero_ingreso), 50, 62)

  const bodyRows: string[][] = []
  if (data.monto > 0)               bodyRows.push(['Cuota por acciones', formatCLP(data.monto)])
  if (data.multas > 0)              bodyRows.push(['Multas', formatCLP(data.multas)])
  if (data.cuota_extraordinaria > 0) bodyRows.push(['Cuota Extraordinaria', formatCLP(data.cuota_extraordinaria)])
  if (data.otros_ingresos > 0)      bodyRows.push(['Otros Ingresos', formatCLP(data.otros_ingresos)])
  if (bodyRows.length === 0)        bodyRows.push(['Abono', formatCLP(data.total)])

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
