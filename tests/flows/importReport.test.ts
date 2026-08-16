import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import {
  armarDeudaNoImportada, armarNoImportados,
  buildDeudaNoImportadaWorkbook, buildNoImportadosWorkbook,
  type LineaDeudaRechazada, type ResumenDeudaNoImportada, type ResumenNoImportado
} from '../../src/renderer/src/lib/importReport'

/**
 * The report is the user's worklist after an import, so what matters is that it
 * accounts for every rejected row and for nothing that actually landed.
 */
const pago = (over: Partial<any> = {}) => ({
  numero_ingreso: 500, fecha: '2025-05-01', accionista_nombre: 'Juan Pérez',
  total: 20_000, fila: 10, otros: 0, numero_socio: null, ...over
})

const raw = (over: Partial<any> = {}) => ({
  fecha: '2025-05-01', numero_ingreso: 500, numero_socio: null,
  accionista_nombre: 'Juan Pérez', temporadas_pagadas: 1,
  monto_acciones: 18_000, multas: 2_000, total: 20_000, otros: 0, fila: 10, ...over
})

const base = (over: Partial<ResumenNoImportado> = {}): ResumenNoImportado => ({
  omitidas: [], con_otros_ingresos: [], duplicados_en_archivo: [], duplicates: [],
  sin_coincidencia: [], asignaciones: {}, rows: [], errores: [], ...over
})

describe('reporte de filas no importadas', () => {
  it('gathers every kind of rejection, ordered by row', () => {
    const filas = armarNoImportados(base({
      omitidas: [{ fila: 40, motivo: 'sin_accionista', numero_ingreso: 5410, accionista_nombre: '', total: 31_797 }],
      con_otros_ingresos: [pago({ fila: 10, numero_ingreso: 501, otros: 265, total: 20_265 })],
      duplicados_en_archivo: [pago({ fila: 30, numero_ingreso: 502 })],
      duplicates: [pago({ fila: 20, numero_ingreso: 503 })],
      sin_coincidencia: [{ nombre: 'María Figueroa C.', pagos: [pago({ fila: 50, numero_ingreso: 504 })] }],
      rows: [raw({ fila: 10, numero_ingreso: 501, otros: 265, total: 20_265 })]
    }))

    assert.deepEqual(filas.map(f => f.fila), [10, 20, 30, 40, 50])
    assert.deepEqual(filas.map(f => f.motivo), [
      'Cuota extraordinaria u otros ingresos',
      'Ya estaba registrado',
      'N° Ingreso repetido en el archivo',
      'Sin accionista',
      'Accionista no encontrado'
    ])
    // Every row says what to do about it.
    assert.equal(filas.every(f => f.accion.length > 0), true)
  })

  it('leaves out the names the user matched by hand — those did import', () => {
    const datos = base({
      sin_coincidencia: [
        { nombre: 'María Figueroa C.', pagos: [pago({ numero_ingreso: 600 })] },
        { nombre: 'Nadie De Nadie', pagos: [pago({ fila: 11, numero_ingreso: 601 })] }
      ],
      asignaciones: { 'María Figueroa C.': 7 }
    })

    const filas = armarNoImportados(datos)
    assert.deepEqual(filas.map(f => f.numero_ingreso), [601])
    assert.match(filas[0].accion, /Nadie De Nadie/)
  })

  it('recovers the amount breakdown from the parsed rows', () => {
    const [fila] = armarNoImportados(base({
      duplicates: [pago({ fila: 10, total: 20_000 })],
      rows: [raw({ fila: 10, monto_acciones: 18_000, multas: 2_000 })]
    }))

    assert.equal(fila.monto_acciones, 18_000)
    assert.equal(fila.multas, 2_000)
    assert.equal(fila.total, 20_000)
  })

  it('writes a sheet with a summary per motivo and one row each', () => {
    const wb = buildNoImportadosWorkbook(base({
      duplicates: [pago({ fila: 10, numero_ingreso: 500 }), pago({ fila: 11, numero_ingreso: 501 })],
      con_otros_ingresos: [pago({ fila: 12, numero_ingreso: 502, otros: 265, total: 20_265 })],
      rows: []
    }), 'Temporada 2025-2026')

    assert.deepEqual(wb.SheetNames, ['No importadas'])
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets['No importadas'], { header: 1, defval: null })

    assert.equal(rows[0][0], 'FILAS NO IMPORTADAS — Temporada 2025-2026')
    const totalRow = rows.find(r => r[0] === 'TOTAL')!
    assert.equal(totalRow[1], 3)
    assert.equal(totalRow[2], 60_265)

    // The detail header, then one row per rejection.
    const headerIdx = rows.findIndex(r => r[0] === 'Fila')
    assert.deepEqual(rows[headerIdx].slice(0, 6),
      ['Fila', 'Motivo', 'N° Ingreso', 'Fecha', 'N° Socio', 'Accionista'])
    assert.equal(rows.length - headerIdx - 1, 3)
  })

  it('adds a second sheet only for errors the detail sheet does not explain', () => {
    const sinErrores = buildNoImportadosWorkbook(base({ duplicates: [pago()] }), 'T')
    assert.deepEqual(sinErrores.SheetNames, ['No importadas'])

    // The import reports the same rejections as the preview. Repeating them
    // under a scarier heading would double the apparent number of problems.
    const yaExplicado = buildNoImportadosWorkbook(base({
      duplicates: [pago({ numero_ingreso: 500 })],
      errores: ['Accionista no encontrado: "Nadie" (N°500)']
    }), 'T')
    assert.deepEqual(yaExplicado.SheetNames, ['No importadas'])

    const inesperado = buildNoImportadosWorkbook(base({
      duplicates: [pago({ numero_ingreso: 500 })],
      errores: ['N°999 "Otro": UNIQUE constraint failed']
    }), 'T')
    assert.deepEqual(inesperado.SheetNames, ['No importadas', 'Errores'])
  })

  it('produces an empty report when everything imported', () => {
    assert.deepEqual(armarNoImportados(base()), [])
  })

  describe('deuda anterior', () => {
    const linea = (over: Partial<LineaDeudaRechazada> = {}): LineaDeudaRechazada => ({
      fila: 5, numero_socio: null, accionista_nombre: 'María Figueroa C.',
      concepto: 'Deuda temporada 2023-2024', tipo: 'CUOTA', monto: 480_000, ...over
    })

    const baseDeuda = (over: Partial<ResumenDeudaNoImportada> = {}): ResumenDeudaNoImportada => ({
      sin_coincidencia: [], asignaciones: {}, errores: [], ...over
    })

    it('lists every line of an unresolved name, ordered by row', () => {
      const filas = armarDeudaNoImportada(baseDeuda({
        sin_coincidencia: [{
          nombre: 'María Figueroa C.',
          lineas: [
            linea({ fila: 9, tipo: 'MULTA', monto: 240_000 }),
            linea({ fila: 5, tipo: 'CUOTA', monto: 480_000 })
          ]
        }]
      }))

      assert.deepEqual(filas.map(f => f.fila), [5, 9])
      assert.deepEqual(filas.map(f => f.tipo), ['Cuota', 'Multa'])
      assert.equal(filas.every(f => f.motivo === 'Accionista no encontrado'), true)
      assert.match(filas[0].accion, /María Figueroa C\./)
    })

    it('leaves out the names the user matched by hand', () => {
      const filas = armarDeudaNoImportada(baseDeuda({
        sin_coincidencia: [
          { nombre: 'María Figueroa C.', lineas: [linea()] },
          { nombre: 'Nadie De Nadie', lineas: [linea({ fila: 7, accionista_nombre: 'Nadie De Nadie' })] }
        ],
        asignaciones: { 'María Figueroa C.': 7 }
      }))

      assert.deepEqual(filas.map(f => f.accionista_nombre), ['Nadie De Nadie'])
    })

    it('writes its own columns and totals the amounts', () => {
      const wb = buildDeudaNoImportadaWorkbook(baseDeuda({
        sin_coincidencia: [{
          nombre: 'María Figueroa C.',
          lineas: [linea({ fila: 5, monto: 480_000 }), linea({ fila: 6, monto: 240_000 })]
        }]
      }))

      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets['No importadas'], { header: 1, defval: null })
      assert.equal(rows[0][0], 'DEUDA ANTERIOR NO IMPORTADA')

      const totalRow = rows.find(r => r[0] === 'TOTAL')!
      assert.deepEqual([totalRow[1], totalRow[2]], [2, 720_000])

      const headerIdx = rows.findIndex(r => r[0] === 'Fila')
      assert.deepEqual(rows[headerIdx],
        ['Fila', 'Motivo', 'N° Socio', 'Accionista', 'Concepto', 'Tipo', 'Monto', 'Qué hacer'])
    })

    it('only reports errors the detail sheet does not already explain', () => {
      const datos = baseDeuda({
        sin_coincidencia: [{ nombre: 'X', lineas: [linea({ fila: 9 })] }]
      })

      const yaExplicado = buildDeudaNoImportadaWorkbook({
        ...datos, errores: ['Fila 9: no se encontró el accionista "X"']
      })
      assert.deepEqual(yaExplicado.SheetNames, ['No importadas'])

      const inesperado = buildDeudaNoImportadaWorkbook({
        ...datos, errores: ['Fila 40: CHECK constraint failed']
      })
      assert.deepEqual(inesperado.SheetNames, ['No importadas', 'Errores'])
    })

    it('produces an empty report when everything imported', () => {
      assert.deepEqual(armarDeudaNoImportada(baseDeuda()), [])
    })
  })
})
