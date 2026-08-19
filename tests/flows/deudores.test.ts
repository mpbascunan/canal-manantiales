import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  invoke, registerAllHandlers, resetDb, seedAccionista, seedTemporada
} from '../helpers/harness'
import type { Accionista, Temporada } from '../../src/shared/types'
import type { DeudaPorTemporada } from '../../src/shared/deuda'

/** One row of `deudores:list-deuda`: an accionista and everything they owe. */
interface FilaDeuda {
  id: number
  nombre: string
  acciones: number
  hectareas: number
  deuda: DeudaPorTemporada
}

/**
 * There is no `deudores:list`, `:get-config` or `:upsert-config` any more: they
 * were the scalar model, and D19 removed the column they read. Who is a deudor
 * is now one question with one answer — `deudores:list-deuda` returns the debt
 * every screen shows, computed by `calcularDeudaPorTemporada`.
 */
describe('deudores', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  let temporada: Temporada
  let accionista: Accionista

  // Fixed so a temporada's fecha_multa can be placed before or after "now".
  const HOY = '2024-08-01'

  beforeEach(async () => {
    temporada = await seedTemporada({ valor_accion: 10_000 })
    accionista = await seedAccionista('Juan', [{ nombre: '84', tipo: 'PARCELA', acciones: 3, hectareas: 1 }])
  })

  const pagarTemporada = () =>
    invoke('pagos:create', {
      numero_ingreso: 1, accionista_id: accionista.id, temporada_id: temporada.id,
      fecha: '2024-06-15', temporadas_pagadas: 1, monto_acciones: 40_000,
      multas: 0, total: 40_000, notas: null
    })

  const crearCargo = (accionistaIds: number[]) =>
    invoke<{ id: number }>('cargos:create', {
      nombre: 'Mantención canal', temporada_id: temporada.id, tarifa: 1_000,
      tipo_tarifa: 'proporcional', fecha: '2024-07-01', notas: null,
      accionista_ids: accionistaIds
    })

  const listaDeudores = () => invoke<FilaDeuda[]>('deudores:list-deuda', HOY)
  const nombresDeudores = async () => (await listaDeudores()).map(d => d.nombre)

  it('lists an accionista with no pago for the temporada', async () => {
    assert.deepEqual(await nombresDeudores(), ['Juan'])
  })

  it('drops an accionista once the temporada is paid', async () => {
    await pagarTemporada()
    assert.deepEqual(await nombresDeudores(), [])
  })

  it('re-opens a settled account when a later cargo goes unpaid', async () => {
    await pagarTemporada()
    assert.deepEqual(await nombresDeudores(), [], 'settled before the cargo exists')

    const { id } = await crearCargo([accionista.id])
    assert.deepEqual(await nombresDeudores(), ['Juan'], 'a late cargo re-opens the account')

    await invoke('cargos:set-pagado', id, accionista.id, true)
    assert.deepEqual(await nombresDeudores(), [])
  })

  it('never lists inactive accionistas', async () => {
    await seedAccionista('Inactivo', undefined, { activo: false })
    assert.deepEqual(await nombresDeudores(), ['Juan'])
  })

  it('charges every unpaid temporada, not only the active one', async () => {
    const otra = await seedTemporada({
      nombre: 'Temporada 2025-2026', activa: false,
      fecha_inicio: '2025-05-01', fecha_fin: '2026-04-30', valor_accion: 12_000
    })
    await pagarTemporada()

    const [juan] = await listaDeudores()
    assert.deepEqual(
      juan.deuda.temporadas.map(t => [t.temporada_id, t.pendiente_cuota]),
      [[otra.id, 48_000]],                 // 12.000 × 4 unidades, at *its own* rate
      'the paid season contributes nothing; the unpaid one is priced by its own valor_accion'
    )
  })

  it('reports each accionista their own cargos and abonos', async () => {
    const otro = await seedAccionista('Otro', [{ nombre: '2', tipo: 'SITIO', acciones: 1, hectareas: 0 }])
    const { id } = await crearCargo([accionista.id, otro.id])
    await invoke('cargos:set-pagado', id, otro.id, true)
    await invoke('abonos:create', {
      numero_ingreso: 1, accionista_id: accionista.id, temporada_id: temporada.id,
      fecha: '2024-06-20', monto: 2_000, multas: 0, total: 2_000, notas: null
    })

    const rows = await listaDeudores()
    const juan = rows.find(r => r.nombre === 'Juan')!
    const [tJuan] = juan.deuda.temporadas

    assert.equal(juan.acciones, 3)
    assert.equal(juan.hectareas, 1)
    assert.equal(tJuan.total_cargos, 4_000)          // 1.000 × (3 + 1)
    assert.equal(tJuan.pendiente_cargos, 4_000)
    assert.equal(juan.deuda.total_abonado, 2_000)

    // `Otro` paid the cargo and has no pago, so they stay listed with it settled.
    const otroRow = rows.find(r => r.nombre === 'Otro')!
    const [tOtro] = otroRow.deuda.temporadas
    assert.equal(tOtro.total_cargos, 1_000)
    assert.equal(tOtro.pendiente_cargos, 0)
  })

  it('prices the cuota, both kinds of cargo and the multa from one calculation', async () => {
    // Deadline already past, and the abono lands after it, so none of it counts
    // against the fine: it is frozen at fecha_multa (D6).
    temporada = await invoke<Temporada>('temporadas:update', {
      ...temporada, fecha_multa: '2020-01-01', monto_multa_por_accion: 500
    })

    await invoke('cargos:create', {
      nombre: 'Cuota extraordinaria', temporada_id: temporada.id, tarifa: 12_000,
      tipo_tarifa: 'fija', fecha: '2024-07-01', notas: null, accionista_ids: [accionista.id]
    })
    await crearCargo([accionista.id])   // proporcional: 1.000 × 4 = 4.000
    await invoke('abonos:create', {
      numero_ingreso: 1, accionista_id: accionista.id, temporada_id: temporada.id,
      fecha: '2024-06-20', monto: 5_000, multas: 0, total: 5_000, notas: null
    })

    const deuda = await invoke<DeudaPorTemporada>('deudores:get-deuda', accionista.id, HOY)

    assert.equal(deuda.total_cuotas, 40_000)         // 10.000 × 4 unidades
    assert.equal(deuda.total_cargos, 16_000)         // 12.000 fija + 4.000 proporcional
    assert.equal(deuda.total_multas, 2_000)          // 100% pendiente al plazo × 4 × 500
    assert.equal(deuda.total_abonado, 5_000)
    assert.equal(deuda.excedente, 0)
    // Abonos pay the cuota first (D3), so the cargos and the multa are untouched.
    assert.equal(deuda.total_pendiente, 53_000)      // 35.000 + 16.000 + 2.000
  })

  /**
   * The pago form passes its own `fecha` as `hoy`, so a receipt transcribed
   * late is priced as of the day the money arrived (D6 rule 5). Without this,
   * a payment made inside the plazo but typed up afterwards was fined for the
   * administration's delay.
   */
  describe('multa por atraso at a date other than today', () => {
    const PLAZO = '2024-07-15'

    beforeEach(async () => {
      temporada = await invoke<Temporada>('temporadas:update', {
        ...temporada, fecha_multa: PLAZO, monto_multa_por_accion: 500
      })
    })

    const multaAl = async (hoy: string) =>
      (await invoke<DeudaPorTemporada>('deudores:get-deuda', accionista.id, hoy)).total_multas

    it('waives it for a date on or before the deadline', async () => {
      assert.equal(await multaAl('2024-07-01'), 0)
      assert.equal(await multaAl(PLAZO), 0, 'the deadline day itself is still on time')
    })

    it('charges it for a date after the deadline', async () => {
      assert.equal(await multaAl('2024-07-16'), 2_000)   // 100% pendiente × 4 unidades × 500
      assert.equal(await multaAl(HOY), 2_000)
    })

    it('still charges an older temporada whose deadline the date is past', async () => {
      const vieja = await seedTemporada({
        nombre: 'Temporada 2022-2023', activa: false,
        fecha_inicio: '2022-05-01', fecha_fin: '2023-04-30', valor_accion: 8_000
      })
      await invoke('temporadas:update', {
        ...vieja, fecha_multa: '2022-12-01', monto_multa_por_accion: 400
      })

      // On time for the current temporada, years late for the old one.
      assert.equal(await multaAl('2024-07-01'), 1_600)   // 4 unidades × 400, only the old one
    })
  })
})
