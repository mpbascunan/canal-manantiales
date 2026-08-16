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
  })
})
