import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parsePropiedades } from '../../src/renderer/src/lib/importParser'

/**
 * The listado's columns are detected from header text and its amount column
 * means either acciones or hectáreas depending on the row, so these cases pin
 * down exactly what is understood. If the administration's real file is read
 * wrongly, the fix belongs here first.
 */
function workbook(sheets: Record<string, any[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return out instanceof ArrayBuffer ? out : new Uint8Array(out).buffer
}

const HEADER = ['N°', 'Propietario / Razón Social', 'Nota original', 'Acciones',
                'Unidad', 'N° Socio', 'Predio', 'A revisar', 'Observación']

describe('parsePropiedades', () => {
  it('reads one propiedad per row, typed by the sheet it is on', () => {
    const rows = parsePropiedades(workbook({
      PARCELAS: [HEADER, ['1.-', 'JOSÉ SOTO AVILA', null, 8.954, 'Acciones', 1, 'Parcela N°1']],
      SITIOS: [HEADER, ['3.-', 'ATILIO RIVEROS', null, 0.493, 'Acciones', 39, 'Sitio N°3']],
      'PEQUEÑOS PROPIETARIOS': [HEADER, ['2', 'LUZMIRA ROJAS', null, 1, 'Hectáreas', 214, 'Pequeño Propietario']]
    }))

    assert.deepEqual(rows.map(r => r.tipo), ['PARCELA', 'SITIO', 'PEQUEÑO_PROPIETARIO'])
    assert.deepEqual(rows.map(r => r.numero_socio), ['1', '39', '214'])
    assert.deepEqual(rows.map(r => r.nombre_propiedad),
      ['Parcela N°1', 'Sitio N°3', 'Pequeño Propietario'])
    assert.equal(rows[0].nombre, 'JOSÉ SOTO AVILA')
    assert.equal(rows[0].hoja, 'PARCELAS')
    assert.equal(rows[0].fila, 2)
  })

  it('routes the amount by the Unidad column, not by the sheet', () => {
    const rows = parsePropiedades(workbook({
      SITIOS: [
        HEADER,
        ['5-A', 'MARGARITA CONTRERAS', null, 0.282, 'Acciones', 76, 'Sitio N°5 Lote A'],
        ['5-B', 'ABRAHAM MUÑOZ', '0.2143 HECT.', 0.2143, 'Hectareas', 307, 'Sitio N°5 Lote B']
      ]
    }))

    assert.deepEqual(rows.map(r => r.acciones), [0.282, 0])
    assert.deepEqual(rows.map(r => r.hectareas), [0, 0.2143])
  })

  it('falls back to the amount column header when there is no Unidad column', () => {
    const rows = parsePropiedades(workbook({
      'PEQUEÑOS PROPIETARIOS': [
        ['N°', 'Propietario / Razón Social', 'Hectareas', 'N° Socio', 'Predio'],
        ['1', 'DANIEL GALAZ', 0.212, 205, 'Sitio Casa']
      ]
    }))

    assert.deepEqual(rows.map(r => [r.acciones, r.hectareas]), [[0, 0.212]])
  })

  it('accepts "Nombre propiedad" as well as "Predio"', () => {
    const header = [...HEADER]
    header[6] = 'Nombre propiedad'
    const rows = parsePropiedades(workbook({
      SITIOS: [header, ['1.-', 'ARTURO MORALES', null, 0.493, 'Acciones', 102, 'Sitio N°1']]
    }))

    assert.equal(rows[0].nombre_propiedad, 'Sitio N°1')
  })

  it('ignores sheets that are not one of the three property listings', () => {
    const rows = parsePropiedades(workbook({
      RESUMEN: [['Categoría', 'Cantidad'], ['sin_propietario', 16]],
      PARCELAS: [HEADER, ['1.-', 'JOSÉ SOTO', null, 8.954, 'Acciones', 1, 'Parcela N°1']]
    }))

    assert.equal(rows.length, 1)
    assert.equal(rows[0].hoja, 'PARCELAS')
  })

  it('finds the header even when the sheet opens with title rows', () => {
    const rows = parsePropiedades(workbook({
      PARCELAS: [
        ['LISTADO DE ACCIONISTAS 2025-2026'],
        [],
        HEADER,
        ['1.-', 'JOSÉ SOTO', null, 8.954, 'Acciones', 1, 'Parcela N°1']
      ]
    }))

    assert.equal(rows.length, 1)
    assert.equal(rows[0].fila, 4)
  })

  it('drops totals, blank rows and repeated section headers', () => {
    const rows = parsePropiedades(workbook({
      PARCELAS: [
        HEADER,
        ['1.-', 'JOSÉ SOTO', null, 8.954, 'Acciones', 1, 'Parcela N°1'],
        [],
        ['', 'TOTALES', null, 8.954],
        ['', 'Temporada 2025-2026'],
        ['2.-', 'ANA DÍAZ', null, 7.896, 'Acciones', 2, 'Parcela N°2']
      ]
    }))

    assert.deepEqual(rows.map(r => r.nombre), ['JOSÉ SOTO', 'ANA DÍAZ'])
  })

  it('keeps rows with no N° Socio so the preview can report them', () => {
    const rows = parsePropiedades(workbook({
      PARCELAS: [HEADER, ['9.-', 'SIN SOCIO', null, 1, 'Acciones', null, 'Parcela N°9']]
    }))

    assert.equal(rows.length, 1)
    assert.equal(rows[0].numero_socio, null)
  })
})
