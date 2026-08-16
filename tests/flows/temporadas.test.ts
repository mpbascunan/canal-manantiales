import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { invoke, query, registerAllHandlers, resetDb, seedTemporada } from '../helpers/harness'
import type { Temporada } from '../../src/shared/types'

describe('temporadas', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  it('creates a temporada and returns the stored row', async () => {
    const t = await seedTemporada({
      nombre: 'Temporada 2025-2026',
      valor_accion: 12_500,
      fecha_multa: '2025-10-31',
      monto_multa_por_accion: 800
    })

    assert.equal(t.nombre, 'Temporada 2025-2026')
    assert.equal(t.valor_accion, 12_500)
    assert.equal(t.fecha_multa, '2025-10-31')
    assert.equal(t.monto_multa_por_accion, 800)
    assert.equal(t.activa, 1)
  })

  it('defaults the deadline fields when they are omitted', async () => {
    const t = await seedTemporada({ fecha_multa: null })

    assert.equal(t.fecha_multa, null)
    assert.equal(t.monto_multa_por_accion, 0)
  })

  it('keeps exactly one temporada activa', async () => {
    const first = await seedTemporada({ nombre: 'Temporada 2023-2024' })
    const second = await seedTemporada({ nombre: 'Temporada 2024-2025', activa: false })

    await invoke('temporadas:set-active', second.id)

    const active = await invoke<Temporada>('temporadas:get-active')
    assert.equal(active.id, second.id)

    const activas = query<{ id: number }>('SELECT id FROM temporadas WHERE activa = 1')
    assert.deepEqual(activas.map(r => r.id), [second.id])

    // …and switching back deactivates the other one.
    await invoke('temporadas:set-active', first.id)
    assert.equal((await invoke<Temporada>('temporadas:get-active')).id, first.id)
  })

  it('updates a temporada without disturbing which one is activa', async () => {
    const t = await seedTemporada({ activa: true })

    const updated = await invoke<Temporada>('temporadas:update', {
      ...t,
      valor_accion: 15_000,
      nota_aviso: 'Pago hasta el 30 de octubre'
    })

    assert.equal(updated.valor_accion, 15_000)
    assert.equal(updated.nota_aviso, 'Pago hasta el 30 de octubre')
    assert.equal(updated.activa, 1)
  })

  it('lists temporadas newest name first', async () => {
    await seedTemporada({ nombre: 'Temporada 2023-2024', activa: false })
    await seedTemporada({ nombre: 'Temporada 2025-2026', activa: false })
    await seedTemporada({ nombre: 'Temporada 2024-2025', activa: true })

    const list = await invoke<Temporada[]>('temporadas:list')
    assert.deepEqual(
      list.map(t => t.nombre),
      ['Temporada 2025-2026', 'Temporada 2024-2025', 'Temporada 2023-2024']
    )
  })
})
