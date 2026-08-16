import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  invoke, query, registerAllHandlers, resetDb, seedAccionista, seedTemporada
} from '../helpers/harness'
import type { Accionista, Cargo, CargoConAccionistas, CargoResumen, Temporada } from '../../src/shared/types'

describe('cargos', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  let temporada: Temporada
  let grande: Accionista   // 4 acciones + 2 hectareas = 6 units
  let chico: Accionista    // 1 accion  + 0 hectareas = 1 unit

  beforeEach(async () => {
    temporada = await seedTemporada()
    grande = await seedAccionista('Grande', [{ nombre: '1', tipo: 'PARCELA', acciones: 4, hectareas: 2 }])
    chico  = await seedAccionista('Chico',  [{ nombre: '2', tipo: 'SITIO',   acciones: 1, hectareas: 0 }])
  })

  const crearCargo = (tipo_tarifa: 'proporcional' | 'fija', tarifa: number, ids: number[]) =>
    invoke<{ success: boolean; id: number }>('cargos:create', {
      nombre: tipo_tarifa === 'fija' ? 'Cuota fija' : 'Mantención canal',
      temporada_id: temporada.id,
      tarifa,
      tipo_tarifa,
      fecha: '2024-07-01',
      notas: null,
      accionista_ids: ids
    })

  it('charges tarifa × (acciones + hectareas) for a cargo proporcional', async () => {
    const { id } = await crearCargo('proporcional', 1_000, [grande.id, chico.id])

    const cargo = await invoke<CargoConAccionistas>('cargos:get-with-accionistas', id)
    const montos = Object.fromEntries(cargo.accionistas.map(a => [a.nombre, a.monto]))

    assert.equal(montos.Grande, 6_000)
    assert.equal(montos.Chico, 1_000)
    assert.equal(cargo.tipo_tarifa, 'proporcional')
  })

  it('charges the same tarifa to everyone for a cargo fijo', async () => {
    const { id } = await crearCargo('fija', 25_000, [grande.id, chico.id])

    const cargo = await invoke<CargoConAccionistas>('cargos:get-with-accionistas', id)
    assert.deepEqual(cargo.accionistas.map(a => a.monto), [25_000, 25_000])
  })

  it('recomputes a cargo proporcional after the propiedades change', async () => {
    const { id } = await crearCargo('proporcional', 1_000, [grande.id])

    // The client edits the accionista: 6 units become 10.
    await invoke('accionistas:update', {
      id: grande.id,
      nombre: 'Grande',
      activo: true,
      propiedades: [{ nombre: '1', tipo: 'PARCELA', acciones: 8, hectareas: 2 }]
    })

    const [cargo] = await invoke<any[]>('cargos:list-by-accionista', grande.id, temporada.id)
    assert.equal(cargo.monto, 10_000, 'proporcional cargos are recomputed live from propiedades')
    assert.equal(cargo.id, id)

    // A cargo fijo is not affected by the same edit.
    const fijo = await crearCargo('fija', 7_000, [grande.id])
    const rows = await invoke<any[]>('cargos:list-by-accionista', grande.id, temporada.id)
    assert.equal(rows.find(r => r.id === fijo.id).monto, 7_000)
  })

  it('adds and removes accionistas on an existing cargo', async () => {
    const { id } = await crearCargo('proporcional', 500, [grande.id])

    await invoke('cargos:add-accionistas', id, [chico.id])
    let cargo = await invoke<CargoConAccionistas>('cargos:get-with-accionistas', id)
    assert.deepEqual(cargo.accionistas.map(a => a.nombre), ['Chico', 'Grande'])
    assert.equal(cargo.accionistas.find(a => a.nombre === 'Chico')!.monto, 500)

    // Adding the same accionista twice is a no-op, not a duplicate row.
    await invoke('cargos:add-accionistas', id, [chico.id])
    cargo = await invoke<CargoConAccionistas>('cargos:get-with-accionistas', id)
    assert.equal(cargo.accionistas.length, 2)

    await invoke('cargos:remove-accionista', id, chico.id)
    cargo = await invoke<CargoConAccionistas>('cargos:get-with-accionistas', id)
    assert.deepEqual(cargo.accionistas.map(a => a.nombre), ['Grande'])
  })

  it('summarises emitted versus collected amounts', async () => {
    const { id } = await crearCargo('proporcional', 1_000, [grande.id, chico.id])

    await invoke('cargos:set-pagado', id, chico.id, true)

    const [listed] = await invoke<Cargo[]>('cargos:list-by-temporada', temporada.id)
    assert.equal(listed.accionista_count, 2)
    assert.equal(listed.total_monto, 7_000)
    assert.equal(listed.pagados_count, 1)

    const [resumen] = await invoke<CargoResumen[]>('cargos:resumen-by-temporada', temporada.id)
    assert.equal(resumen.total_emitido, 7_000)
    assert.equal(resumen.total_cobrado, 1_000)

    await invoke('cargos:set-pagado', id, chico.id, false)
    const [afterUndo] = await invoke<CargoResumen[]>('cargos:resumen-by-temporada', temporada.id)
    assert.equal(afterUndo.total_cobrado, 0)
  })

  it('deletes the junction rows along with the cargo', async () => {
    const { id } = await crearCargo('proporcional', 1_000, [grande.id, chico.id])

    await invoke('cargos:delete', id)

    assert.equal(await invoke('cargos:get-with-accionistas', id), null)
    assert.equal(query('SELECT id FROM cargo_accionistas WHERE cargo_id = ?', id).length, 0)
  })

  it('only lists cargos of the temporada that was asked for', async () => {
    const otra = await seedTemporada({ nombre: 'Temporada 2025-2026', activa: false })
    await crearCargo('fija', 1_000, [grande.id])
    await invoke('cargos:create', {
      nombre: 'Cargo de otra temporada', temporada_id: otra.id, tarifa: 9_000,
      tipo_tarifa: 'fija', fecha: '2025-07-01', accionista_ids: [grande.id]
    })

    const actual = await invoke<Cargo[]>('cargos:list-by-temporada', temporada.id)
    assert.deepEqual(actual.map(c => c.nombre), ['Cuota fija'])

    const delAccionista = await invoke<any[]>('cargos:list-by-accionista', grande.id, otra.id)
    assert.deepEqual(delAccionista.map(c => c.nombre), ['Cargo de otra temporada'])
  })
})
