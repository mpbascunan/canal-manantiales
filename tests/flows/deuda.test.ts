import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { calcularDeudaPorTemporada } from '../../src/shared/deuda'
import type { AbonoAplicable, DeudaInicialLinea, TemporadaDeuda } from '../../src/shared/deuda'

/**
 * Exercises the D6 multa and the D3 abono allocation directly, with no database.
 * These are the numbers the administration reconciles against paper, so the
 * cases are written as scenarios rather than as unit assertions.
 */

const HOY = '2027-06-01'

/** 12 unidades — 10 acciones + 2 hectáreas, priced alike (D1). */
const UNIDADES = 12

function temporada(overrides: Partial<TemporadaDeuda> & { id: number }): TemporadaDeuda {
  return {
    nombre: `Temporada ${overrides.id}`,
    fecha_inicio: '2025-03-01',
    valor_accion: 40_000,
    fecha_multa: null,
    monto_multa_por_accion: 5_000,
    pagada: false,
    ...overrides
  }
}

const T2025 = temporada({
  id: 1, nombre: '2025-2026', fecha_inicio: '2025-03-01', fecha_multa: '2025-11-30'
})
const T2026 = temporada({
  id: 2, nombre: '2026-2027', fecha_inicio: '2026-03-01', fecha_multa: '2026-11-30'
})

describe('deuda por temporada', () => {
  describe('multa por atraso', () => {
    it('prices each temporada with its own multa, and sums them', () => {
      // The scenario from the design session: two seasons owed, one small abono
      // that covers neither, paid before the first deadline.
      const abonos: AbonoAplicable[] = [{ fecha: '2025-10-01', total: 100_000 }]
      const d = calcularDeudaPorTemporada([T2025, T2026], abonos, UNIDADES, HOY)

      const [primera, segunda] = d.temporadas
      assert.equal(primera.cuota, 480_000)
      assert.equal(primera.abonado, 100_000)
      // 380.000 of 480.000 outstanding at the deadline → 0,7916… × 12 × 5.000
      assert.equal(primera.multa, 47_500)

      assert.equal(segunda.abonado, 0)
      assert.equal(segunda.multa, 60_000) // wholly unpaid → 12 × 5.000
      assert.equal(d.total_multas, 107_500)
    })

    it('reads each temporada\'s own monto_multa_por_accion, not the active one', () => {
      const barata = temporada({
        id: 1, fecha_inicio: '2025-03-01', fecha_multa: '2025-11-30',
        monto_multa_por_accion: 2_000
      })
      const cara = temporada({
        id: 2, fecha_inicio: '2026-03-01', fecha_multa: '2026-11-30',
        monto_multa_por_accion: 9_000
      })
      const d = calcularDeudaPorTemporada([barata, cara], [], UNIDADES, HOY)

      assert.equal(d.temporadas[0].multa, 24_000)  // 12 × 2.000
      assert.equal(d.temporadas[1].multa, 108_000) // 12 × 9.000
    })

    it('charges nothing while the deadline is still ahead', () => {
      const futura = temporada({ id: 3, fecha_inicio: '2027-03-01', fecha_multa: '2027-11-30' })
      const d = calcularDeudaPorTemporada([futura], [], UNIDADES, HOY)

      assert.equal(d.temporadas[0].multa, 0)
      assert.equal(d.temporadas[0].pendiente, 480_000)
    })

    it('never charges a multa when the temporada has no deadline set', () => {
      const sinPlazo = temporada({ id: 4, fecha_multa: null })
      const d = calcularDeudaPorTemporada([sinPlazo], [], UNIDADES, HOY)

      assert.equal(d.temporadas[0].multa, 0)
    })

    it('excludes a temporada that has a pago, cuota and multa alike', () => {
      const saldada = { ...T2025, pagada: true }
      const d = calcularDeudaPorTemporada([saldada, T2026], [], UNIDADES, HOY)

      assert.equal(d.temporadas.length, 1)
      assert.equal(d.temporadas[0].temporada_id, T2026.id)
    })
  })

  describe('the multa is frozen at the deadline', () => {
    it('does not shrink when the cuota is paid after the deadline', () => {
      // Same abono, moved to *after* the deadline. It still settles the cuota,
      // but the fine was already fixed at 100% on 30-nov.
      const tarde: AbonoAplicable[] = [{ fecha: '2026-03-15', total: 480_000 }]
      const d = calcularDeudaPorTemporada([T2025], tarde, UNIDADES, HOY)

      assert.equal(d.temporadas[0].pendiente_cuota, 0)
      assert.equal(d.temporadas[0].multa, 60_000)
      assert.equal(d.temporadas[0].pendiente, 60_000)
    })

    it('paying the full value of both cuotas still leaves the multas owing', () => {
      // The failure mode that killed the live-balance model: under it, paying
      // the cuota in full drove the fine to zero and it was never collected.
      const abonos: AbonoAplicable[] = [
        { fecha: '2025-10-01', total: 100_000 },
        { fecha: '2027-05-01', total: 860_000 }
      ]
      const d = calcularDeudaPorTemporada([T2025, T2026], abonos, UNIDADES, HOY)

      assert.equal(d.total_cuotas, 960_000)
      assert.equal(d.total_abonado, 960_000)
      // 47.500 for the first temporada (100.000 of 480.000 was in by its
      // deadline) and the full 60.000 for the second.
      assert.equal(d.total_multas, 107_500)
      assert.equal(d.total_pendiente, 107_500)
    })

    it('gives credit for what was abonado by the deadline, pro rata', () => {
      const mitad: AbonoAplicable[] = [{ fecha: '2025-11-30', total: 240_000 }]
      const d = calcularDeudaPorTemporada([T2025], mitad, UNIDADES, HOY)

      // Half the cuota covered on the deadline itself → half the fine.
      assert.equal(d.temporadas[0].multa, 30_000)
    })
  })

  describe('abono allocation', () => {
    it('fills the oldest temporada before touching the newer one', () => {
      const abonos: AbonoAplicable[] = [{ fecha: '2026-06-01', total: 600_000 }]
      const d = calcularDeudaPorTemporada([T2025, T2026], abonos, UNIDADES, HOY)

      assert.equal(d.temporadas[0].abonado, 480_000)      // cuota filled
      assert.equal(d.temporadas[0].multa_abonada, 60_000) // then its multa
      assert.equal(d.temporadas[1].abonado, 60_000)       // only what is left
    })

    it('settles a temporada completely — cuota then multa — before the next one', () => {
      // Paid entirely after both deadlines, so both fines are fixed at 100%.
      // The first temporada takes 480.000 + 60.000 before the second sees a peso.
      const abonos: AbonoAplicable[] = [{ fecha: '2027-05-01', total: 1_000_000 }]
      const d = calcularDeudaPorTemporada([T2025, T2026], abonos, UNIDADES, HOY)

      assert.equal(d.total_multas, 120_000)
      assert.equal(d.temporadas[0].pendiente, 0)
      assert.equal(d.temporadas[1].pendiente_cuota, 20_000)
      assert.equal(d.temporadas[1].pendiente_multa, 60_000)
      assert.equal(d.total_pendiente, 80_000)
    })

    it('reports money left over once everything is covered', () => {
      const abonos: AbonoAplicable[] = [{ fecha: '2027-05-01', total: 1_100_000 }]
      const d = calcularDeudaPorTemporada([T2025, T2026], abonos, UNIDADES, HOY)

      assert.equal(d.total_pendiente, 0)
      assert.equal(d.excedente, 1_100_000 - 960_000 - 120_000)
    })

    it('applies abonos in date order, so the deadline credit is not backdated', () => {
      // The later abono must not be the one credited against the November
      // deadline just because it appears first in the array.
      const abonos: AbonoAplicable[] = [
        { fecha: '2026-06-01', total: 480_000 },
        { fecha: '2025-10-01', total: 240_000 }
      ]
      const d = calcularDeudaPorTemporada([T2025], abonos, UNIDADES, HOY)

      // Only the October 240.000 counts toward the fine → half of 60.000.
      assert.equal(d.temporadas[0].multa, 30_000)
      assert.equal(d.temporadas[0].pendiente_cuota, 0)
    })
  })

  describe('rounding', () => {
    it('rounds each cuota and each multa to whole pesos', () => {
      const rara = temporada({
        id: 9, valor_accion: 10_333.33, fecha_multa: '2025-11-30',
        monto_multa_por_accion: 1_111.11
      })
      const d = calcularDeudaPorTemporada([rara], [], 3.5, HOY)

      assert.equal(d.temporadas[0].cuota, Math.round(10_333.33 * 3.5))
      assert.equal(d.temporadas[0].multa, Math.round(1_111.11 * 3.5))
      assert.ok(Number.isInteger(d.total_pendiente))
    })

    it('sums the displayed rows to the displayed total', () => {
      // context.md G5: the complaint is that a column of rows does not add up
      // to the total shown beneath it.
      const d = calcularDeudaPorTemporada([T2025, T2026], [], 7.77, HOY)
      const suma = d.temporadas.reduce((acc, t) => acc + t.pendiente, 0)

      assert.equal(suma, d.total_pendiente)
    })
  })

  describe('deuda inicial', () => {
    const MULTAS_VIEJAS: DeudaInicialLinea[] = [
      { id: 1, concepto: 'Multa temporada 2023-2024', tipo: 'MULTA', monto: 180_000 },
      { id: 2, concepto: 'Multa temporada 2024-2025', tipo: 'MULTA', monto: 240_000 }
    ]

    it('adds the transcribed figures to the debt without recalculating them', () => {
      const d = calcularDeudaPorTemporada([T2025], [], UNIDADES, HOY, MULTAS_VIEJAS)

      assert.equal(d.total_deuda_inicial, 420_000)
      assert.deepEqual(d.deuda_inicial.map(l => l.monto), [180_000, 240_000])
      // 480.000 cuota + 60.000 multa + 420.000 carried in.
      assert.equal(d.total_pendiente, 960_000)
    })

    it('is consumed by abonos before any temporada', () => {
      const abonos: AbonoAplicable[] = [{ fecha: '2025-04-01', total: 500_000 }]
      const d = calcularDeudaPorTemporada([T2025], abonos, UNIDADES, HOY, MULTAS_VIEJAS)

      assert.equal(d.deuda_inicial[0].pendiente, 0)
      assert.equal(d.deuda_inicial[1].pendiente, 0)
      assert.equal(d.temporadas[0].abonado, 80_000) // only the remainder
    })

    it('pays CUOTA lines before MULTA lines', () => {
      const mixta: DeudaInicialLinea[] = [
        { id: 1, concepto: 'Multa 2024-2025', tipo: 'MULTA', monto: 100_000 },
        { id: 2, concepto: 'Cuota impaga 2024-2025', tipo: 'CUOTA', monto: 300_000 }
      ]
      const abonos: AbonoAplicable[] = [{ fecha: '2025-04-01', total: 300_000 }]
      const d = calcularDeudaPorTemporada([], abonos, UNIDADES, HOY, mixta)

      const cuota = d.deuda_inicial.find(l => l.tipo === 'CUOTA')!
      const multa = d.deuda_inicial.find(l => l.tipo === 'MULTA')!
      assert.equal(cuota.pendiente, 0)
      assert.equal(multa.pendiente, 100_000)
    })

    it('does not let a carried-in multa reduce a temporada multa', () => {
      // The carried figure is a fact, and the D6 fine is computed from the
      // cuota alone — neither should touch the other.
      const abonos: AbonoAplicable[] = [{ fecha: '2025-10-01', total: 420_000 }]
      const d = calcularDeudaPorTemporada([T2025], abonos, UNIDADES, HOY, MULTAS_VIEJAS)

      // The whole abono went to the carried debt, so nothing reached the cuota:
      // the temporada's fine is still the full 60.000.
      assert.equal(d.temporadas[0].abonado, 0)
      assert.equal(d.temporadas[0].multa, 60_000)
      assert.equal(d.total_multas, 60_000) // carried MULTA lines are not counted here
    })

    it('changes nothing when there is no carried debt', () => {
      const sin = calcularDeudaPorTemporada([T2025, T2026], [], UNIDADES, HOY)
      const con = calcularDeudaPorTemporada([T2025, T2026], [], UNIDADES, HOY, [])

      assert.deepEqual(con, sin)
      assert.equal(con.total_deuda_inicial, 0)
    })
  })

  describe('edge cases', () => {
    it('owes nothing when there are no unpaid temporadas', () => {
      const d = calcularDeudaPorTemporada([], [], UNIDADES, HOY)

      assert.deepEqual(d.temporadas, [])
      assert.equal(d.total_pendiente, 0)
    })

    it('charges no multa to a shareholder with no unidades', () => {
      const d = calcularDeudaPorTemporada([T2025], [], 0, HOY)

      assert.equal(d.temporadas[0].cuota, 0)
      assert.equal(d.temporadas[0].multa, 0)
    })
  })
})
