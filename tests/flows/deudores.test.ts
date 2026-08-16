import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  invoke, registerAllHandlers, resetDb, seedAccionista, seedTemporada
} from '../helpers/harness'
import type { Accionista, Temporada } from '../../src/shared/types'
import { calcularDeuda, calcularMultaVencimiento, tieneMultaVencimiento } from '../../src/renderer/src/lib/formulas'

interface DeudorConfigResult {
  temporadas_adeudadas: number
  total_abonado: number
  total_cargos: number
  total_cargos_pagados: number
}

describe('deudores', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  let temporada: Temporada
  let accionista: Accionista

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

  const nombresDeudores = async () =>
    (await invoke<any[]>('deudores:list', temporada.id)).map(d => d.nombre)

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

  it('scopes the pago check to the temporada being asked about', async () => {
    const otra = await seedTemporada({ nombre: 'Temporada 2025-2026', activa: false })
    await pagarTemporada()

    const otros = await invoke<any[]>('deudores:list', otra.id)
    assert.deepEqual(otros.map(d => d.nombre), ['Juan'])
  })

  it('reports abonos and cargos per accionista', async () => {
    const otro = await seedAccionista('Otro', [{ nombre: '2', tipo: 'SITIO', acciones: 1, hectareas: 0 }])
    const { id } = await crearCargo([accionista.id, otro.id])
    await invoke('cargos:set-pagado', id, otro.id, true)
    // Kept under the 4.000 cargo on purpose: a larger abono would settle it
    // automatically (see tests/flows/abonos.test.ts).
    await invoke('abonos:create', {
      numero_ingreso: 1, accionista_id: accionista.id, temporada_id: temporada.id,
      fecha: '2024-06-20', monto: 2_000, multas: 0, total: 2_000, notas: null
    })

    const rows = await invoke<any[]>('deudores:list', temporada.id)
    const juan = rows.find(r => r.nombre === 'Juan')

    assert.equal(juan.acciones, 3)
    assert.equal(juan.hectareas, 1)
    assert.equal(juan.total_abonado, 2_000)
    assert.equal(juan.total_cargos, 4_000)          // 1.000 × (3 + 1)
    assert.equal(juan.total_cargos_pagados, 0)
    assert.equal(juan.has_full_payment, 0)
    assert.equal(juan.temporadas_adeudadas, 1)      // default when no config row exists

    // `Otro` paid the cargo and has no pago, so they stay listed with the cargo settled.
    const otroRow = rows.find(r => r.nombre === 'Otro')
    assert.equal(otroRow.total_cargos, 1_000)
    assert.equal(otroRow.total_cargos_pagados, 1_000)
  })

  it('stores and overwrites the temporadas adeudadas config', async () => {
    await invoke('deudores:upsert-config', {
      accionista_id: accionista.id, temporada_id: temporada.id, temporadas_adeudadas: 3
    })
    let cfg = await invoke<DeudorConfigResult>('deudores:get-config', accionista.id, temporada.id)
    assert.equal(cfg.temporadas_adeudadas, 3)

    await invoke('deudores:upsert-config', {
      accionista_id: accionista.id, temporada_id: temporada.id, temporadas_adeudadas: 2
    })
    cfg = await invoke<DeudorConfigResult>('deudores:get-config', accionista.id, temporada.id)
    assert.equal(cfg.temporadas_adeudadas, 2)
  })

  it('feeds calcularDeuda with the numbers the handler returns', async () => {
    // Deadline already past, so the vencimiento multa applies to the unpaid fraction.
    temporada = await invoke<Temporada>('temporadas:update', {
      ...temporada, fecha_multa: '2020-01-01', monto_multa_por_accion: 500
    })

    await invoke('deudores:upsert-config', {
      accionista_id: accionista.id, temporada_id: temporada.id, temporadas_adeudadas: 2
    })
    await invoke('cargos:create', {
      nombre: 'Cuota extraordinaria', temporada_id: temporada.id, tarifa: 12_000,
      tipo_tarifa: 'fija', fecha: '2024-07-01', notas: null, accionista_ids: [accionista.id]
    })
    await crearCargo([accionista.id])   // 1.000 × 4 = 4.000
    await invoke('abonos:create', {
      numero_ingreso: 1, accionista_id: accionista.id, temporada_id: temporada.id,
      fecha: '2024-06-20', monto: 5_000, multas: 0, total: 5_000, notas: null
    })

    const cfg = await invoke<DeudorConfigResult>('deudores:get-config', accionista.id, temporada.id)
    assert.deepEqual(cfg, {
      temporadas_adeudadas: 2,
      total_abonado: 5_000,
      total_cargos: 16_000,
      total_cargos_pagados: 0
    })

    assert.equal(tieneMultaVencimiento(temporada), true)
    const multaVencimiento = calcularMultaVencimiento(
      accionista.acciones, accionista.hectareas,
      temporada.monto_multa_por_accion, temporada.valor_accion, cfg.total_abonado
    )

    const deuda = calcularDeuda({
      valorAccion: temporada.valor_accion,
      acciones: accionista.acciones,
      hectareas: accionista.hectareas,
      temporadasAdeudadas: cfg.temporadas_adeudadas,
      totalAbonado: cfg.total_abonado,
      totalCargos: cfg.total_cargos,
      totalCargosPagados: cfg.total_cargos_pagados,
      montoPorAccion: temporada.monto_multa_por_accion,
      multaVencimiento
    })

    assert.deepEqual(deuda, {
      monto_acciones: 80_000,           // 10.000 × 4 units × 2 temporadas
      multas: 3_750,                    // 2.000 previas + 1.750 vencimiento (87,5% pendiente)
      subtotal: 83_750,
      total_cargos: 16_000,
      total_cargos_pendientes: 16_000,
      total: 99_750,
      abonado: 5_000,
      pendiente: 94_750                 // (83.750 − 5.000) + 16.000
    })
  })
})
