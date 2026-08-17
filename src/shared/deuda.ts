/**
 * The debt calculation, as decided in context.md D3, D6, D8, D13 and D14.
 *
 * Pure and dependency-free so the main process and the renderer run the *same*
 * code. The cargo amount used to be written twice, once in TypeScript and once
 * as a SQL `CASE`, and the copies could drift (context.md G6); `calcularMontoCargo`
 * below is now the only one, and the multa never had a second copy to begin with.
 *
 * The rules that drive everything here:
 *
 * - **Abonos are allocated oldest debt first** (D3). The order is: everything
 *   carried in from before the app (D14), then each temporada oldest first, and
 *   within a temporada its cuota, then its cargos, then its multa.
 * - **A multa is frozen at that temporada's `fecha_multa`** (D6): it is
 *   proportional to the share of the cuota still unpaid *at the deadline*, and
 *   abonos paid afterwards do not shrink it. Measuring against the live balance
 *   instead would drive the fine to zero the moment the cuota is settled, so
 *   nobody would ever pay one.
 * - **A cargo re-opens a settled temporada** (D11), so a temporada with a pago
 *   still appears here while any of its cargos is unpaid.
 */

/** A temporada a shareholder may owe, carrying its own historical rates (D13). */
export interface TemporadaDeuda {
  id: number
  nombre: string
  /** Used only to order seasons oldest-first. */
  fecha_inicio: string
  valor_accion: number
  /** `null` means this temporada never generates a multa (D6 rule 4). */
  fecha_multa: string | null
  monto_multa_por_accion: number
  /** True when a `pago` exists: the cuota and multa are settled outright (D2). */
  pagada: boolean
}

/**
 * A cargo issued to this accionista. `monto` is already resolved from the
 * cargo's `tipo_tarifa` — flat, or tarifa × unidades — by whoever loaded it.
 */
export interface CargoDeuda {
  id: number
  temporada_id: number
  nombre: string
  monto: number
  /** Settled outside the abono flow: by a pago, or ticked by hand. */
  pagado: boolean
}

export interface AbonoAplicable {
  fecha: string
  total: number
}

/**
 * A line of debt carried in from before the app existed, transcribed from the
 * administration's records (D14). It is never recalculated — the figure is the
 * fact — but it is the oldest debt there is, so abonos consume it first.
 */
import type { TipoDeudaInicial } from './types'

/** Charging order inside the pre-app debt: cuota, then otros, then multa. */
export const ORDEN_TIPO_DEUDA: Record<TipoDeudaInicial, number> = {
  CUOTA: 0, OTRO: 1, MULTA: 2
}

export interface DeudaInicialLinea {
  id: number
  concepto: string
  tipo: TipoDeudaInicial
  monto: number
}

export interface DeudaInicialBreakdown {
  id: number
  concepto: string
  tipo: TipoDeudaInicial
  monto: number
  abonado: number
  pendiente: number
}

export interface CargoBreakdown {
  cargo_id: number
  nombre: string
  monto: number
  abonado: number
  /** Zero when `pagado`, regardless of what the abonos covered. */
  pendiente: number
  pagado: boolean
}

export interface TemporadaBreakdown {
  temporada_id: number
  nombre: string
  /** True when a pago settles it; cuota and multa are then both zero. */
  pagada: boolean
  cuota: number
  abonado: number
  pendiente_cuota: number
  cargos: CargoBreakdown[]
  total_cargos: number
  pendiente_cargos: number
  /** Frozen at `fecha_multa`; 0 when the deadline is unset, ahead, or paid. */
  multa: number
  multa_abonada: number
  pendiente_multa: number
  /** `pendiente_cuota + pendiente_cargos + pendiente_multa`. */
  pendiente: number
}

export interface DeudaPorTemporada {
  /** Pre-app debt, consumed by abonos before any temporada. */
  deuda_inicial: DeudaInicialBreakdown[]
  temporadas: TemporadaBreakdown[]
  total_deuda_inicial: number
  total_cuotas: number
  total_cargos: number
  /** Multas por atraso computed by D6 — excludes any MULTA line in `deuda_inicial`. */
  total_multas: number
  total_abonado: number
  /** Abono money left over once every debt is covered. */
  excedente: number
  total_pendiente: number
}

/** CLP has no minor unit, so every money value is a whole peso (D8). */
export function roundPesos(value: number): number {
  return Math.round(value)
}

/** How a cargo prices one shareholder: a flat tarifa, or tarifa × unidades. */
export type TipoTarifa = 'proporcional' | 'fija'

/**
 * What one accionista owes for a cargo, in whole pesos (D8).
 *
 * The only copy of the rule. It used to be written once in TypeScript, when a
 * cargo was created, and again as a SQL `CASE` in three separate queries, so
 * editing one left the others quietly disagreeing (context.md G6). `unidades`
 * is `acciones + hectareas`, and is ignored by a `fija` tarifa.
 */
export function calcularMontoCargo(
  tipoTarifa: TipoTarifa | string,
  tarifa: number,
  unidades: number
): number {
  return roundPesos(tipoTarifa === 'fija' ? tarifa : tarifa * unidades)
}

/** ISO `YYYY-MM-DD` strings compare correctly as strings. */
function isPast(date: string, today: string): boolean {
  return date < today
}

/**
 * Splits a shareholder's abonos across everything they owe, and prices the multa
 * for each temporada.
 *
 * `unidades` is `acciones + hectareas` — an hectárea is priced exactly as an
 * acción (D1). `today` is an ISO date, passed in rather than read from the clock
 * so the result is reproducible.
 */
export function calcularDeudaPorTemporada(
  temporadas: TemporadaDeuda[],
  abonos: AbonoAplicable[],
  unidades: number,
  today: string,
  deudaInicial: DeudaInicialLinea[] = [],
  cargos: CargoDeuda[] = []
): DeudaPorTemporada {
  const cargosDe = (temporadaId: number): CargoDeuda[] =>
    cargos.filter(c => c.temporada_id === temporadaId).sort((a, b) => a.id - b.id)

  // A temporada with a pago is settled, but an unpaid cargo re-opens it (D11).
  const relevantes = temporadas
    .filter(t => !t.pagada || cargosDe(t.id).some(c => !c.pagado))
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))

  const rows = relevantes.map(t => ({
    temporada: t,
    // A settled temporada owes no cuota and can accrue no multa; only its
    // outstanding cargos survive.
    cuota: t.pagada ? 0 : roundPesos(t.valor_accion * unidades),
    abonado: 0,
    /** Only the part that arrived on or before this temporada's deadline. */
    abonadoAlPlazo: 0,
    cargos: cargosDe(t.id).map(c => ({
      cargo: c,
      monto: roundPesos(c.monto),
      abonado: 0
    })),
    multa: 0,
    multa_abonada: 0
  }))

  // The abonos as a pot drawn down in date order. Date order matters even
  // though the total does not: only money that arrived by a temporada's
  // `fecha_multa` reduces that temporada's fine.
  const pot = [...abonos]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map(a => ({ fecha: a.fecha, remaining: a.total }))

  /**
   * Draws up to `limit` from the pot, reporting how much of it arrived on or
   * before `deadline` (all of it, when there is no deadline to beat).
   */
  const draw = (limit: number, deadline: string | null): { taken: number; alPlazo: number } => {
    let taken = 0
    let alPlazo = 0
    for (const abono of pot) {
      if (taken >= limit) break
      if (abono.remaining <= 0) continue
      const take = Math.min(abono.remaining, limit - taken)
      abono.remaining -= take
      taken += take
      if (deadline === null || abono.fecha <= deadline) alPlazo += take
    }
    return { taken, alPlazo }
  }

  // Pre-app debt is older than every temporada, so it is served first (D14).
  // Within it, cuota before otros before multa — the same order a temporada
  // charges in (D3). These amounts are never recomputed: they were transcribed
  // from the administration's records, not derived.
  const inicialOrdenada = [...deudaInicial].sort((a, b) => {
    const rango = ORDEN_TIPO_DEUDA[a.tipo] - ORDEN_TIPO_DEUDA[b.tipo]
    return rango !== 0 ? rango : a.id - b.id
  })

  const deuda_inicial: DeudaInicialBreakdown[] = inicialOrdenada.map(linea => {
    const monto = roundPesos(linea.monto)
    const abonado = draw(monto, null).taken
    return {
      id: linea.id,
      concepto: linea.concepto,
      tipo: linea.tipo,
      monto,
      abonado,
      pendiente: monto - abonado
    }
  })

  // Oldest temporada first, and within each one: cuota, then cargos, then the
  // multa — "cubre primero la deuda y al último las multas" (D3), with cargos
  // counting as deuda. Resolving a temporada completely before moving on is what
  // makes the fine computable: it depends only on its own cuota coverage at its
  // own deadline, so it is known by the time the next temporada draws.
  for (const row of rows) {
    const { fecha_multa, monto_multa_por_accion, pagada } = row.temporada

    const cuota = draw(row.cuota, fecha_multa)
    row.abonado = cuota.taken
    row.abonadoAlPlazo = cuota.alPlazo

    for (const c of row.cargos) {
      // A cargo settled by a pago or by hand takes nothing from the pot: that
      // money never passed through the abonos.
      if (c.cargo.pagado) continue
      c.abonado = draw(c.monto, null).taken
    }

    if (!pagada && fecha_multa && isPast(fecha_multa, today) && row.cuota > 0) {
      const fraccionPendiente = Math.max(0, 1 - row.abonadoAlPlazo / row.cuota)
      row.multa = roundPesos(fraccionPendiente * unidades * monto_multa_por_accion)
    }

    row.multa_abonada = draw(row.multa, null).taken
  }

  const sobrante = pot.reduce((acc, a) => acc + a.remaining, 0)

  const breakdown: TemporadaBreakdown[] = rows.map(row => {
    const pendiente_cuota = row.cuota - row.abonado
    const pendiente_multa = row.multa - row.multa_abonada

    const cargosBreakdown: CargoBreakdown[] = row.cargos.map(c => ({
      cargo_id: c.cargo.id,
      nombre: c.cargo.nombre,
      monto: c.monto,
      abonado: c.abonado,
      pendiente: c.cargo.pagado ? 0 : c.monto - c.abonado,
      pagado: c.cargo.pagado
    }))
    const total_cargos = cargosBreakdown.reduce((acc, c) => acc + c.monto, 0)
    const pendiente_cargos = cargosBreakdown.reduce((acc, c) => acc + c.pendiente, 0)

    return {
      temporada_id: row.temporada.id,
      nombre: row.temporada.nombre,
      pagada: row.temporada.pagada,
      cuota: row.cuota,
      abonado: row.abonado,
      pendiente_cuota,
      cargos: cargosBreakdown,
      total_cargos,
      pendiente_cargos,
      multa: row.multa,
      multa_abonada: row.multa_abonada,
      pendiente_multa,
      pendiente: pendiente_cuota + pendiente_cargos + pendiente_multa
    }
  })

  const sum = (pick: (r: TemporadaBreakdown) => number): number =>
    breakdown.reduce((acc, r) => acc + pick(r), 0)
  const sumInicial = (pick: (r: DeudaInicialBreakdown) => number): number =>
    deuda_inicial.reduce((acc, r) => acc + pick(r), 0)
  const abonadoACargos = breakdown.reduce(
    (acc, t) => acc + t.cargos.reduce((a, c) => a + c.abonado, 0), 0
  )

  return {
    deuda_inicial,
    temporadas: breakdown,
    total_deuda_inicial: sumInicial(r => r.monto),
    total_cuotas: sum(r => r.cuota),
    total_cargos: sum(r => r.total_cargos),
    total_multas: sum(r => r.multa),
    total_abonado:
      sumInicial(r => r.abonado) + sum(r => r.abonado) + abonadoACargos + sum(r => r.multa_abonada),
    excedente: sobrante,
    total_pendiente: sumInicial(r => r.pendiente) + sum(r => r.pendiente)
  }
}
