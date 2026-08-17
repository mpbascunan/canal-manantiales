import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  invoke, query, registerAllHandlers, resetDb, seedAccionista, seedTemporada
} from '../helpers/harness'
import type { Abono, Accionista, Temporada } from '../../src/shared/types'

describe('abonos', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  let temporada: Temporada
  let accionista: Accionista   // 5 acciones → a proporcional cargo of 1.000 costs 5.000

  beforeEach(async () => {
    temporada = await seedTemporada()
    accionista = await seedAccionista('Juan', [{ nombre: '84', tipo: 'PARCELA', acciones: 5, hectareas: 0 }])
  })

  const abonar = (over: Partial<Record<string, any>> = {}) =>
    invoke('abonos:create', {
      numero_ingreso: 1,
      accionista_id: accionista.id,
      temporada_id: temporada.id,
      fecha: '2024-06-15',
      monto: 2_000,
      multas: 0,
      total: 2_000,
      notas: null,
      ...over
    })

  const crearCargo = () =>
    invoke<{ id: number }>('cargos:create', {
      nombre: 'Mantención canal', temporada_id: temporada.id, tarifa: 1_000,
      tipo_tarifa: 'proporcional', fecha: '2024-07-01', notas: null,
      accionista_ids: [accionista.id]
    })

  const pagados = (cargoId: number) =>
    query<{ pagado: number }>('SELECT pagado FROM cargo_accionistas WHERE cargo_id = ?', cargoId)[0].pagado

  it('records the abono and joins it for the listings', async () => {
    await abonar({ monto: 3_000, multas: 500, total: 3_500 })

    const [abono] = await invoke<Abono[]>('abonos:list-by-accionista', accionista.id)
    assert.equal(abono.monto, 3_000)
    assert.equal(abono.multas, 500)
    assert.equal(abono.total, 3_500)
    assert.equal(abono.accionista_nombre, 'Juan')
    assert.equal(abono.temporada_nombre, temporada.nombre)
  })

  it('never flips the pagado flag, however much is abonado', async () => {
    // It used to, once the total abonado reached the pending cargos — which
    // spent the same money twice, since the abono also counted in full against
    // the cuota. `pagado` now means settled outside the abono flow only.
    const { id } = await crearCargo()   // 5.000 pending

    await abonar({ numero_ingreso: 1, total: 2_000 })
    assert.equal(pagados(id), 0)

    await abonar({ numero_ingreso: 2, monto: 50_000, total: 50_000 })
    assert.equal(pagados(id), 0)
  })

  it('spends each peso once across the cuota and the cargo', async () => {
    // 5 acciones × 10.000 = 50.000 cuota, plus a 5.000 cargo = 55.000 owed.
    // A 52.000 abono fills the cuota and leaves 2.000 for the cargo.
    await crearCargo()
    await abonar({ numero_ingreso: 1, monto: 52_000, total: 52_000 })

    const deuda = await invoke<any>('deudores:get-deuda', accionista.id, '2024-06-20')
    const [t] = deuda.temporadas

    assert.equal(t.pendiente_cuota, 0)
    assert.equal(t.cargos[0].abonado, 2_000)
    assert.equal(t.cargos[0].pendiente, 3_000)
    assert.equal(deuda.total_pendiente, 3_000)
  })

  it('covers the cuota before the cargo', async () => {
    await crearCargo()
    await abonar({ numero_ingreso: 1, monto: 20_000, total: 20_000 })

    const deuda = await invoke<any>('deudores:get-deuda', accionista.id, '2024-06-20')
    const [t] = deuda.temporadas

    assert.equal(t.abonado, 20_000)          // all of it went to the cuota
    assert.equal(t.cargos[0].abonado, 0)
    assert.equal(t.cargos[0].pendiente, 5_000)
  })

  it('stores whole pesos (D8)', async () => {
    // An abono is drawn down against debts that are themselves rounded, so a
    // fraction here would leave a cuota that never quite clears.
    await abonar({ monto: 2_000.4, multas: 500.6, total: 2_501 })

    const [abono] = await invoke<Abono[]>('abonos:list-by-accionista', accionista.id)
    assert.equal(abono.monto, 2_000)
    assert.equal(abono.multas, 501)
    assert.equal(abono.total, 2_501)
  })

  it('lists abonos by month and by temporada', async () => {
    const otra = await seedTemporada({ nombre: 'Temporada 2025-2026', activa: false })
    await abonar({ numero_ingreso: 1, fecha: '2024-06-15' })
    await abonar({ numero_ingreso: 2, fecha: '2024-07-02' })
    await abonar({ numero_ingreso: 3, fecha: '2025-07-02', temporada_id: otra.id })

    const junio = await invoke<Abono[]>('abonos:list-by-month', 2024, 6)
    assert.deepEqual(junio.map(a => a.numero_ingreso), [1])

    // Both halves of a temporada's ingresos are exported together (README 37).
    const deLaTemporada = await invoke<Abono[]>('abonos:list-by-temporada', temporada.id)
    assert.deepEqual(deLaTemporada.map(a => a.numero_ingreso), [1, 2])
  })

  it('deletes an abono', async () => {
    await abonar()
    const [abono] = await invoke<Abono[]>('abonos:list-by-accionista', accionista.id)

    await invoke('abonos:delete', abono.id)

    assert.deepEqual(await invoke<Abono[]>('abonos:list-by-accionista', accionista.id), [])
  })
})
