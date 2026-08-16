import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { invoke, registerAllHandlers, resetDb, seedAccionista, seedTemporada } from '../helpers/harness'
import type { Accionista, Temporada } from '../../src/shared/types'
import type { DeudaPorTemporada } from '../../src/shared/deuda'

/**
 * `deudores:get-deuda` end to end: real rows in, the shared engine's breakdown
 * out. Covers what the SQL assembly can get wrong — which temporadas are
 * included, and how each cargo's amount is resolved.
 */
describe('deuda completa de un accionista', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  const HOY = '2027-06-01'

  let t2025: Temporada
  let t2026: Temporada
  let juan: Accionista   // 10 acciones + 2 hectáreas = 12 unidades

  beforeEach(async () => {
    t2025 = await seedTemporada({
      nombre: 'Temporada 2025-2026', fecha_inicio: '2025-03-01', fecha_fin: '2026-02-28',
      valor_accion: 40_000, fecha_multa: '2025-11-30', monto_multa_por_accion: 5_000,
      activa: false
    })
    t2026 = await seedTemporada({
      nombre: 'Temporada 2026-2027', fecha_inicio: '2026-03-01', fecha_fin: '2027-02-28',
      valor_accion: 40_000, fecha_multa: '2026-11-30', monto_multa_por_accion: 5_000
    })
    juan = await seedAccionista('Juan', [
      { nombre: '84', tipo: 'PARCELA', acciones: 10, hectareas: 2 }
    ])
  })

  const deuda = () => invoke<DeudaPorTemporada>('deudores:get-deuda', juan.id, HOY)

  const abonar = (fecha: string, total: number, temporadaId = t2026.id) =>
    invoke('abonos:create', {
      numero_ingreso: 0, accionista_id: juan.id, temporada_id: temporadaId,
      fecha, monto: total, multas: 0, total, notas: null
    })

  const pagar = (temporadaId: number) =>
    invoke('pagos:create', {
      numero_ingreso: 1, accionista_id: juan.id, temporada_id: temporadaId,
      fecha: '2026-01-15', temporadas_pagadas: 1, monto_acciones: 480_000,
      multas: 0, total: 480_000, notas: null
    })

  const crearCargo = (temporadaId: number, over: Record<string, unknown> = {}) =>
    invoke<{ id: number }>('cargos:create', {
      nombre: 'Limpia de acequia', temporada_id: temporadaId, tarifa: 1_000,
      tipo_tarifa: 'proporcional', fecha: '2026-07-01', notas: null,
      accionista_ids: [juan.id], ...over
    })

  it('prices each temporada with its own valor_accion and multa', async () => {
    const d = await deuda()

    assert.deepEqual(d.temporadas.map(t => t.nombre), ['Temporada 2025-2026', 'Temporada 2026-2027'])
    assert.equal(d.total_cuotas, 960_000)
    assert.equal(d.total_multas, 120_000)   // both deadlines passed, nothing abonado
    assert.equal(d.total_pendiente, 1_080_000)
  })

  it('credits an abono against the deadline it arrived before', async () => {
    await abonar('2025-10-01', 100_000)

    const d = await deuda()
    const [primera] = d.temporadas

    assert.equal(primera.abonado, 100_000)
    assert.equal(primera.multa, 47_500)   // 380.000/480.000 pending × 12 × 5.000
  })

  it('resolves a proporcional cargo as tarifa × unidades', async () => {
    await crearCargo(t2026.id)

    const d = await deuda()
    const segunda = d.temporadas[1]

    assert.equal(segunda.cargos[0].monto, 12_000)  // 1.000 × 12 unidades
    assert.equal(segunda.cargos[0].pendiente, 12_000)
  })

  it('resolves a fija cargo as the flat tarifa', async () => {
    await crearCargo(t2026.id, { tipo_tarifa: 'fija', tarifa: 7_500 })

    const d = await deuda()
    assert.equal(d.temporadas[1].cargos[0].monto, 7_500)
  })

  describe('a pago settles the temporada', () => {
    it('drops it from the breakdown entirely', async () => {
      await pagar(t2025.id)

      const d = await deuda()
      assert.deepEqual(d.temporadas.map(t => t.nombre), ['Temporada 2026-2027'])
    })

    it('charges no multa for it even though the deadline passed', async () => {
      await pagar(t2025.id)

      const d = await deuda()
      assert.equal(d.total_multas, 60_000)  // only 2026-2027's
    })
  })

  describe('a late cargo re-opens a settled temporada (D11)', () => {
    it('brings the temporada back with only the cargo owing', async () => {
      await pagar(t2025.id)
      await crearCargo(t2025.id)

      const d = await deuda()
      const reabierta = d.temporadas.find(t => t.nombre === 'Temporada 2025-2026')!

      assert.equal(reabierta.pagada, true)
      assert.equal(reabierta.cuota, 0)
      assert.equal(reabierta.multa, 0)
      assert.equal(reabierta.pendiente, 12_000)  // the cargo alone
    })

    it('drops it again once that cargo is settled by hand', async () => {
      await pagar(t2025.id)
      const cargo = await crearCargo(t2025.id)
      await invoke('cargos:set-pagado', cargo.id, juan.id, true)

      const d = await deuda()
      assert.deepEqual(d.temporadas.map(t => t.nombre), ['Temporada 2026-2027'])
    })
  })

  describe('deuda inicial', () => {
    it('is consumed before any temporada', async () => {
      await invoke('deuda-inicial:create', {
        accionista_id: juan.id, concepto: 'Multa 2024-2025', tipo: 'MULTA',
        monto: 200_000, notas: null
      })
      await abonar('2025-04-01', 250_000)

      const d = await deuda()

      assert.equal(d.deuda_inicial[0].pendiente, 0)
      assert.equal(d.temporadas[0].abonado, 50_000)  // only the remainder
    })

    it('adds to the total owed', async () => {
      await invoke('deuda-inicial:create', {
        accionista_id: juan.id, concepto: 'Multa 2024-2025', tipo: 'MULTA',
        monto: 200_000, notas: null
      })

      const d = await deuda()
      assert.equal(d.total_deuda_inicial, 200_000)
      assert.equal(d.total_pendiente, 1_280_000)
    })
  })

  describe('the deudores listing', () => {
    it('returns the same breakdown as the single-accionista call', async () => {
      const uno = await invoke<DeudaPorTemporada>('deudores:get-deuda', juan.id, HOY)
      const [fila] = await invoke<any[]>('deudores:list-deuda', HOY)

      assert.equal(fila.id, juan.id)
      assert.deepEqual(fila.deuda, uno)
    })

    it('leaves out accionistas with nothing pending', async () => {
      await seedAccionista('Sin deuda', [])   // no propiedades, so no cuota

      const filas = await invoke<any[]>('deudores:list-deuda', HOY)

      assert.deepEqual(filas.map(f => f.nombre), ['Juan'])
    })

    it('leaves out inactive accionistas', async () => {
      await invoke('accionistas:update', {
        id: juan.id, nombre: 'Juan', activo: false, propiedades: []
      })

      assert.deepEqual(await invoke<any[]>('deudores:list-deuda', HOY), [])
    })
  })

  it('owes nothing when there are no propiedades', async () => {
    const sinTierra = await seedAccionista('Pedro', [])

    const d = await invoke<DeudaPorTemporada>('deudores:get-deuda', sinTierra.id, HOY)

    assert.equal(d.total_cuotas, 0)
    assert.equal(d.total_multas, 0)
    assert.equal(d.total_pendiente, 0)
  })
})
