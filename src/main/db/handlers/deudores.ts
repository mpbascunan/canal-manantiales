import { ipcMain } from 'electron'
import { getDb } from '../connection'
import { calcularDeudaPorTemporada, calcularMontoCargo } from '../../../shared/deuda'
import type {
  AbonoAplicable, CargoDeuda, DeudaInicialLinea, TemporadaDeuda
} from '../../../shared/deuda'

// Reuse the same propiedades aggregation join from accionistas handler
const PROPS_AGG = `
  LEFT JOIN (
    SELECT accionista_id,
           SUM(acciones)  AS total_acciones,
           SUM(hectareas) AS total_hectareas,
           GROUP_CONCAT(
             CASE WHEN nombre IS NOT NULL AND TRIM(nombre) != '' THEN nombre ELSE NULL END,
             ', '
           ) AS nombres_propiedades
    FROM propiedades
    GROUP BY accionista_id
  ) pt ON pt.accionista_id = a.id
`

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The full debt of one accionista, across every temporada (D13).
 *
 * Assembles the rows and hands them to the shared engine rather than expressing
 * the rules in SQL again: the cargo amount has exactly one implementation,
 * `calcularMontoCargo` (context.md G6).
 */
function computeDeuda(accionistaId: number, hoy: string) {
  const db = getDb()

  const { unidades } = db
    .prepare(
      `SELECT COALESCE(SUM(acciones), 0) + COALESCE(SUM(hectareas), 0) AS unidades
       FROM propiedades WHERE accionista_id = ?`
    )
    .get(accionistaId) as { unidades: number }

  const temporadas = db
    .prepare(
      `SELECT t.id, t.nombre, t.fecha_inicio, t.valor_accion,
              t.fecha_multa, t.monto_multa_por_accion,
              CASE WHEN EXISTS(
                SELECT 1 FROM pagos p
                WHERE p.accionista_id = ? AND p.temporada_id = t.id
              ) THEN 1 ELSE 0 END AS pagada
       FROM temporadas t
       ORDER BY t.fecha_inicio`
    )
    .all(accionistaId) as (Omit<TemporadaDeuda, 'pagada'> & { pagada: number })[]

  const abonos = db
    .prepare('SELECT fecha, total FROM abonos WHERE accionista_id = ? ORDER BY fecha')
    .all(accionistaId) as AbonoAplicable[]

  const deudaInicial = db
    .prepare(
      'SELECT id, concepto, tipo, monto FROM deuda_inicial WHERE accionista_id = ? ORDER BY id'
    )
    .all(accionistaId) as DeudaInicialLinea[]

  // The cargo amount is resolved here, by the shared rule, so the engine only
  // ever sees a figure — and so this is not a second copy of the formula (G6).
  const cargos = db
    .prepare(
      `SELECT ca.cargo_id AS id, c.temporada_id, c.nombre,
              c.tarifa, c.tipo_tarifa, ca.pagado
       FROM cargo_accionistas ca
       JOIN cargos c ON c.id = ca.cargo_id
       WHERE ca.accionista_id = ?
       ORDER BY ca.cargo_id`
    )
    .all(accionistaId) as (Omit<CargoDeuda, 'pagado' | 'monto'> & {
      tarifa: number; tipo_tarifa: string; pagado: number
    })[]

  return calcularDeudaPorTemporada(
    temporadas.map(t => ({ ...t, pagada: t.pagada === 1 })),
    abonos,
    unidades,
    hoy,
    deudaInicial,
    cargos.map(c => ({
      ...c,
      monto: calcularMontoCargo(c.tipo_tarifa, c.tarifa, unidades),
      pagado: c.pagado === 1
    }))
  )
}

/**
 * Every channel here answers from `calcularDeudaPorTemporada`.
 *
 * There used to be three more — `deudores:list`, `:get-config` and
 * `:upsert-config` — built on `deudores_config.temporadas_adeudadas`: a count of
 * owed seasons, priced entirely at the *active* season's rate. D19 removed it,
 * and with it the last path that could put a different debt on screen than the
 * one the engine computes. Pre-app debt is `deuda_inicial` (D14); everything
 * after it derives from real `temporadas` rows at their own rates (D13).
 */
export function registerDeudorHandlers(): void {
  /**
   * The full debt of one accionista, across every temporada (D13).
   *
   * Assembles the rows and hands them to the shared engine rather than
   * expressing the rules in SQL again (context.md G6).
   *
   * `hoy` is a parameter so the caller can reproduce a past state; it defaults
   * to today.
   */
  ipcMain.handle('deudores:get-deuda', (_e, accionistaId: number, hoy?: string) => {
    return computeDeuda(accionistaId, hoy ?? today())
  })

  /**
   * The same breakdown for every active accionista, for the deudores listing.
   *
   * One call per accionista rather than a single clever query: better-sqlite3 is
   * synchronous and in-process, and one shared code path that is right beats two
   * that can disagree.
   *
   * `incluirSinDeuda` keeps the settled shareholders in the result — the avisos
   * de cobro for "todos los accionistas" need a sheet for every one of them.
   */
  ipcMain.handle('deudores:list-deuda', (_e, hoy?: string, incluirSinDeuda = false) => {
    const db = getDb()
    const fecha = hoy ?? today()

    const accionistas = db
      .prepare(
        `SELECT a.id, a.nombre, a.apellido_paterno, a.apellido_materno,
                a.numero_socio, a.notas,
                COALESCE(pt.total_acciones, 0)  AS acciones,
                COALESCE(pt.total_hectareas, 0) AS hectareas,
                pt.nombres_propiedades          AS nombres_propiedades
         FROM accionistas a
         ${PROPS_AGG}
         WHERE a.activo = 1
         ORDER BY a.nombre`
      )
      .all() as Record<string, unknown>[]

    return accionistas
      .map(a => ({ ...a, deuda: computeDeuda(a.id as number, fecha) }))
      .filter(row => incluirSinDeuda || row.deuda.total_pendiente > 0)
  })
}
