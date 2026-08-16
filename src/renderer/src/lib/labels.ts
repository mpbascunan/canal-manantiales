import type { TipoDeudaInicial } from '../../../shared/types'

/**
 * Spanish labels for values the database stores in English-ish constants.
 *
 * Kept in one place because these strings appear on screen, on the aviso PDF and
 * in the Excel exports at once — a debt line that reads "Multa" in the app and
 * "MULTA" on the notice is the kind of drift nobody notices until a shareholder
 * asks why they disagree.
 */
export const DEUDA_TIPO_LABELS: Record<TipoDeudaInicial, string> = {
  CUOTA: 'Cuota',
  MULTA: 'Multa',
  OTRO: 'Otro'
}

/** The default concepto for a line the spreadsheet did not name. */
export const DEUDA_TIPO_CONCEPTO: Record<TipoDeudaInicial, string> = {
  CUOTA: 'Cuota temporadas anteriores',
  MULTA: 'Multa temporadas anteriores',
  OTRO: 'Otros cobros temporadas anteriores'
}
