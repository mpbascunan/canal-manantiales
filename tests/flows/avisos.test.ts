/**
 * The aviso de cobranza, end to end: real rows in SQLite → `deudores:get-deuda`
 * → the lines the PDF charges → the PDF itself.
 *
 * This is the one document a shareholder receives on paper and pays against, so
 * the tests hold it to two promises:
 *
 * 1. It demands the **whole outstanding balance** — every temporada still owed
 *    and the pre-app debt, net of abonos (D13, D14) — not just the active
 *    season's cuota.
 * 2. Its charged lines add up to exactly `total_pendiente`. Anything shown but
 *    not charged (headings, the per-property split, settled cargos) is marked as
 *    such, so no informational figure can quietly inflate the demand.
 */
import { before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { invoke, registerAllHandlers, resetDb, seedAccionista, seedTemporada } from '../helpers/harness'
import { pdfTexto } from '../helpers/pdf'
import {
  buildAvisosCobroDoc, construirLineasAviso,
  type AvisoDestinatario, type AvisoLinea
} from '../../src/renderer/src/lib/export'
import { formatCLP } from '../../src/renderer/src/lib/formulas'
import type { Accionista, Propiedad, Temporada } from '../../src/shared/types'
import type { DeudaPorTemporada } from '../../src/shared/deuda'

describe('avisos de cobro', () => {
  before(registerAllHandlers)
  beforeEach(resetDb)

  /** Both deadlines are long past, so an unpaid season carries its full multa. */
  const HOY = '2027-06-01'

  let t2025: Temporada
  let t2026: Temporada
  let juan: Accionista   // 10 acciones + 2 hectáreas = 12 unidades

  beforeEach(async () => {
    t2025 = await seedTemporada({
      nombre: 'Temporada 2025-2026', fecha_inicio: '2025-03-01', fecha_fin: '2026-02-28',
      valor_accion: 40_000, fecha_multa: '2025-11-30', monto_multa_por_accion: 5_000,
      activa: false
    })
    t2026 = await seedTemporada({
      nombre: 'Temporada 2026-2027', fecha_inicio: '2026-03-01', fecha_fin: '2027-02-28',
      valor_accion: 40_000, fecha_multa: '2026-11-30', monto_multa_por_accion: 5_000,
      nota_aviso: 'Pagar en la oficina del canal.'
    })
    juan = await seedAccionista('Juan', [
      { nombre: 'Parcela N°84', tipo: 'PARCELA', acciones: 10, hectareas: 2 }
    ], { apellido_paterno: 'Pérez' })
  })

  // ── Fixtures ───────────────────────────────────────────────────────────────

  const abonar = (fecha: string, total: number, temporadaId = t2026.id) =>
    invoke('abonos:create', {
      numero_ingreso: 0, accionista_id: juan.id, temporada_id: temporadaId,
      fecha, monto: total, multas: 0, total, notas: null
    })

  let ingreso = 100
  const pagar = (temporadaId: number, accionistaId = juan.id) =>
    invoke('pagos:create', {
      numero_ingreso: ingreso++, accionista_id: accionistaId, temporada_id: temporadaId,
      fecha: '2026-01-15', temporadas_pagadas: 1, monto_acciones: 480_000,
      multas: 0, total: 480_000, notas: null
    })

  const crearCargo = (temporadaId: number, over: Record<string, unknown> = {}) =>
    invoke<{ id: number }>('cargos:create', {
      nombre: 'Limpia de acequia', temporada_id: temporadaId, tarifa: 1_000,
      tipo_tarifa: 'proporcional', fecha: '2026-07-01', notas: null,
      accionista_ids: [juan.id], ...over
    })

  const crearDeudaInicial = (over: Record<string, unknown> = {}) =>
    invoke('deuda-inicial:create', {
      accionista_id: juan.id, concepto: 'Temporada 2024-2025', tipo: 'MULTA',
      monto: 200_000, notas: null, ...over
    })

  // ── Reading the aviso ──────────────────────────────────────────────────────

  /** The aviso's input, assembled exactly as AccionistaDetalle assembles it. */
  const destinatarioDe = async (a: Accionista, conPropiedades = false): Promise<AvisoDestinatario> => ({
    accionista: a,
    deuda: await invoke<DeudaPorTemporada>('deudores:get-deuda', a.id, HOY),
    propiedades: conPropiedades ? await invoke<Propiedad[]>('propiedades:list', a.id) : []
  })

  const lineasDe = async (a: Accionista = juan, conPropiedades = false): Promise<AvisoLinea[]> =>
    construirLineasAviso(await destinatarioDe(a, conPropiedades))

  /** What the shareholder is actually asked to pay. */
  const cobrado = (lineas: AvisoLinea[]): number =>
    lineas.filter(l => l.cobrable).reduce((s, l) => s + l.monto, 0)

  const tipos = (lineas: AvisoLinea[]): string[] => lineas.map(l => l.tipo)
  const conceptos = (lineas: AvisoLinea[]): string[] => lineas.map(l => l.concepto)

  /**
   * One season's block, heading included — everything from the nth `grupo` line
   * up to the next one. Lets a test read a single season without depending on
   * how many lines the seasons before it produced.
   */
  const bloqueDeTemporada = (lineas: AvisoLinea[], indice: number): AvisoLinea[] => {
    const inicios = lineas.flatMap((l, i) => (l.tipo === 'grupo' ? [i] : []))
    const desde = inicios[indice]
    const hasta = inicios[indice + 1] ?? lineas.length
    return lineas.slice(desde, hasta)
  }

  // ── What the aviso charges ─────────────────────────────────────────────────

  describe('what it charges', () => {
    it('charges every temporada still owed, oldest first', async () => {
      const lineas = await lineasDe()

      assert.deepEqual(
        lineas.filter(l => l.tipo === 'grupo').map(l => l.concepto),
        ['Temporada 2025-2026', 'Temporada 2026-2027']
      )
      assert.deepEqual(tipos(lineas), [
        'grupo', 'cuota', 'multa',
        'grupo', 'cuota', 'multa'
      ])
      assert.equal(cobrado(lineas), 1_080_000)   // 2 × (480.000 cuota + 60.000 multa)
    })

    it('charges the cuota net of what has been abonado', async () => {
      await abonar('2025-10-01', 100_000)

      const lineas = await lineasDe()
      const [cuota] = lineas.filter(l => l.tipo === 'cuota')

      assert.equal(cuota.monto, 380_000)
      assert.match(cuota.concepto, /abonado/)
      assert.ok(cuota.concepto.includes(formatCLP(100_000)))
    })

    it('says nothing about abonos on a line no abono touched', async () => {
      const [cuota] = (await lineasDe()).filter(l => l.tipo === 'cuota')

      assert.equal(cuota.concepto, 'Cuota por acciones')
    })

    it('charges the multa the deadline froze, after the cuota', async () => {
      await abonar('2025-10-01', 100_000)

      const lineas = await lineasDe()
      const multa = lineas.find(l => l.tipo === 'multa')!

      // 380.000 of 480.000 still owing at the deadline × 12 unidades × 5.000
      assert.equal(multa.monto, 47_500)
      assert.ok(tipos(lineas).indexOf('multa') > tipos(lineas).indexOf('cuota'))
    })

    it('drops a temporada that has been paid in full', async () => {
      await pagar(t2025.id)

      const lineas = await lineasDe()

      assert.deepEqual(conceptos(lineas.filter(l => l.tipo === 'grupo')), [])
      assert.equal(cobrado(lineas), 540_000)   // only 2026-2027
    })

    it('omits the season headings when a single season is on the sheet', async () => {
      await pagar(t2025.id)

      assert.deepEqual(tipos(await lineasDe()), ['cuota', 'multa'])
    })

    it('charges an unpaid cargo, resolved at tarifa × unidades', async () => {
      await crearCargo(t2026.id)

      const cargo = (await lineasDe()).find(l => l.tipo === 'cargo')!

      assert.equal(cargo.concepto, 'Limpia de acequia')
      assert.equal(cargo.monto, 12_000)        // 1.000 × 12 unidades
      assert.equal(cargo.cobrable, true)
    })

    it('shows a settled cargo for the record without charging it', async () => {
      const cargo = await crearCargo(t2026.id)
      await invoke('cargos:set-pagado', cargo.id, juan.id, true)

      const lineas = await lineasDe()
      const pagado = lineas.find(l => l.tipo === 'cargo_pagado')!

      assert.match(pagado.concepto, /Limpia de acequia\s+\(Pagado\)/)
      assert.equal(pagado.monto, 12_000)
      assert.equal(pagado.cobrable, false)
      assert.equal(cobrado(lineas), 1_080_000)   // unchanged by the settled cargo
    })

    it('charges only the cargo when a late one re-opens a settled temporada', async () => {
      await pagar(t2025.id)
      await crearCargo(t2025.id)

      const lineas = await lineasDe()

      assert.deepEqual(tipos(bloqueDeTemporada(lineas, 0)), ['grupo', 'cargo'])
      assert.equal(cobrado(lineas), 552_000)   // 540.000 + the 12.000 cargo
    })

    it('lists pre-app debt above every temporada', async () => {
      await crearDeudaInicial()

      const lineas = await lineasDe()

      assert.deepEqual(tipos(lineas).slice(0, 2), ['grupo', 'inicial'])
      assert.equal(lineas[0].concepto, 'Temporadas anteriores')
      assert.equal(lineas[1].concepto, 'Multa · Temporada 2024-2025')
      assert.equal(lineas[1].monto, 200_000)
      assert.equal(cobrado(lineas), 1_280_000)
    })

    it('drops a pre-app line the abonos already covered', async () => {
      await crearDeudaInicial({ monto: 50_000 })
      await abonar('2025-04-01', 50_000)

      const lineas = await lineasDe()

      assert.deepEqual(tipos(lineas).filter(t => t === 'inicial'), [])
      assert.equal(cobrado(lineas), 1_080_000)
    })

    it('charges nothing, and says so, when the account is settled', async () => {
      await pagar(t2025.id)
      await pagar(t2026.id)

      const lineas = await lineasDe()

      assert.deepEqual(tipos(lineas), ['sin_deuda'])
      assert.equal(lineas[0].concepto, 'Sin deuda pendiente')
      assert.equal(cobrado(lineas), 0)
    })

    it('names a season without repeating the word the administration typed', async () => {
      // The client writes both "Temporada 2025-2026" and "2027-2028".
      const t2027 = await seedTemporada({
        nombre: '2027-2028', fecha_inicio: '2027-03-01', fecha_fin: '2028-02-28',
        valor_accion: 1_000, activa: false
      })

      const lineas = await lineasDe()
      const titulo = pdfTexto(buildAvisosCobroDoc([await destinatarioDe(juan)], t2027))

      assert.deepEqual(conceptos(lineas.filter(l => l.tipo === 'grupo')), [
        'Temporada 2025-2026', 'Temporada 2026-2027', 'Temporada 2027-2028'
      ])
      assert.match(titulo, /AVISO DE COBRANZA — TEMPORADA 2027-2028/)
    })

    it('charges nothing to a shareholder with no propiedades', async () => {
      const pedro = await seedAccionista('Pedro', [])

      assert.equal(cobrado(await lineasDe(pedro)), 0)
    })
  })

  // ── The per-property breakdown ─────────────────────────────────────────────

  describe('the per-property breakdown', () => {
    let ana: Accionista   // 8 + 4 acciones across two properties

    beforeEach(async () => {
      ana = await seedAccionista('Ana', [
        { nombre: 'Parcela N°8', tipo: 'PARCELA', acciones: 8, hectareas: 0 },
        { nombre: 'Sitio N°4', tipo: 'SITIO', acciones: 4, hectareas: 0 }
      ])
    })

    it('splits the cuota across the properties, charging only the subtotal', async () => {
      const lineas = bloqueDeTemporada(await lineasDe(ana, true), 0)

      const split = lineas.filter(l => l.tipo === 'propiedad')
      const subtotal = lineas.find(l => l.tipo === 'subtotal')!

      assert.deepEqual(split.map(l => l.monto), [320_000, 160_000])
      assert.equal(split.every(l => !l.cobrable), true)
      assert.equal(subtotal.monto, 480_000)
      assert.equal(subtotal.cobrable, true)
      assert.equal(split.reduce((s, l) => s + l.monto, 0), subtotal.monto)
    })

    it('names each property and what it contributes', async () => {
      const [primera] = (await lineasDe(ana, true)).filter(l => l.tipo === 'propiedad')

      assert.match(primera.concepto, /Parcela N°8/)
      assert.match(primera.concepto, /8 acc/)
    })

    it('stops splitting once part of the cuota has been abonado', async () => {
      await invoke('abonos:create', {
        numero_ingreso: 0, accionista_id: ana.id, temporada_id: t2025.id,
        fecha: '2025-10-01', monto: 100_000, multas: 0, total: 100_000, notas: null
      })

      const lineas = await lineasDe(ana, true)
      const primeraTemporada = lineas.filter(l => l.tipo === 'propiedad' || l.tipo === 'cuota')

      assert.equal(primeraTemporada[0].tipo, 'cuota')
      assert.equal(primeraTemporada[0].monto, 380_000)
    })

    it('falls back to a single cuota line when the caller passes no propiedades', async () => {
      const lineas = await lineasDe(ana, false)

      assert.deepEqual(tipos(lineas).filter(t => t === 'propiedad'), [])
      assert.equal(lineas.find(l => l.tipo === 'cuota')!.monto, 480_000)
    })
  })

  // ── The invariant that matters ─────────────────────────────────────────────

  describe('the charged lines always add up to the pending debt', () => {
    const escenarios: [string, () => Promise<unknown>][] = [
      ['nothing paid', async () => {}],
      ['an abono before the deadline', () => abonar('2025-10-01', 100_000)],
      ['an abono after the deadline', () => abonar('2026-01-05', 100_000)],
      ['an abono larger than one season', () => abonar('2025-10-01', 700_000)],
      ['a pending cargo', () => crearCargo(t2026.id)],
      ['a flat-rate cargo', () => crearCargo(t2026.id, { tipo_tarifa: 'fija', tarifa: 7_500 })],
      ['a settled cargo', async () => {
        const c = await crearCargo(t2026.id)
        await invoke('cargos:set-pagado', c.id, juan.id, true)
      }],
      ['pre-app debt', () => crearDeudaInicial()],
      ['pre-app debt partly abonado', async () => {
        await crearDeudaInicial()
        await abonar('2025-04-01', 120_000)
      }],
      ['one season paid', () => pagar(t2025.id)],
      ['a season re-opened by a late cargo', async () => {
        await pagar(t2025.id)
        await crearCargo(t2025.id)
      }],
      ['everything paid', async () => {
        await pagar(t2025.id)
        await pagar(t2026.id)
      }],
      ['more abonado than owed', () => abonar('2025-10-01', 2_000_000)]
    ]

    for (const [nombre, montar] of escenarios) {
      it(`holds with ${nombre}`, async () => {
        await montar()

        const destinatario = await destinatarioDe(juan, true)
        const lineas = construirLineasAviso(destinatario)

        assert.equal(cobrado(lineas), destinatario.deuda.total_pendiente)
      })
    }
  })

  // ── The document itself ────────────────────────────────────────────────────

  describe('the PDF', () => {
    it('gives every shareholder their own page', async () => {
      const ana = await seedAccionista('Ana', [{ nombre: 'Sitio N°4', tipo: 'SITIO', acciones: 3, hectareas: 0 }])
      const destinatarios = [await destinatarioDe(juan), await destinatarioDe(ana)]

      const doc = buildAvisosCobroDoc(destinatarios, t2026)

      assert.equal(doc.getNumberOfPages(), 2)
    })

    it('prints the shareholder, the season and the institution', async () => {
      const texto = pdfTexto(buildAvisosCobroDoc([await destinatarioDe(juan)], t2026))

      assert.match(texto, /COM\. DE AGUA DE RIEGO CANAL RINC\. DE MANANTIALES/)
      assert.match(texto, /AVISO DE COBRANZA — TEMPORADA 2026-2027/)
      assert.match(texto, /Estimado\/a: Juan Pérez/)
    })

    it('prints every charged concept with its amount, and the total', async () => {
      await crearCargo(t2026.id)
      await crearDeudaInicial()
      const destinatario = await destinatarioDe(juan)

      const texto = pdfTexto(buildAvisosCobroDoc([destinatario], t2026))

      for (const linea of construirLineasAviso(destinatario)) {
        assert.ok(texto.includes(linea.concepto), `falta el concepto "${linea.concepto}"`)
        if (linea.cobrable) {
          assert.ok(texto.includes(formatCLP(linea.monto)), `falta el monto de "${linea.concepto}"`)
        }
      }
      assert.match(texto, /TOTAL A PAGAR/)
      assert.ok(texto.includes(formatCLP(destinatario.deuda.total_pendiente)))
    })

    it('prints the deadline and the season note', async () => {
      const texto = pdfTexto(buildAvisosCobroDoc([await destinatarioDe(juan)], t2026))

      assert.match(texto, /Fecha límite de pago:/)
      assert.match(texto, /30\/11\/2026/)
      assert.match(texto, /Pagar en la oficina del canal\./)
    })

    it('credits an excedente instead of leaving the money unexplained', async () => {
      await abonar('2025-10-01', 2_000_000)
      const destinatario = await destinatarioDe(juan)

      const texto = pdfTexto(buildAvisosCobroDoc([destinatario], t2026))

      // The abono beat both deadlines, so neither season carries a multa:
      // 2.000.000 − 960.000 of cuotas.
      assert.equal(destinatario.deuda.excedente, 1_040_000)
      assert.match(texto, /Excedente a favor/)
      assert.ok(texto.includes(formatCLP(1_040_000)))
    })

    it('lists the properties it was given, and the aggregate when it was given none', async () => {
      const conProps = pdfTexto(buildAvisosCobroDoc([await destinatarioDe(juan, true)], t2026))
      const sinProps = pdfTexto(buildAvisosCobroDoc([await destinatarioDe(juan, false)], t2026))

      assert.match(conProps, /Parcela N°84/)
      assert.match(sinProps, /Propiedad: Parcela N°84/)
    })

    it('keeps one shareholder\'s debt off another\'s aviso', async () => {
      const ana = await seedAccionista('Ana', [{ nombre: 'Sitio N°4', tipo: 'SITIO', acciones: 3, hectareas: 0 }])
      await crearCargo(t2026.id)   // Juan's alone

      const destinatario = await destinatarioDe(ana)
      const texto = pdfTexto(buildAvisosCobroDoc([destinatario], t2026))

      assert.doesNotMatch(texto, /Limpia de acequia/)
      assert.doesNotMatch(texto, /Juan/)
      // 3 unidades × 2 seasons: 240.000 of cuotas + 30.000 of multas
      assert.equal(destinatario.deuda.total_pendiente, 270_000)
      assert.ok(texto.includes(formatCLP(270_000)))
    })

    it('prints a settled shareholder a sheet that demands nothing', async () => {
      await pagar(t2025.id)
      await pagar(t2026.id)

      const texto = pdfTexto(buildAvisosCobroDoc([await destinatarioDe(juan)], t2026))

      assert.match(texto, /Sin deuda pendiente/)
      assert.ok(texto.includes(formatCLP(0)))
    })
  })

  // ── The listing the Dashboard prints from ──────────────────────────────────

  describe('the bulk source', () => {
    it('carries the same breakdown the single aviso charges from', async () => {
      const uno = await invoke<DeudaPorTemporada>('deudores:get-deuda', juan.id, HOY)
      const [fila] = await invoke<any[]>('deudores:list-deuda', HOY)

      assert.equal(fila.id, juan.id)
      assert.deepEqual(fila.deuda, uno)
      assert.deepEqual(
        construirLineasAviso({ accionista: fila, deuda: fila.deuda }),
        construirLineasAviso({ accionista: juan, deuda: uno })
      )
    })

    it('leaves settled shareholders out by default — "PDF Deudores"', async () => {
      const ana = await seedAccionista('Ana', [{ nombre: 'Sitio N°4', tipo: 'SITIO', acciones: 3, hectareas: 0 }])
      await pagar(t2025.id, ana.id)
      await pagar(t2026.id, ana.id)

      const filas = await invoke<any[]>('deudores:list-deuda', HOY)

      assert.deepEqual(filas.map(f => f.nombre), ['Juan'])
    })

    it('keeps them when asked — "PDF Todos los accionistas"', async () => {
      const ana = await seedAccionista('Ana', [{ nombre: 'Sitio N°4', tipo: 'SITIO', acciones: 3, hectareas: 0 }])
      await pagar(t2025.id, ana.id)
      await pagar(t2026.id, ana.id)

      const filas = await invoke<any[]>('deudores:list-deuda', HOY, true)

      assert.deepEqual(filas.map(f => f.nombre).sort(), ['Ana', 'Juan'])
      const anaFila = filas.find(f => f.nombre === 'Ana')!
      assert.equal(anaFila.deuda.total_pendiente, 0)
    })

    it('gives the bulk print one page per shareholder', async () => {
      await seedAccionista('Ana', [{ nombre: 'Sitio N°4', tipo: 'SITIO', acciones: 3, hectareas: 0 }])
      await seedAccionista('Rosa', [{ nombre: 'Parcela N°2', tipo: 'PARCELA', acciones: 5, hectareas: 1 }])

      const filas = await invoke<any[]>('deudores:list-deuda', HOY, true)
      const doc = buildAvisosCobroDoc(
        filas.map(({ deuda, ...accionista }) => ({ accionista: accionista as Accionista, deuda })),
        t2026
      )

      assert.equal(filas.length, 3)
      assert.equal(doc.getNumberOfPages(), 3)
    })
  })
})
