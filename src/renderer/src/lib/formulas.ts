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
  periodosAtrasados: number
): number {
  const a = acciones > 0 ? acciones : 1
  const h = hectareas > 0 ? hectareas : 1
  return 5000 * a * h * periodosAtrasados
}

export function calcularTotal(
  montoAcciones: number,
  multas: number,
  cuotaExtraordinaria: number,
  otrosIngresos: number
): number {
  return montoAcciones + multas + cuotaExtraordinaria + otrosIngresos
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
