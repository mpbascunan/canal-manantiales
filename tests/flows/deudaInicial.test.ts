import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { invoke, query, registerAllHandlers, resetDb, seedAccionista } from '../helpers/harness'
import { getDb } from '../../src/main/db/connection'
import type { Accionista, DeudaInicial, DeudaInicialConAccionista } from '../../src/shared/types'

describe('deuda inicial', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  let accionista: Accionista

  beforeEach(async () => {
    accionista = await seedAccionista('Juan')
  })

  const crear = (overrides: Partial<DeudaInicial> = {}) =>
    invoke<DeudaInicial>('deuda-inicial:create', {
      accionista_id: accionista.id,
      concepto: 'Multa temporada 2024-2025',
      tipo: 'MULTA',
      monto: 240_000,
      notas: null,
      ...overrides
    })

  it('records a line exactly as it was transcribed', async () => {
    const linea = await crear()

    assert.equal(linea.accionista_id, accionista.id)
    assert.equal(linea.concepto, 'Multa temporada 2024-2025')
    assert.equal(linea.tipo, 'MULTA')
    assert.equal(linea.monto, 240_000)
  })

  it('rounds the monto to whole pesos on the way in', async () => {
    const linea = await crear({ monto: 240_000.6 })

    assert.equal(linea.monto, 240_001)
  })

  it('lists an accionista\'s lines with CUOTA before MULTA', async () => {
    await crear({ concepto: 'Multa 2023-2024', tipo: 'MULTA', monto: 100_000 })
    await crear({ concepto: 'Cuota impaga 2023-2024', tipo: 'CUOTA', monto: 300_000 })

    const lineas = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', accionista.id)

    assert.deepEqual(lineas.map(l => l.tipo), ['CUOTA', 'MULTA'])
  })

  it('joins the accionista onto the full listing', async () => {
    await crear()

    const [row] = await invoke<DeudaInicialConAccionista[]>('deuda-inicial:list')

    assert.equal(row.nombre, 'Juan')
    assert.equal(row.monto, 240_000)
  })

  it('accepts OTRO, for debt that is neither a cuota nor a multa', async () => {
    const linea = await crear({ tipo: 'OTRO', concepto: 'Aporte obras 2024' })
    assert.equal(linea.tipo, 'OTRO')
  })

  it('refuses a tipo outside the three it knows', async () => {
    // `async` matters: better-sqlite3 is synchronous, so the CHECK constraint
    // throws before `invokeHandler` ever builds a promise.
    await assert.rejects(async () => crear({ tipo: 'CARGO' as DeudaInicial['tipo'] }))
  })

  it('updates a line', async () => {
    const linea = await crear()

    const updated = await invoke<DeudaInicial>('deuda-inicial:update', {
      ...linea, monto: 250_000, concepto: 'Multa temporada 2024-2025 (corregida)'
    })

    assert.equal(updated.monto, 250_000)
    assert.equal(updated.concepto, 'Multa temporada 2024-2025 (corregida)')
  })

  it('deletes a line', async () => {
    const linea = await crear()

    await invoke('deuda-inicial:delete', linea.id)

    assert.equal(query('SELECT id FROM deuda_inicial').length, 0)
  })

  it('replaces every line for an accionista in one go', async () => {
    await crear({ concepto: 'Vieja', monto: 111_000 })

    const lineas = await invoke<DeudaInicial[]>('deuda-inicial:replace-for-accionista', accionista.id, [
      { accionista_id: accionista.id, concepto: 'Cuota 2023-2024', tipo: 'CUOTA', monto: 300_000, notas: null },
      { accionista_id: accionista.id, concepto: 'Multa 2023-2024', tipo: 'MULTA', monto: 100_000, notas: null }
    ])

    assert.deepEqual(lineas.map(l => l.concepto), ['Cuota 2023-2024', 'Multa 2023-2024'])
    assert.equal(query('SELECT id FROM deuda_inicial').length, 2)
  })

  it('leaves other accionistas untouched when replacing', async () => {
    const otro = await seedAccionista('Pedro')
    await invoke('deuda-inicial:create', {
      accionista_id: otro.id, concepto: 'Multa 2022-2023', tipo: 'MULTA', monto: 50_000, notas: null
    })
    await crear()

    await invoke('deuda-inicial:replace-for-accionista', accionista.id, [])

    const restantes = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', otro.id)
    assert.equal(restantes.length, 1)
    assert.equal(restantes[0].monto, 50_000)
  })

  it('keeps the lines when the accionista is deactivated', async () => {
    // How the app actually retires someone — there is no delete channel. The
    // debt has to survive it, or deactivating a debtor would erase what they owe.
    await crear()

    await invoke('accionistas:update', {
      id: accionista.id, nombre: 'Juan', activo: false, propiedades: []
    })

    const lineas = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', accionista.id)
    assert.equal(lineas.length, 1)
  })

  it('cascades if an accionista row is ever deleted outright', async () => {
    await crear()

    getDb().prepare('DELETE FROM accionistas WHERE id = ?').run(accionista.id)

    assert.equal(query('SELECT id FROM deuda_inicial').length, 0)
  })
})
