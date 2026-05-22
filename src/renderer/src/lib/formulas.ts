export function calcularMontoAcciones(
  valorAccion: number,
  acciones: number,
  hectareas: number,
  temporadasPagadas: number
): number {
  return (valorAccion * acciones + valorAccion * hectareas) * temporadasPagadas
}

export function calcularMultas(
  acciones: number,
  hectareas: number,
  temporadasAdeudadas: number,
  montoPorAccion: number
): number {
  if (temporadasAdeudadas <= 1) return 0
  return montoPorAccion * (acciones + hectareas) * (temporadasAdeudadas - 1)
}

export function tieneMultaVencimiento(temporada: { fecha_multa: string | null }): boolean {
  if (!temporada.fecha_multa) return false
  return new Date() > new Date(temporada.fecha_multa)
}

export function calcularMultaVencimiento(
  acciones: number,
  hectareas: number,
  montoPorAccion: number,
  valorAccion: number,
  totalAbonado: number
): number {
  const montoUnaTemporada = valorAccion * (acciones + hectareas)
  if (montoUnaTemporada === 0) return 0
  const fraccionPendiente = Math.max(0, 1 - Math.min(1, totalAbonado / montoUnaTemporada))
  return montoPorAccion * (acciones + hectareas) * fraccionPendiente
}

export function calcularTotal(
  montoAcciones: number,
  multas: number,
  cuotaExtraordinaria: number,
  otrosIngresos: number
): number {
  return montoAcciones + multas + cuotaExtraordinaria + otrosIngresos
}

export interface DeudaParams {
  valorAccion: number
  acciones: number
  hectareas: number
  temporadasAdeudadas: number
  cuotaExtraordinaria: number
  otrosIngresos: number
  totalAbonado: number
  totalCargos: number
  totalCargosPagados: number
  montoPorAccion: number
  multaVencimiento: number
}

export interface DeudaBreakdown {
  monto_acciones: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  subtotal: number           // base debt without cargos
  total_cargos: number
  total_cargos_pendientes: number
  total: number              // subtotal + total_cargos
  abonado: number
  pendiente: number          // max(0, subtotal - abonado) + total_cargos_pendientes
}

export function calcularDeuda(p: DeudaParams): DeudaBreakdown {
  const monto_acciones = calcularMontoAcciones(p.valorAccion, p.acciones, p.hectareas, p.temporadasAdeudadas)
  const multas = calcularMultas(p.acciones, p.hectareas, p.temporadasAdeudadas, p.montoPorAccion) + p.multaVencimiento
  const subtotal = calcularTotal(monto_acciones, multas, p.cuotaExtraordinaria, p.otrosIngresos)
  const total_cargos_pendientes = p.totalCargos - p.totalCargosPagados
  const total = subtotal + p.totalCargos
  const pendiente = Math.max(0, subtotal - p.totalAbonado) + total_cargos_pendientes
  return {
    monto_acciones,
    multas,
    cuota_extraordinaria: p.cuotaExtraordinaria,
    otros_ingresos: p.otrosIngresos,
    subtotal,
    total_cargos: p.totalCargos,
    total_cargos_pendientes,
    total,
    abonado: p.totalAbonado,
    pendiente
  }
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
