import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { invoke, query, registerAllHandlers, resetDb, seedAccionista } from '../helpers/harness'
import type { DeudaInicial, ImportResult } from '../../src/shared/types'
import type { DeudaInicialPreview } from '../../src/main/db/handlers/import'

describe('importación de deuda inicial', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  const fila = (overrides: Record<string, unknown> = {}) => ({
    numero_socio: null,
    accionista_nombre: 'Juan Pérez Soto',
    concepto: 'Multa temporada 2024-2025',
    tipo: 'MULTA',
    monto: 240_000,
    fila: 2,
    ...overrides
  })

  const seedJuan = () =>
    seedAccionista('Juan', undefined, {
      apellido_paterno: 'Pérez', apellido_materno: 'Soto', numero_socio: '042'
    })

  describe('matching', () => {
    it('matches on numero_socio in preference to the name', async () => {
      const juan = await seedJuan()
      // A different person's name, but Juan's socio number: the number wins.
      const preview = await invoke<DeudaInicialPreview>('import:preview-deuda-inicial', [
        fila({ numero_socio: '042', accionista_nombre: 'Nombre Mal Escrito' })
      ])

      assert.equal(preview.new_lineas.length, 1)
      assert.equal(preview.new_lineas[0].matched_by, 'numero_socio')

      await invoke('import:deuda-inicial', [
        fila({ numero_socio: '042', accionista_nombre: 'Nombre Mal Escrito' })
      ])
      const lineas = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.equal(lineas.length, 1)
    })

    it('falls back to the full name when there is no socio number', async () => {
      await seedJuan()
      const preview = await invoke<DeudaInicialPreview>('import:preview-deuda-inicial', [fila()])

      assert.equal(preview.new_lineas.length, 1)
      assert.equal(preview.new_lineas[0].matched_by, 'nombre')
    })

    it('reports rows it cannot match instead of inventing an accionista', async () => {
      await seedJuan()
      const preview = await invoke<DeudaInicialPreview>('import:preview-deuda-inicial', [
        fila({ accionista_nombre: 'Persona Inexistente', fila: 7 })
      ])

      assert.equal(preview.new_lineas.length, 0)
      assert.equal(preview.missing_accionistas.length, 1)
      assert.equal(preview.missing_accionistas[0].fila, 7)
    })

    it('matches a name that only differs by accent or capitals', async () => {
      // SQLite's LOWER() folds only A-Z, so this never matched before.
      await seedAccionista('JOSÉ MUÑOZ DÍAZ')

      const preview = await invoke<DeudaInicialPreview>('import:preview-deuda-inicial', [
        fila({ accionista_nombre: 'Jose Munoz Diaz' })
      ])

      assert.equal(preview.sin_coincidencia.length, 0)
      assert.equal(preview.new_lineas.length, 1)
    })

    it('groups unmatched names and suggests who they might be', async () => {
      await seedAccionista('MARIA PATRICIA FIGUEROA CUBILLOS')

      const preview = await invoke<DeudaInicialPreview>('import:preview-deuda-inicial', [
        fila({ accionista_nombre: 'María Patricia Figueroa C.', tipo: 'CUOTA', monto: 480_000, fila: 2 }),
        fila({ accionista_nombre: 'María Patricia Figueroa C.', tipo: 'MULTA', monto: 240_000, fila: 3 })
      ])

      // Both lines belong to one decision about one person.
      assert.equal(preview.sin_coincidencia.length, 1)
      const grupo = preview.sin_coincidencia[0]
      assert.equal(grupo.lineas.length, 2)
      assert.equal(grupo.total, 720_000)
      assert.equal(grupo.sugerencias[0].nombre, 'MARIA PATRICIA FIGUEROA CUBILLOS')
    })

    it('imports a name the user matched by hand, and only that one', async () => {
      const maria = await seedAccionista('MARIA PATRICIA FIGUEROA CUBILLOS')

      const result = await invoke<ImportResult>('import:deuda-inicial', [
        fila({ accionista_nombre: 'María Patricia Figueroa C.', fila: 2 }),
        fila({ accionista_nombre: 'Nadie De Nadie', fila: 3 })
      ], { 'María Patricia Figueroa C.': maria.id })

      assert.equal(result.imported, 1)
      assert.equal(result.skipped, 1)
      assert.match(result.errors[0], /Fila 3/)

      const lineas = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', maria.id)
      assert.equal(lineas.length, 1)
    })

    it('never lets a manual assignment override a real match', async () => {
      const juan = await seedJuan()
      const otro = await seedAccionista('Otra Persona')

      await invoke<ImportResult>('import:deuda-inicial', [
        fila({ numero_socio: '042' })
      ], { 'Juan Pérez Soto': otro.id })

      assert.equal((await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)).length, 1)
      assert.equal((await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', otro.id)).length, 0)
    })

    it('skips unmatched rows on import and says which ones', async () => {
      await seedJuan()
      const result = await invoke<ImportResult>('import:deuda-inicial', [
        fila(),
        fila({ accionista_nombre: 'Persona Inexistente', fila: 9 })
      ])

      assert.equal(result.imported, 1)
      assert.equal(result.skipped, 1)
      assert.match(result.errors[0], /Fila 9/)
    })
  })

  describe('replacing', () => {
    it('flags accionistas who already have lines', async () => {
      const juan = await seedJuan()
      await invoke('deuda-inicial:create', {
        accionista_id: juan.id, concepto: 'Anterior', tipo: 'MULTA', monto: 1_000, notas: null
      })

      const preview = await invoke<DeudaInicialPreview>('import:preview-deuda-inicial', [fila()])

      assert.equal(preview.new_lineas.length, 0)
      assert.equal(preview.reemplaza.length, 1)
    })

    it('replaces an accionista\'s lines rather than adding to them', async () => {
      const juan = await seedJuan()
      await invoke('deuda-inicial:create', {
        accionista_id: juan.id, concepto: 'Anterior', tipo: 'MULTA', monto: 1_000, notas: null
      })

      await invoke('import:deuda-inicial', [fila()])

      const lineas = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.equal(lineas.length, 1)
      assert.equal(lineas[0].monto, 240_000)
    })

    it('keeps every line when one accionista appears on several rows', async () => {
      // The replace is per accionista, not per row — a second row for the same
      // person must not wipe the first one.
      const juan = await seedJuan()
      await invoke('import:deuda-inicial', [
        fila({ concepto: 'Multa 2023-2024', monto: 100_000, fila: 2 }),
        fila({ concepto: 'Multa 2024-2025', monto: 240_000, fila: 3 })
      ])

      const lineas = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.deepEqual(lineas.map(l => l.monto), [100_000, 240_000])
    })

    it('leaves an accionista absent from the file untouched', async () => {
      const juan = await seedJuan()
      const pedro = await seedAccionista('Pedro', undefined, { numero_socio: '099' })
      await invoke('deuda-inicial:create', {
        accionista_id: pedro.id, concepto: 'Suya', tipo: 'MULTA', monto: 5_000, notas: null
      })

      await invoke('import:deuda-inicial', [fila()])

      assert.equal((await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)).length, 1)
      assert.equal((await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', pedro.id)).length, 1)
    })
  })

  describe('the stored line', () => {
    it('rounds the monto and records where it came from', async () => {
      const juan = await seedJuan()
      await invoke('import:deuda-inicial', [fila({ monto: 240_000.7, fila: 4 })])

      const [linea] = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.equal(linea.monto, 240_001)
      assert.match(linea.notas!, /fila 4/)
    })

    it('falls back to a default concepto when the sheet has none', async () => {
      const juan = await seedJuan()
      await invoke('import:deuda-inicial', [fila({ concepto: '' })])

      const [linea] = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.equal(linea.concepto, 'Deuda temporadas anteriores')
    })

    it('writes nothing at all when no row matches', async () => {
      await seedJuan()
      await invoke('import:deuda-inicial', [fila({ accionista_nombre: 'Nadie' })])

      assert.equal(query('SELECT id FROM deuda_inicial').length, 0)
    })

    it('carries the n° of temporadas the sheet declared', async () => {
      const juan = await seedJuan()
      await invoke('import:deuda-inicial', [fila({ temporadas_adeudadas: 3 })])

      const [linea] = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.equal(linea.temporadas_adeudadas, 3)
      // Still transcribed, not derived: the count does not touch the figure.
      assert.equal(linea.monto, 240_000)
    })

    it('stores null when the sheet had no temporadas column', async () => {
      const juan = await seedJuan()
      await invoke('import:deuda-inicial', [fila()])

      const [linea] = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.equal(linea.temporadas_adeudadas, null)
    })

    it('discards a count the sheet got wrong rather than storing a wrong one', async () => {
      const juan = await seedJuan()
      await invoke('import:deuda-inicial', [fila({ temporadas_adeudadas: 0 })])

      const [linea] = await invoke<DeudaInicial[]>('deuda-inicial:list-by-accionista', juan.id)
      assert.equal(linea.temporadas_adeudadas, null)
    })
  })

  it('shows the count in the preview, before anything is written', async () => {
    await seedJuan()
    const preview = await invoke<DeudaInicialPreview>('import:preview-deuda-inicial', [
      fila({ temporadas_adeudadas: 4 })
    ])

    assert.equal(preview.new_lineas[0].temporadas_adeudadas, 4)
    assert.equal(query('SELECT id FROM deuda_inicial').length, 0)
  })
})
