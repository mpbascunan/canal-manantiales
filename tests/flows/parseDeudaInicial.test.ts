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
