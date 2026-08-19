import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import {
  buildPlantillaAccionistas, buildPlantillaDeudaInicial, buildPlantillaPagos
} from '../../src/renderer/src/lib/plantillas'
import {
  parseDeudaInicial, parsePagos, parsePropiedades
} from '../../src/renderer/src/lib/importParser'

/**
 * A template the importer cannot read is worse than no template at all, so each
 * one is written out and fed straight back to the parser it exists for. These
 * are the tests that fail when a header is renamed on one side only.
 */
function bytes(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return out instanceof ArrayBuffer ? out : new Uint8Array(out).buffer
}

describe('plantillas de importación', () => {
  describe('accionistas', () => {
    const rows = parsePropiedades(bytes(buildPlantillaAccionistas()))

    it('reads every example row, and only the three property sheets', () => {
      assert.equal(rows.length, 8)
      assert.deepEqual([...new Set(rows.map(r => r.hoja))],
        ['PARCELAS', 'SITIOS', 'PEQUEÑOS PROPIETARIOS'])
    })

    it('leaves no example row unattributed', () => {
      assert.equal(rows.filter(r => !r.numero_socio).length, 0)
      assert.equal(rows.filter(r => !r.nombre_propiedad).length, 0)
      assert.equal(rows.filter(r => r.acciones === 0 && r.hectareas === 0).length, 0)
    })

    it('shows one accionista holding several properties', () => {
      const socio2 = rows.filter(r => r.numero_socio === '2')
      assert.deepEqual(socio2.map(r => r.nombre_propiedad), ['Parcela N°2', 'Parcela N°3'])
    })

    it('demonstrates the Unidad column deciding acciones vs hectáreas', () => {
      const sitios = rows.filter(r => r.hoja === 'SITIOS')
      assert.deepEqual(sitios.map(r => [r.acciones, r.hectareas]), [[0.493, 0], [0, 0.2143]])

      const pequenos = rows.filter(r => r.hoja === 'PEQUEÑOS PROPIETARIOS')
      assert.equal(pequenos.every(r => r.acciones === 0 && r.hectareas > 0), true)
    })
  })

  describe('pagos', () => {
    const { pagos: rows, omitidas } = parsePagos(bytes(buildPlantillaPagos()))

    it('reads the example payments and ignores the notes below them', () => {
      assert.equal(rows.length, 2)
      assert.deepEqual(rows.map(r => r.numero_ingreso), [500, 501])
      // The notes are prose, not unreadable payments — nothing to warn about.
      assert.deepEqual(omitidas, [])
    })

    it('reads dd/mm/yyyy dates and every amount column', () => {
      assert.deepEqual(rows[0], {
        fecha: '2025-05-01', numero_ingreso: 500, numero_socio: '1',
        accionista_nombre: 'JUAN PÉREZ SOTO',
        temporadas_pagadas: 1, monto_acciones: 89540, multas: 0, total: 89540,
        otros: 0, fila: 4
      })
      assert.equal(rows[1].multas, 5000)
      assert.equal(rows[1].temporadas_pagadas, 2)
    })
  })

  describe('deuda anterior', () => {
    const rows = parseDeudaInicial(bytes(buildPlantillaDeudaInicial()))

    it('turns each non-zero amount into its own line and skips the zeros', () => {
      // Charged in the order they are listed: cuota, then otro, then multa.
      assert.deepEqual(rows.map(r => [r.numero_socio, r.tipo, r.monto]), [
        ['1', 'CUOTA', 480000],
        ['1', 'MULTA', 240000],
        ['3', 'MULTA', 120000],
        ['5', 'OTRO', 95000]
      ])
    })

    it('keeps the concepto written on each row', () => {
      assert.equal(rows[0].concepto, 'Deuda temporadas 2021-2024')
      assert.equal(rows[2].concepto, 'Multa temporada 2024-2025')
    })

    it('reads the N° Temporadas column the template declares', () => {
      // Row 1 covers three seasons and produces two lines — cuota and multa —
      // and the span belongs to both. Row 3 leaves the cell blank, which is what
      // the template tells the administration to do when it does not consta.
      assert.deepEqual(rows.map(r => r.temporadas_adeudadas), [3, 3, 1, null])
    })
  })
})
