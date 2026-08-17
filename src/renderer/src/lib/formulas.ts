/**
 * Formatting, and the two arithmetic helpers the pago form still uses.
 *
 * **There is no debt calculation here.** `calcularDeuda`, `calcularMultas`,
 * `calcularMultaVencimiento` and `tieneMultaVencimiento` used to live in this
 * file and implemented the old model: a flat multa multiplied by
 * `temporadas_adeudadas − 1`, *plus* a second vencimiento multa, so a late
 * shareholder with a backlog was fined twice — and every season was priced at
 * the active season's rate. They were deleted with context.md G7. The one debt
 * calculation is `calcularDeudaPorTemporada` in `src/shared/deuda.ts`; anything
 * that needs a figure asks `deudores:get-deuda` or `deudores:list-deuda` for it.
 */

/**
 * What a cuota comes to for `temporadas` seasons at one season's rate.
 *
 * Only for seeding the pago form before the real breakdown arrives — an
 * hectárea is priced exactly as an acción (D1). Any figure that is saved or
 * shown as debt comes from the engine, which reads each season's own rate.
 */
export function calcularMontoAcciones(
  valorAccion: number,
  acciones: number,
  hectareas: number,
  temporadasPagadas: number
): number {
  return (valorAccion * acciones + valorAccion * hectareas) * temporadasPagadas
}

export function calcularTotal(
  montoAcciones: number,
  multas: number
): number {
  return montoAcciones + multas
}

export function formatCLP(value: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(value))
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

export function mesNombre(mes: string | number): string {
  const n = typeof mes === 'string' ? parseInt(mes, 10) : mes
  return MESES[n - 1] ?? String(mes)
}

export function formatNumber(value: number, decimals = 4): string {
  if (value <= 0) return '—'
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  })
}

export function formatFecha(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
