// Chilean RUT helpers: cleanup, módulo 11 check digit, and display formatting.

const RUT_PATTERN = /^\d{6,9}[\dK]$/

/** Strips dots, hyphens and spaces; uppercases a trailing "k". */
export function cleanRut(rut: string): string {
  return rut.replace(/[.\-\s]/g, '').toUpperCase()
}

/** Módulo 11 check digit for a RUT body (digits only). Returns '0'-'9' or 'K'. */
export function checkDigit(body: string): string {
  let sum = 0
  let factor = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const remainder = 11 - (sum % 11)
  if (remainder === 11) return '0'
  if (remainder === 10) return 'K'
  return String(remainder)
}

/**
 * True when the RUT is well-formed and its check digit matches.
 * Accepts 6–9 digit bodies (covers old short RUTs and company RUTs).
 */
export function isValidRut(rut: string): boolean {
  const cleaned = cleanRut(rut)
  if (!RUT_PATTERN.test(cleaned)) return false
  return checkDigit(cleaned.slice(0, -1)) === cleaned.slice(-1)
}

/** Formats as "12.345.678-9". Returns the input unchanged if it isn't RUT-shaped. */
export function formatRut(rut: string): string {
  const cleaned = cleanRut(rut)
  if (!RUT_PATTERN.test(cleaned)) return rut
  const body = cleaned.slice(0, -1)
  const dv   = cleaned.slice(-1)
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}
