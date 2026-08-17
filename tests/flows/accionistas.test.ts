import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { invoke, registerAllHandlers, resetDb, seedAccionista, seedTemporada } from '../helpers/harness'
import type { Accionista, Propiedad } from '../../src/shared/types'

describe('accionistas y propiedades', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  it('sums acciones and hectareas across every propiedad', async () => {
    const created = await seedAccionista('Juan', [
      { nombre: 'Parcela N°84', tipo: 'PARCELA', acciones: 2.5, hectareas: 1 },
      { nombre: 'Sitio N°47-A', tipo: 'SITIO', acciones: 0.5, hectareas: 0.25 }
    ], { apellido_paterno: 'Pérez', apellido_materno: 'Soto', rut: '12.345.678-5' })

    assert.equal(created.acciones, 3)
    assert.equal(created.hectareas, 1.25)
    assert.equal(created.apellido_paterno, 'Pérez')
    assert.equal(created.rut, '12.345.678-5')

    // `nombres_propiedades` lists every propiedad, in id order.
    assert.deepEqual(created.nombres_propiedades!.split(', ').sort(), ['Parcela N°84', 'Sitio N°47-A'])
  })

  describe('N° socio (D17)', () => {
    it('refuses a number another accionista already holds', async () => {
      await seedAccionista('Juan', undefined, { numero_socio: '7' })

      await assert.rejects(
        () => seedAccionista('Ana', undefined, { numero_socio: '7' }),
        // Named, because "ya está en uso" is no help when 396 members exist.
        /ya está asignado a Juan/
      )
    })

    it('compares trimmed, the same way the database index does', async () => {
      await seedAccionista('Juan', undefined, { numero_socio: '7' })
      await assert.rejects(() => seedAccionista('Ana', undefined, { numero_socio: '  7 ' }))
    })

    it('lets an accionista keep their own number when edited', async () => {
      const juan = await seedAccionista('Juan', [], { numero_socio: '7' })

      const updated = await invoke<Accionista>('accionistas:update', {
        id: juan.id, nombre: 'Juan Carlos', numero_socio: '7', activo: true, propiedades: []
      })
      assert.equal(updated.numero_socio, '7')
    })

    it('refuses to move a number onto someone who is not its holder', async () => {
      await seedAccionista('Juan', [], { numero_socio: '7' })
      const ana = await seedAccionista('Ana', [], { numero_socio: '8' })

      await assert.rejects(() => invoke('accionistas:update', {
        id: ana.id, nombre: 'Ana', numero_socio: '7', activo: true, propiedades: []
      }), /ya está asignado a Juan/)
    })

    it('allows any number of accionistas with no number on file', async () => {
      // Many historical records carry none; blank is a state, not an identity.
      await seedAccionista('Sin Uno', [], { numero_socio: null })
      await seedAccionista('Sin Dos', [], { numero_socio: '' })
      await seedAccionista('Sin Tres', [])

      const todos = await invoke<Accionista[]>('accionistas:list')
      assert.equal(todos.length, 3)
    })
  })

  it('reports zeros for an accionista with no propiedades', async () => {
    const created = await seedAccionista('Sin Propiedades', [])

    assert.equal(created.acciones, 0)
    assert.equal(created.hectareas, 0)
    assert.equal(created.nombres_propiedades, null)
  })

  it('leaves out propiedades whose nombre is blank when building `nombres_propiedades`', async () => {
    const created = await seedAccionista('Ana', [
      { nombre: 'Parcela N°12', tipo: 'PARCELA', acciones: 1, hectareas: 0 },
      { nombre: '  ', tipo: 'SITIO', acciones: 1, hectareas: 0 }
    ])

    assert.equal(created.nombres_propiedades, 'Parcela N°12')
    assert.equal(created.acciones, 2)
  })

  it('replaces the propiedades on update instead of appending them', async () => {
    const created = await seedAccionista('Carlos', [
      { nombre: 'Parcela N°10', tipo: 'PARCELA', acciones: 4, hectareas: 0 },
      { nombre: 'Parcela N°11', tipo: 'PARCELA', acciones: 1, hectareas: 0 }
    ])

    const updated = await invoke<Accionista>('accionistas:update', {
      id: created.id,
      nombre: 'Carlos',
      apellido_paterno: 'Rojas',
      activo: true,
      propiedades: [{ nombre: 'Sitio N°10', tipo: 'SITIO', acciones: 2, hectareas: 3, marco: 'Marco 1' }]
    })

    assert.equal(updated.acciones, 2)
    assert.equal(updated.hectareas, 3)
    assert.equal(updated.nombres_propiedades, 'Sitio N°10')

    const props = await invoke<Propiedad[]>('propiedades:list', created.id)
    assert.equal(props.length, 1)
    assert.equal(props[0].tipo, 'SITIO')
    assert.equal(props[0].marco, 'Marco 1')
  })

  it('hides inactive accionistas unless they are asked for', async () => {
    const activo = await seedAccionista('Activo')
    const inactivo = await seedAccionista('Inactivo', undefined, { activo: false })

    const visible = await invoke<Accionista[]>('accionistas:list')
    assert.deepEqual(visible.map(a => a.id), [activo.id])

    const all = await invoke<Accionista[]>('accionistas:list', true)
    assert.deepEqual(all.map(a => a.id).sort(), [activo.id, inactivo.id].sort())
  })

  it('returns null for an id that does not exist', async () => {
    assert.equal(await invoke('accionistas:get', 999), null)
  })

  it('flags who has paid the temporada and who owes cargos', async () => {
    const temporada = await seedTemporada()
    const pagador = await seedAccionista('Pagador', [{ nombre: '1', tipo: 'PARCELA', acciones: 2, hectareas: 0 }])
    const moroso = await seedAccionista('Moroso', [{ nombre: '2', tipo: 'PARCELA', acciones: 2, hectareas: 0 }])

    await invoke('pagos:create', {
      numero_ingreso: 1, accionista_id: pagador.id, temporada_id: temporada.id,
      fecha: '2024-06-01', temporadas_pagadas: 1, monto_acciones: 20_000, multas: 0, total: 20_000, notas: null
    })
    await invoke('abonos:create', {
      numero_ingreso: 2, accionista_id: moroso.id, temporada_id: temporada.id,
      fecha: '2024-06-02', monto: 5_000, multas: 0, total: 5_000, notas: null
    })
    await invoke('cargos:create', {
      nombre: 'Reparación compuerta', temporada_id: temporada.id, tarifa: 3_000,
      tipo_tarifa: 'fija', fecha: '2024-07-01', accionista_ids: [moroso.id]
    })

    const rows = await invoke<any[]>('accionistas:with-pago-status', temporada.id)
    const byName = Object.fromEntries(rows.map(r => [r.nombre, r]))

    assert.equal(byName.Pagador.pago_temporada_activa, 1)
    assert.equal(byName.Pagador.total_abonado, 0)
    assert.equal(byName.Pagador.has_unpaid_cargos, 0)

    assert.equal(byName.Moroso.pago_temporada_activa, 0)
    assert.equal(byName.Moroso.total_abonado, 5_000)
    assert.equal(byName.Moroso.has_unpaid_cargos, 1)
    // No debt figure here any more: `temporadas_adeudadas` was dropped with D19,
    // and how much someone owes comes from `deudores:list-deuda`.
    assert.equal('dc_temporadas_adeudadas' in byName.Moroso, false)
  })
})
