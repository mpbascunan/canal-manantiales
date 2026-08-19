import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseDeudaInicial } from '../../src/renderer/src/lib/importParser'

/**
 * The columns are detected from header text, so these cases pin down which
 * spellings are understood. If the administration's real file is not read
 * correctly, the fix belongs here first.
 */
function sheet(rows: any[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Hoja1')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return out instanceof ArrayBuffer ? out : new Uint8Array(out).buffer
}

describe('parseDeudaInicial', () => {
  describe('layout 1 — a column per kind of debt', () => {
    it('turns each non-zero amount into its own line', () => {
      const rows = parseDeudaInicial(sheet([
        ['N° Socio', 'Accionista', 'Cuota', 'Multa'],
        ['042', 'Juan Pérez Soto', 480000, 240000]
      ]))

      assert.equal(rows.length, 2)
      assert.deepEqual(rows.map(r => r.tipo), ['CUOTA', 'MULTA'])
      assert.deepEqual(rows.map(r => r.monto), [480000, 240000])
      assert.equal(rows[0].numero_socio, '042')
      assert.equal(rows[0].accionista_nombre, 'Juan Pérez Soto')
    })

    it('skips zero and blank amounts', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Cuota', 'Multa'],
        ['Juan Pérez', 0, 240000],
        ['Pedro Soto', null, null]
      ]))

      assert.equal(rows.length, 1)
      assert.equal(rows[0].tipo, 'MULTA')
      assert.equal(rows[0].accionista_nombre, 'Juan Pérez')
    })

    it('gives each line a default concepto naming what it is', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Multa'],
        ['Juan Pérez', 240000]
      ]))

      assert.equal(rows[0].concepto, 'Multa temporadas anteriores')
    })

    it('uses the concepto column when the sheet has one', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Concepto', 'Multa'],
        ['Juan Pérez', 'Multa temporada 2024-2025', 240000]
      ]))

      assert.equal(rows[0].concepto, 'Multa temporada 2024-2025')
    })
  })

  describe('layout 2 — one amount, typed by a column', () => {
    it('reads the tipo column', () => {
      const rows = parseDeudaInicial(sheet([
        ['Socio', 'Nombre', 'Concepto', 'Tipo', 'Monto'],
        ['042', 'Juan Pérez', 'Cuota impaga 2023-2024', 'CUOTA', 480000],
        ['042', 'Juan Pérez', 'Multa 2023-2024', 'MULTA', 240000]
      ]))

      assert.deepEqual(rows.map(r => r.tipo), ['CUOTA', 'MULTA'])
      assert.deepEqual(rows.map(r => r.monto), [480000, 240000])
    })

    it('treats an untyped amount as a multa', () => {
      // What the administration is handing over is a list of fines.
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Monto'],
        ['Juan Pérez', 240000]
      ]))

      assert.equal(rows[0].tipo, 'MULTA')
    })

    it('accepts "deuda" and "saldo" as the amount column', () => {
      for (const header of ['Deuda', 'Saldo', 'Total']) {
        const rows = parseDeudaInicial(sheet([
          ['Accionista', header],
          ['Juan Pérez', 240000]
        ]))
        assert.equal(rows.length, 1, `no leyó la columna "${header}"`)
        assert.equal(rows[0].monto, 240000)
      }
    })
  })

  describe('n° de temporadas adeudadas', () => {
    it('reads the count and gives it to every line of the row', () => {
      // One row, three seasons, two lines: the span covers both the cuota and
      // the multa, because the sheet states it once for the whole row.
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'N° Temporadas', 'Cuota', 'Multa'],
        ['Juan Pérez', 3, 480000, 240000]
      ]))

      assert.deepEqual(rows.map(r => r.temporadas_adeudadas), [3, 3])
    })

    it('is null when the sheet has no such column', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Multa'],
        ['Juan Pérez', 240000]
      ]))

      assert.equal(rows[0].temporadas_adeudadas, null)
    })

    it('accepts the spellings the administration is likely to type', () => {
      for (const header of [
        'Temporadas', 'temporadas adeudadas', 'N° Temporadas', 'Nº de temporadas',
        'Cantidad de Temporadas', 'Temporadas impagas', 'Temporadas pendientes'
      ]) {
        const rows = parseDeudaInicial(sheet([
          ['Accionista', header, 'Multa'],
          ['Juan Pérez', 2, 240000]
        ]))

        assert.equal(rows[0].temporadas_adeudadas, 2, `"${header}" should be read as the count`)
      }
    })

    it('ignores a concepto column that merely mentions temporadas', () => {
      // The trap this guards: read as the count, a free-text concepto column
      // would shadow the real one and yield nothing but nulls.
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Deuda temporadas anteriores', 'Multa'],
        ['Juan Pérez', 'cuotas 2022 y 2023', 240000]
      ]))

      assert.equal(rows[0].temporadas_adeudadas, null)
    })

    it('discards a count that is not a whole number of seasons', () => {
      for (const cell of [0, -1, 2.5, 'cuatro', '', null]) {
        const rows = parseDeudaInicial(sheet([
          ['Accionista', 'Temporadas', 'Multa'],
          ['Juan Pérez', cell, 240000]
        ]))

        assert.equal(
          rows[0].temporadas_adeudadas, null,
          `${JSON.stringify(cell)} should not be read as a count`
        )
      }
    })

    it('works in the single-monto layout too', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Tipo', 'Temporadas', 'Monto'],
        ['Juan Pérez', 'CUOTA', 4, 640000]
      ]))

      assert.equal(rows.length, 1)
      assert.equal(rows[0].tipo, 'CUOTA')
      assert.equal(rows[0].monto, 640000)
      assert.equal(rows[0].temporadas_adeudadas, 4)
    })

    it('does not let the count be mistaken for the monto', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Temporadas', 'Monto'],
        ['Juan Pérez', 3, 480000]
      ]))

      assert.equal(rows.length, 1)
      assert.equal(rows[0].monto, 480000)
    })
  })

  describe('robustness', () => {
    it('finds the header even when preceded by title rows', () => {
      const rows = parseDeudaInicial(sheet([
        ['CANAL RINCONADA DE MANANTIALES'],
        ['Deuda de temporadas anteriores'],
        [],
        ['Accionista', 'Multa'],
        ['Juan Pérez', 240000]
      ]))

      assert.equal(rows.length, 1)
      assert.equal(rows[0].fila, 5)
    })

    it('stops at a TOTALES row', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Multa'],
        ['Juan Pérez', 240000],
        ['TOTALES', 240000]
      ]))

      assert.equal(rows.length, 1)
    })

    it('rounds amounts to whole pesos', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Multa'],
        ['Juan Pérez', 240000.6]
      ]))

      assert.equal(rows[0].monto, 240001)
    })

    it('returns nothing when no accionista column can be found', () => {
      const rows = parseDeudaInicial(sheet([
        ['Columna A', 'Columna B'],
        ['algo', 123]
      ]))

      assert.deepEqual(rows, [])
    })

    it('reports the sheet row so the preview can point at problems', () => {
      const rows = parseDeudaInicial(sheet([
        ['Accionista', 'Multa'],
        ['Juan Pérez', 100000],
        ['Pedro Soto', 200000]
      ]))

      assert.deepEqual(rows.map(r => r.fila), [2, 3])
    })
  })
})
