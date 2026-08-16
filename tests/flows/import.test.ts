import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  invoke, registerAllHandlers, resetDb, seedAccionista, seedTemporada
} from '../helpers/harness'
import type { Accionista, ImportResult, Pago, Propiedad, Temporada } from '../../src/shared/types'
import type { AccionistasPreview, PagosPreview } from '../../src/main/db/handlers/import'

describe('importación desde Excel', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  let temporada: Temporada

  beforeEach(async () => {
    temporada = await seedTemporada()
  })

  const filaPropiedad = (over: Record<string, any> = {}) => ({
    numero_socio: '7', nombre: 'Juan Pérez', tipo: 'PARCELA',
    nombre_propiedad: 'Parcela N°84', acciones: 2, hectareas: 0,
    hoja: 'PARCELAS', fila: 2, ...over
  })

  describe('accionistas', () => {
    it('groups the rows of one N° Socio into a single accionista', async () => {
      const preview = await invoke<AccionistasPreview>('import:preview-accionistas', [
        filaPropiedad(),
        filaPropiedad({ nombre_propiedad: 'Parcela N°85', fila: 3 }),
        filaPropiedad({ numero_socio: '9', nombre: 'Ana Soto', nombre_propiedad: 'Sitio N°12', fila: 4 })
      ])

      assert.equal(preview.actualizados.length, 0)
      assert.deepEqual(preview.nuevos.map(g => g.numero_socio), ['7', '9'])
      assert.deepEqual(
        preview.nuevos[0].propiedades.map(p => p.nombre),
        ['Parcela N°84', 'Parcela N°85']
      )
      assert.equal(preview.nuevos[0].total_acciones, 4)
    })

    it('matches an existing accionista by N° Socio even when the name differs', async () => {
      const juan = await seedAccionista(
        'Juan Pérez', [{ nombre: 'Parcela N°84', tipo: 'PARCELA', acciones: 2, hectareas: 0 }],
        { numero_socio: '7' }
      )

      const preview = await invoke<AccionistasPreview>('import:preview-accionistas', [
        filaPropiedad({ nombre: 'JUAN PEREZ SOTO' })
      ])

      assert.equal(preview.nuevos.length, 0)
      assert.equal(preview.actualizados.length, 1)
      assert.equal(preview.actualizados[0].accionista_id, juan.id)
      assert.equal(preview.actualizados[0].propiedades_actuales, 1)
      assert.equal(preview.actualizados[0].nombre_actual, 'Juan Pérez')
    })

    it('never matches by name — a socio number absent from the database is new', async () => {
      await seedAccionista('Juan Pérez')   // seeded without a numero_socio

      const preview = await invoke<AccionistasPreview>('import:preview-accionistas', [
        filaPropiedad()
      ])

      assert.equal(preview.actualizados.length, 0)
      assert.deepEqual(preview.nuevos.map(g => g.nombre), ['Juan Pérez'])
    })

    it('reports rows with no N° Socio instead of guessing who they belong to', async () => {
      const preview = await invoke<AccionistasPreview>('import:preview-accionistas', [
        filaPropiedad({ numero_socio: null, fila: 12 })
      ])

      assert.equal(preview.nuevos.length, 0)
      assert.deepEqual(preview.sin_socio, [{ nombre: 'Juan Pérez', hoja: 'PARCELAS', fila: 12 }])
    })

    it('creates the accionista with its N° Socio and every propiedad', async () => {
      const result = await invoke<ImportResult>('import:accionistas', [
        filaPropiedad(),
        filaPropiedad({ nombre_propiedad: 'Sitio N°85', tipo: 'SITIO', acciones: 0, hectareas: 0.5, fila: 3 }),
        filaPropiedad({ numero_socio: null, fila: 4 })     // no socio — skipped
      ])

      assert.deepEqual(result, {
        imported: 2, skipped: 1,
        errors: ['PARCELAS fila 4: sin N° Socio ("Juan Pérez")']
      })

      const [juan] = await invoke<Accionista[]>('accionistas:list')
      assert.equal(juan.nombre, 'Juan Pérez')
      assert.equal(juan.numero_socio, '7')
      assert.equal(juan.acciones, 2)
      assert.equal(juan.hectareas, 0.5)
      assert.deepEqual(
        juan.nombres_propiedades!.split(', ').sort(),
        ['Parcela N°84', 'Sitio N°85']
      )
    })

    it('replaces the propiedades of an accionista the file names', async () => {
      const juan = await seedAccionista(
        'Juan Pérez',
        [
          { nombre: 'Parcela N°84', tipo: 'PARCELA', acciones: 2, hectareas: 0 },
          { nombre: 'Parcela vendida', tipo: 'PARCELA', acciones: 5, hectareas: 0 }
        ],
        { numero_socio: '7' }
      )
      // Untouched: this accionista does not appear in the file.
      const ana = await seedAccionista(
        'Ana Soto', [{ nombre: 'Sitio N°12', tipo: 'SITIO', acciones: 1, hectareas: 0 }],
        { numero_socio: '9' }
      )

      const result = await invoke<ImportResult>('import:accionistas', [
        filaPropiedad({ nombre: 'JUAN PEREZ SOTO', acciones: 3 })
      ])

      assert.deepEqual(result, { imported: 1, skipped: 0, errors: [] })

      const props = await invoke<Propiedad[]>('propiedades:list', juan.id)
      assert.deepEqual(props.map(p => p.nombre), ['Parcela N°84'])

      const refreshed = await invoke<Accionista>('accionistas:get', juan.id)
      assert.equal(refreshed.acciones, 3)
      // The stored name wins: it may have been split into apellidos by hand.
      assert.equal(refreshed.nombre, 'Juan Pérez')

      const anaProps = await invoke<Propiedad[]>('propiedades:list', ana.id)
      assert.equal(anaProps.length, 1)
    })
  })

  describe('pagos', () => {
    beforeEach(async () => {
      await seedAccionista('Juan Pérez')
    })

    const filaPago = (over: Record<string, any> = {}) => ({
      numero_ingreso: 500, fecha: '2024-06-15', numero_socio: null,
      accionista_nombre: 'Juan Pérez',
      temporadas_pagadas: 1, monto_acciones: 20_000, multas: 0, total: 20_000, ...over
    })

    it('separates importable rows from duplicates and unknown accionistas', async () => {
      await invoke<ImportResult>('import:pagos', [filaPago({ numero_ingreso: 500 })], temporada.id)

      const preview = await invoke<PagosPreview>('import:preview-pagos', [
        filaPago({ numero_ingreso: 500 }),                                    // already imported
        filaPago({ numero_ingreso: 501 }),                                    // importable
        filaPago({ numero_ingreso: 502, accionista_nombre: 'Nadie' })         // unknown accionista
      ], temporada.id)

      assert.deepEqual(preview.duplicates.map(r => r.numero_ingreso), [500])
      assert.deepEqual(preview.new_pagos.map(r => r.numero_ingreso), [501])
      assert.deepEqual(preview.missing_accionistas.map(r => r.numero_ingreso), [502])
    })

    it('imports pagos against the chosen temporada', async () => {
      const result = await invoke<ImportResult>('import:pagos', [
        filaPago({ numero_ingreso: 500 }),
        filaPago({ numero_ingreso: 501, fecha: '2024-07-01', total: 21_000 })
      ], temporada.id)

      assert.equal(result.imported, 2)

      const pagos = await invoke<Pago[]>('pagos:list-by-temporada', temporada.id)
      assert.deepEqual(pagos.map(p => p.numero_ingreso), [500, 501])
      assert.equal(pagos[0].accionista_nombre, 'Juan Pérez')
      assert.equal(pagos[1].total, 21_000)
    })

    it('flags a N° Ingreso reused inside the file, which the import would swallow', async () => {
      const preview = await invoke<PagosPreview>('import:preview-pagos', [
        filaPago({ numero_ingreso: 600, total: 10_000 }),
        filaPago({ numero_ingreso: 600, total: 90_000 })   // same receipt number, other payment
      ], temporada.id)

      assert.deepEqual(preview.new_pagos.map(r => r.total), [10_000])
      assert.deepEqual(preview.duplicados_en_archivo.map(r => r.total), [90_000])
    })

    it('matches accionistas ignoring case, accents and abbreviating periods', async () => {
      // The listado is typed in capitals with accents; the ingresos sheet is not.
      // SQLite's LOWER() only folds A-Z, so this used to never match.
      await seedAccionista('JOSÉ MUÑOZ DÍAZ')

      const preview = await invoke<PagosPreview>('import:preview-pagos', [
        filaPago({ numero_ingreso: 610, accionista_nombre: 'Jose Munoz Diaz' })
      ], temporada.id)

      assert.equal(preview.missing_accionistas.length, 0)
      assert.deepEqual(preview.new_pagos.map(r => r.numero_ingreso), [610])
    })

    it('imports a payment whose name only differs by accent', async () => {
      await seedAccionista('JOSÉ MUÑOZ DÍAZ')

      const result = await invoke<ImportResult>('import:pagos', [
        filaPago({ numero_ingreso: 611, accionista_nombre: 'JOSE MUNOZ DIAZ' })
      ], temporada.id)

      assert.deepEqual(result, { imported: 1, skipped: 0, errors: [] })
    })

    it('leaves out rows carrying cuota extraordinaria u otros ingresos', async () => {
      const preview = await invoke<PagosPreview>('import:preview-pagos', [
        filaPago({ numero_ingreso: 620, monto_acciones: 20_000, multas: 0, otros: 500, total: 20_500 }),
        filaPago({ numero_ingreso: 621, total: 20_000 }),
        filaPago({ numero_ingreso: 622, accionista_nombre: 'Nadie', total: 5_000 })
      ], temporada.id)

      assert.deepEqual(preview.con_otros_ingresos.map(r => r.otros), [500])
      // Excluded whole — not counted as importable, and not offered as a match.
      assert.deepEqual(preview.new_pagos.map(r => r.numero_ingreso), [621])
      assert.equal(preview.total_archivo, 45_500)
      assert.equal(preview.total_importable, 20_000)
    })

    it('refuses to import those rows and says why', async () => {
      const result = await invoke<ImportResult>('import:pagos', [
        filaPago({ numero_ingreso: 623, otros: 265, total: 20_265 }),
        filaPago({ numero_ingreso: 624, total: 20_000 })
      ], temporada.id)

      assert.equal(result.imported, 1)
      assert.equal(result.skipped, 1)
      assert.match(result.errors[0], /cuota extraordinaria u otros ingresos/)

      const pagos = await invoke<Pago[]>('pagos:list-by-temporada', temporada.id)
      assert.deepEqual(pagos.map(p => p.numero_ingreso), [624])
    })

    it('prefers N° Socio over the name, even when the name says someone else', async () => {
      const juan = await seedAccionista('Juan Pérez', undefined, { numero_socio: '7' })
      await seedAccionista('Otra Persona', undefined, { numero_socio: '9' })

      const preview = await invoke<PagosPreview>('import:preview-pagos', [
        filaPago({ numero_ingreso: 630, numero_socio: '7', accionista_nombre: 'Otra Persona' })
      ], temporada.id)

      assert.deepEqual(preview.new_pagos.map(r => r.matched_by), ['numero_socio'])

      await invoke<ImportResult>('import:pagos', [
        filaPago({ numero_ingreso: 630, numero_socio: '7', accionista_nombre: 'Otra Persona' })
      ], temporada.id)

      const pagos = await invoke<Pago[]>('pagos:list-by-temporada', temporada.id)
      assert.equal(pagos[0].accionista_id, juan.id)
    })

    it('falls back to the name when the sheet has no N° Socio column', async () => {
      const preview = await invoke<PagosPreview>('import:preview-pagos', [
        filaPago({ numero_ingreso: 631, numero_socio: null })
      ], temporada.id)

      assert.deepEqual(preview.new_pagos.map(r => r.matched_by), ['nombre'])
    })

    it('groups unmatched names and suggests who they might be', async () => {
      await seedAccionista('MARIA PATRICIA FIGUEROA CUBILLOS')

      const preview = await invoke<PagosPreview>('import:preview-pagos', [
        filaPago({ numero_ingreso: 640, accionista_nombre: 'María Patricia Figueroa C.', total: 1_000 }),
        filaPago({ numero_ingreso: 641, accionista_nombre: 'María Patricia Figueroa C.', total: 2_000 })
      ], temporada.id)

      // Both payments belong to one decision about one person.
      assert.equal(preview.sin_coincidencia.length, 1)
      const grupo = preview.sin_coincidencia[0]
      assert.equal(grupo.nombre, 'María Patricia Figueroa C.')
      assert.equal(grupo.pagos.length, 2)
      assert.equal(grupo.total, 3_000)
      assert.equal(grupo.sugerencias[0].nombre, 'MARIA PATRICIA FIGUEROA CUBILLOS')
    })

    it('imports a name the user matched by hand, and only that one', async () => {
      const maria = await seedAccionista('MARIA PATRICIA FIGUEROA CUBILLOS')

      const rows = [
        filaPago({ numero_ingreso: 650, accionista_nombre: 'María Patricia Figueroa C.' }),
        filaPago({ numero_ingreso: 651, accionista_nombre: 'Nadie De Nadie' })
      ]
      const result = await invoke<ImportResult>('import:pagos', rows, temporada.id, {
        'María Patricia Figueroa C.': maria.id
      })

      assert.equal(result.imported, 1)
      assert.equal(result.errors.length, 1)
      assert.match(result.errors[0], /Nadie De Nadie/)

      const pagos = await invoke<Pago[]>('pagos:list-by-temporada', temporada.id)
      assert.deepEqual(pagos.map(p => p.numero_ingreso), [650])
      assert.equal(pagos[0].accionista_id, maria.id)
    })

    it('never lets a manual assignment override a real match', async () => {
      const juan = await seedAccionista('Juan Pérez', undefined, { numero_socio: '7' })
      const otro = await seedAccionista('Otra Persona')

      await invoke<ImportResult>('import:pagos', [
        filaPago({ numero_ingreso: 660, numero_socio: '7', accionista_nombre: 'Juan Pérez' })
      ], temporada.id, { 'Juan Pérez': otro.id })

      const pagos = await invoke<Pago[]>('pagos:list-by-temporada', temporada.id)
      assert.equal(pagos[0].accionista_id, juan.id)
    })

    it('skips duplicates and reports unknown accionistas as errors', async () => {
      await invoke<ImportResult>('import:pagos', [filaPago()], temporada.id)

      const result = await invoke<ImportResult>('import:pagos', [
        filaPago(),                                                     // duplicate numero_ingreso
        filaPago({ numero_ingreso: 0 }),                                // no numero_ingreso
        filaPago({ numero_ingreso: 502, accionista_nombre: 'Nadie' })   // unknown accionista
      ], temporada.id)

      assert.equal(result.imported, 0)
      assert.equal(result.skipped, 2)
      assert.equal(result.errors.length, 1)
      assert.match(result.errors[0], /Nadie/)

      const pagos = await invoke<Pago[]>('pagos:list-by-temporada', temporada.id)
      assert.equal(pagos.length, 1)
    })
  })
})
