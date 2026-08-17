import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  invoke, query, registerAllHandlers, resetDb, seedAccionista, seedTemporada
} from '../helpers/harness'
import type { Accionista, Pago, Temporada } from '../../src/shared/types'
import { calcularMontoAcciones } from '../../src/renderer/src/lib/formulas'

describe('pago completo', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  let temporada: Temporada
  let accionista: Accionista

  beforeEach(async () => {
    temporada = await seedTemporada({ valor_accion: 10_000 })
    accionista = await seedAccionista('Juan', [{ nombre: '84', tipo: 'PARCELA', acciones: 3, hectareas: 1 }])
  })

  const pagar = (over: Partial<Record<string, any>> = {}) =>
    invoke<Pago>('pagos:create', {
      numero_ingreso: 101,
      accionista_id: accionista.id,
      temporada_id: temporada.id,
      fecha: '2024-06-15',
      temporadas_pagadas: 1,
      monto_acciones: 40_000,
      multas: 0,
      total: 40_000,
      notas: null,
      ...over
    })

  it('stores the amount the renderer formula produces', async () => {
    const monto = calcularMontoAcciones(temporada.valor_accion, accionista.acciones, accionista.hectareas, 1)
    assert.equal(monto, 40_000)

    const pago = await pagar({ monto_acciones: monto, total: monto })

    assert.equal(pago.monto_acciones, 40_000)
    assert.equal(pago.total, 40_000)
    // The returned row is already joined for the receipt/listing screens.
    assert.equal(pago.accionista_nombre, 'Juan')
    assert.equal(pago.temporada_nombre, temporada.nombre)
  })

  it('stores whole pesos, whatever the form sends (D8)', async () => {
    // CLP has no minor unit. Rounding only at display let a column of receipts
    // add up to something other than the total printed beside them.
    const pago = await pagar({ monto_acciones: 40_000.4, multas: 2_000.5, total: 42_000.9 })

    assert.equal(pago.monto_acciones, 40_000)
    assert.equal(pago.multas, 2_001)
    assert.equal(pago.total, 42_001)

    const [stored] = query<{ monto_acciones: number; multas: number; total: number }>(
      'SELECT monto_acciones, multas, total FROM pagos WHERE id = ?', pago.id
    )
    assert.deepEqual(stored, { monto_acciones: 40_000, multas: 2_001, total: 42_001 })
  })

  it('refuses to reuse a receipt number (D16)', async () => {
    await pagar({ numero_ingreso: 700 })

    // One receipt from the physical talonario, one number, never reused.
    await assert.rejects(() => pagar({ numero_ingreso: 700, fecha: '2024-07-01' }), /UNIQUE/)
  })

  it('accepts any number of pagos with no receipt number recorded', async () => {
    await pagar({ numero_ingreso: 0 })
    await pagar({ numero_ingreso: 0, fecha: '2024-07-01' })

    assert.equal((await invoke<Pago[]>('pagos:list-by-accionista', accionista.id)).length, 2)
  })

  it('settles every cargo of the temporada for that accionista', async () => {
    const otro = await seedAccionista('Otro', [{ nombre: '2', tipo: 'SITIO', acciones: 1, hectareas: 0 }])
    const { id: cargoId } = await invoke<{ id: number }>('cargos:create', {
      nombre: 'Mantención canal', temporada_id: temporada.id, tarifa: 1_000,
      tipo_tarifa: 'proporcional', fecha: '2024-07-01', accionista_ids: [accionista.id, otro.id]
    })

    await pagar()

    const rows = query<{ accionista_id: number; pagado: number }>(
      'SELECT accionista_id, pagado FROM cargo_accionistas WHERE cargo_id = ?', cargoId
    )
    assert.equal(rows.find(r => r.accionista_id === accionista.id)!.pagado, 1)
    assert.equal(rows.find(r => r.accionista_id === otro.id)!.pagado, 0, 'other accionistas are untouched')
  })

  it('does not settle cargos that belong to another temporada', async () => {
    const otra = await seedTemporada({ nombre: 'Temporada 2025-2026', activa: false })
    const { id: cargoId } = await invoke<{ id: number }>('cargos:create', {
      nombre: 'Cargo futuro', temporada_id: otra.id, tarifa: 5_000,
      tipo_tarifa: 'fija', fecha: '2025-07-01', accionista_ids: [accionista.id]
    })

    await pagar()

    const [row] = query<{ pagado: number }>('SELECT pagado FROM cargo_accionistas WHERE cargo_id = ?', cargoId)
    assert.equal(row.pagado, 0)
  })

  it('lists pagos by month, by accionista and by temporada', async () => {
    await pagar({ numero_ingreso: 1, fecha: '2024-06-15' })
    await pagar({ numero_ingreso: 2, fecha: '2024-06-30' })
    await pagar({ numero_ingreso: 3, fecha: '2024-07-01' })

    const junio = await invoke<Pago[]>('pagos:list-by-month', 2024, 6)
    assert.deepEqual(junio.map(p => p.numero_ingreso), [1, 2])

    const julio = await invoke<Pago[]>('pagos:list-by-month', 2024, 7)
    assert.deepEqual(julio.map(p => p.numero_ingreso), [3])

    assert.equal((await invoke<Pago[]>('pagos:list-by-accionista', accionista.id)).length, 3)
    assert.equal((await invoke<Pago[]>('pagos:list-by-temporada', temporada.id)).length, 3)
    assert.equal((await invoke<Pago[]>('pagos:recent', 2)).length, 2)
  })

  it('deletes a pago', async () => {
    const pago = await pagar()

    await invoke('pagos:delete', pago.id)

    assert.deepEqual(await invoke<Pago[]>('pagos:list-by-accionista', accionista.id), [])
  })

  it('adds pagos and abonos together in the resumen contable', async () => {
    await pagar({ numero_ingreso: 1, fecha: '2024-06-15', monto_acciones: 40_000, multas: 2_000, total: 42_000 })
    await invoke('abonos:create', {
      numero_ingreso: 2, accionista_id: accionista.id, temporada_id: temporada.id,
      fecha: '2024-07-20', monto: 10_000, multas: 500, total: 10_500, notas: null
    })

    const resumen = await invoke<{ monto_acciones: number; multas: number; total: number }>(
      'pagos:resumen-contable', temporada.id
    )
    assert.equal(resumen.monto_acciones, 50_000)
    assert.equal(resumen.multas, 2_500)
    assert.equal(resumen.total, 52_500)

    const mensual = await invoke<any[]>('pagos:resumen-mensual', temporada.id)
    assert.deepEqual(mensual.map(m => [m.anio, m.mes, m.total]), [
      ['2024', '06', 42_000],
      ['2024', '07', 10_500]
    ])
  })

  it('keeps the resumen contable scoped to one temporada', async () => {
    const otra = await seedTemporada({ nombre: 'Temporada 2025-2026', activa: false })
    await pagar({ numero_ingreso: 1, total: 40_000 })
    await pagar({ numero_ingreso: 2, temporada_id: otra.id, total: 99_000 })

    const resumen = await invoke<{ total: number }>('pagos:resumen-contable', temporada.id)
    assert.equal(resumen.total, 40_000)
  })
})
