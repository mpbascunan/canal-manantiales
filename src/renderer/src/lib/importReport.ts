import * as XLSX from 'xlsx'
import type { FilaPagoOmitida, RawPago } from './importParser'

/**
 * The workbook handed back after importing ingresos: every row that did not make
 * it in, with the reason and what to do about it.
 *
 * The preview says the same things on screen, but the screen closes. What is
 * left over is a worklist — payments to type in by hand, names to fix in the
 * spreadsheet, receipt numbers to check — and a worklist is only useful if you
 * can keep it open next to the file you are correcting.
 */

/** One rejected row, flattened for the spreadsheet. */
export interface FilaNoImportada {
  motivo: string
  accion: string
  fila: number
  numero_ingreso: number | null
  fecha: string
  numero_socio: string | null
  accionista_nombre: string
  monto_acciones: number
  multas: number
  otros: number
  total: number
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

export interface PagoRechazado {
  numero_ingreso: number
  fecha: string
  accionista_nombre: string
  total: number
  fila: number
  otros: number
  numero_socio: string | null
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
      motivo,
      accion,
      fila: p.fila,
      numero_ingreso: p.numero_ingreso,
      fecha: p.fecha,
      numero_socio: p.numero_socio,
      accionista_nombre: p.accionista_nombre,
      monto_acciones: raw?.monto_acciones ?? 0,
      multas: raw?.multas ?? 0,
      otros: p.otros,
      total: p.total
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
      total: o.total
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

export function buildNoImportadosWorkbook(
  d: ResumenNoImportado,
  temporadaNombre: string
): XLSX.WorkBook {
  const filas = armarNoImportados(d)
  const wb = XLSX.utils.book_new()

  const total = filas.reduce((s, f) => s + f.total, 0)
  const porMotivo = new Map<string, { n: number; monto: number }>()
  for (const f of filas) {
    const acc = porMotivo.get(f.motivo) ?? { n: 0, monto: 0 }
    acc.n++; acc.monto += f.total
    porMotivo.set(f.motivo, acc)
  }

  const data: (string | number | null)[][] = [
    [`FILAS NO IMPORTADAS — ${temporadaNombre}`],
    [],
    ['Motivo', 'Filas', 'Monto'],
    ...[...porMotivo].map(([motivo, x]) => [motivo, x.n, x.monto]),
    ['TOTAL', filas.length, total],
    [],
    ['Fila', 'Motivo', 'N° Ingreso', 'Fecha', 'N° Socio', 'Accionista',
     'Monto Acciones', 'Multas', 'Otros', 'Total', 'Qué hacer'],
    ...filas.map(f => [
      f.fila, f.motivo, f.numero_ingreso, f.fecha, f.numero_socio, f.accionista_nombre,
      f.monto_acciones || null, f.multas || null, f.otros || null, f.total, f.accion
    ])
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = [8, 34, 12, 12, 10, 34, 16, 12, 14, 14, 80].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'No importadas')

  // Anything the import rejected for a reason the preview did not anticipate —
  // a constraint failure, say. Messages about a receipt the detail sheet already
  // explains are dropped: repeating them under a scarier heading would only make
  // the same 122 rows look like 244 problems.
  const explicados = new Set(filas.map(f => f.numero_ingreso).filter(Boolean))
  const inesperados = d.errores.filter(e => {
    const refs = [...e.matchAll(/N°\s*(\d+)/g)].map(m => Number(m[1]))
    return !refs.some(n => explicados.has(n))
  })

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

export function descargarNoImportados(d: ResumenNoImportado, temporadaNombre: string): void {
  const nombre = temporadaNombre.replace(/\s+/g, '_')
  XLSX.writeFile(buildNoImportadosWorkbook(d, temporadaNombre), `No_importadas_${nombre}.xlsx`)
}
