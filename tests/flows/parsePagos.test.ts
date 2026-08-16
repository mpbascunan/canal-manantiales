import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parsePagos } from '../../src/renderer/src/lib/importParser'

/**
 * The real ingresos workbook is not a table: it repeats a header for every
 * month, keeps a summary block in the columns to the right, and ends with a
 * DEUDORES listing whose rows are payment-shaped but are not payments. These
 * cases reproduce that shape in miniature.
 */
function sheet(rows: any[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hoja1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return out instanceof ArrayBuffer ? out : new Uint8Array(out).buffer
}

const HEADER = ['FECHA', 'N° INGRESO', 'ACCIONISTA', 'ACCIONES QUE POSEE', 'HECTAREAS QUE POSEE',
                'N° DE TEMPORADAS', 'MONTO CANCELADO POR ACCIONES', 'MULTAS',
                'CUOTA EXTRAORDINARIA', 'OTROS INGRESOS', 'TOTAL']

const pago = (fecha: string, n: number, nombre: string, monto: number, multas = 0,
              cuota: number | null = null, otros: number | null = null) =>
  [fecha, n, nombre, 1, null, 1, monto, multas, cuota, otros,
   monto + multas + (cuota ?? 0) + (otros ?? 0)]

describe('parsePagos', () => {
  it('reads a month section and its amounts', () => {
    const { pagos, omitidas } = parsePagos(sheet([
      ['RESUMEN DE INGRESOS'],
      ['MES: FEBRERO 2025'],
      HEADER,
      pago('06/02/2025', 5321, 'Luis Navarrete Ortuzar', 286200, 39750),
      ['TOTALES', null, null, null, null, null, 286200, 39750, null, null, 325950]
    ]))

    assert.equal(omitidas.length, 0)
    assert.deepEqual(pagos.map(p => [p.numero_ingreso, p.fecha, p.total]),
      [[5321, '2025-02-06', 325950]])
  })

  it('picks the columns up again at each monthly header', () => {
    const { pagos } = parsePagos(sheet([
      ['MES: FEBRERO 2025'], HEADER,
      pago('06/02/2025', 1, 'Ana Díaz', 1000),
      ['TOTALES', null, null, null, null, null, 1000, 0, null, null, 1000],
      ['MES: MARZO 2025'], HEADER,
      pago('18/03/2025', 2, 'Juan Pavez', 2000),
      ['TOTALES', null, null, null, null, null, 2000, 0, null, null, 2000]
    ]))

    assert.deepEqual(pagos.map(p => p.numero_ingreso), [1, 2])
  })

  it('reports a row that carries money but cannot be read', () => {
    const { pagos, omitidas } = parsePagos(sheet([
      ['MES: MAYO 2025'], HEADER,
      pago('05/05/2025', 5409, 'Ana Díaz', 1000),
      // Has a date and a receipt number, but nobody to attribute it to.
      ['05/05/2025', 5410, null, null, null, 1, 31797, null, null, null, 31797]
    ]))

    assert.deepEqual(pagos.map(p => p.numero_ingreso), [5409])
    assert.deepEqual(omitidas, [
      { fila: 4, motivo: 'sin_accionista', numero_ingreso: 5410, accionista_nombre: '', total: 31797 }
    ])
  })

  it('does not report blank or subtotal rows as unreadable', () => {
    const { pagos, omitidas } = parsePagos(sheet([
      ['MES: MAYO 2025'], HEADER,
      pago('05/05/2025', 1, 'Ana Díaz', 1000),
      [],
      [null, null, null, null, null, null, 0, null, null, null, 0],
      ['TOTALES', null, null, null, null, null, 1000, 0, null, null, 1000]
    ]))

    assert.equal(pagos.length, 1)
    assert.deepEqual(omitidas, [])
  })

  it('stops at the deudores listing, whichever column its heading is in', () => {
    const { pagos, omitidas } = parsePagos(sheet([
      ['MES: ENERO 2026'], HEADER,
      pago('28/01/2026', 5655, 'Ana Díaz', 2000),
      ['TOTALES', null, null, null, null, null, 2000, 0, null, null, 2000],
      // In the real file this heading sits in the FECHA column, not the
      // ACCIONISTA one — matching only the name column let all 92 rows through.
      ['DEUDORES TEMPORADA 2025-2026'],
      ['FECHA', 'N° INGRESO', 'ACCIONISTA', 'ACCIONES QUE POSEE', 'HECTAREAS QUE POSEE',
       'N° DE TEMPORADAS', 'MONTO ADEUDADO POR ACCIONES', 'MULTAS',
       'CUOTA EXTRAORDINARIA', 'OTROS INGRESOS', 'TOTAL'],
      [null, null, 'Anita Bustamante Caro', 0.3626, null, 2, 29733, 3626, null, null, 33359]
    ]))

    assert.deepEqual(pagos.map(p => p.numero_ingreso), [5655])
    assert.deepEqual(omitidas, [])
  })

  it('keeps cuota extraordinaria and otros ingresos separate from the breakdown', () => {
    const { pagos } = parsePagos(sheet([
      ['MES: FEBRERO 2025'], HEADER,
      pago('06/02/2025', 5321, 'Luis Navarrete', 286200, 39750, 265),
      pago('11/12/2025', 5654, 'Canal San José aporte 25%', 0, 0, null, 1643477)
    ]))

    assert.deepEqual(pagos.map(p => p.otros), [265, 1643477])
    // The total still holds everything; only the breakdown is short.
    assert.equal(pagos[0].total, 326215)
    assert.equal(pagos[0].monto_acciones + pagos[0].multas, 325950)
  })

  it('does not count the summary block\'s repeated otros columns', () => {
    // The real sheet repeats CUOTA EXTRAORDINARIA and OTROS INGRESOS as headers
    // of the summary block, on the same rows as the payments.
    const { pagos } = parsePagos(sheet([
      ['MES: FEBRERO 2025'],
      [...HEADER, 'MES', 'TOTAL ACCIONES', 'TOTAL MULTAS', 'CUOTA EXTRAORDINARIA',
       'OTROS INGRESOS', 'TOTAL'],
      [...pago('06/02/2025', 5321, 'Luis Navarrete', 286200, 39750, 265),
       'FEBRERO', 1.42775, 46889, 265, null, 384753]
    ]))

    assert.equal(pagos[0].otros, 265)
  })

  it('ignores the summary block sitting in the columns to the right', () => {
    const conResumen = [
      ['MES: FEBRERO 2025', null, null, null, null, null, null, null, null, null, null,
       'CANCELACIONES MENSUALES'],
      [...HEADER, 'MES', 'TOTAL ACCIONES'],
      [...pago('06/02/2025', 5321, 'Ana Díaz', 1000), 'FEBRERO', 1.42775],
      [null, null, null, null, null, null, null, null, null, null, 0, 'MARZO', 3.04]
    ]
    const { pagos, omitidas } = parsePagos(sheet(conResumen))

    assert.deepEqual(pagos.map(p => p.numero_ingreso), [5321])
    assert.deepEqual(omitidas, [])
  })
})
