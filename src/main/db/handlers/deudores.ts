import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { DeudorConfig } from '../../../shared/types'
import { calcularDeudaPorTemporada } from '../../../shared/deuda'
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
 * the rules in SQL again — the cargo amount formula already exists twice and the
 * copies can drift (context.md G6).
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

  // The cargo amount rule, resolved here so the engine only ever sees a figure:
  // 'fija' is a flat tarifa, anything else is tarifa × unidades.
  const cargos = db
    .prepare(
      `SELECT ca.cargo_id AS id, c.temporada_id, c.nombre,
              CASE WHEN c.tipo_tarifa = 'fija' THEN c.tarifa
                   ELSE c.tarifa * ? END AS monto,
              ca.pagado
       FROM cargo_accionistas ca
       JOIN cargos c ON c.id = ca.cargo_id
       WHERE ca.accionista_id = ?
       ORDER BY ca.cargo_id`
    )
    .all(unidades, accionistaId) as (Omit<CargoDeuda, 'pagado'> & { pagado: number })[]

  return calcularDeudaPorTemporada(
    temporadas.map(t => ({ ...t, pagada: t.pagada === 1 })),
    abonos,
    unidades,
    hoy,
    deudaInicial,
    cargos.map(c => ({ ...c, pagado: c.pagado === 1 }))
  )
}

export function registerDeudorHandlers(): void {
  ipcMain.handle('deudores:list', (_e, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT a.id, a.nombre, a.activo, a.notas,
                COALESCE(pt.total_acciones, 0)            AS acciones,
                COALESCE(pt.total_hectareas, 0)           AS hectareas,
                pt.nombres_propiedades                    AS nombres_propiedades,
                COALESCE(dc.temporadas_adeudadas, 1)      AS temporadas_adeudadas,
                COALESCE(abn.total_abonado, 0)            AS total_abonado,
                COALESCE(cg.total_cargos, 0)              AS total_cargos,
                COALESCE(cg.total_cargos_pagados, 0)      AS total_cargos_pagados,
                CASE WHEN EXISTS(
                  SELECT 1 FROM pagos p WHERE p.accionista_id = a.id AND p.temporada_id = ?
                ) THEN 1 ELSE 0 END AS has_full_payment
         FROM accionistas a
         ${PROPS_AGG}
         LEFT JOIN deudores_config dc
               ON dc.accionista_id = a.id AND dc.temporada_id = ?
         LEFT JOIN (
               SELECT accionista_id, SUM(total) AS total_abonado
               FROM abonos
               WHERE temporada_id = ?
               GROUP BY accionista_id
         ) abn ON abn.accionista_id = a.id
         LEFT JOIN (
               SELECT ca.accionista_id,
                      SUM(CASE WHEN c.tipo_tarifa = 'fija' THEN c.tarifa
                               ELSE c.tarifa * (COALESCE(pt.total_acciones, 0) + COALESCE(pt.total_hectareas, 0))
                          END) AS total_cargos,
                      SUM(CASE WHEN ca.pagado = 1 THEN
                               CASE WHEN c.tipo_tarifa = 'fija' THEN c.tarifa
                                    ELSE c.tarifa * (COALESCE(pt.total_acciones, 0) + COALESCE(pt.total_hectareas, 0))
                               END
                          ELSE 0 END) AS total_cargos_pagados
               FROM cargo_accionistas ca
               JOIN cargos c ON c.id = ca.cargo_id
               LEFT JOIN (
                 SELECT accionista_id,
                        SUM(acciones)  AS total_acciones,
                        SUM(hectareas) AS total_hectareas
                 FROM propiedades GROUP BY accionista_id
               ) pt ON pt.accionista_id = ca.accionista_id
               WHERE c.temporada_id = ?
               GROUP BY ca.accionista_id
         ) cg ON cg.accionista_id = a.id
         WHERE a.activo = 1
           AND (
             NOT EXISTS (
               SELECT 1 FROM pagos p
               WHERE p.accionista_id = a.id AND p.temporada_id = ?
             )
             OR EXISTS (
               SELECT 1 FROM cargo_accionistas ca
               JOIN cargos c ON c.id = ca.cargo_id
               WHERE ca.accionista_id = a.id AND c.temporada_id = ? AND ca.pagado = 0
             )
           )
         ORDER BY a.nombre`
      )
      .all(temporadaId, temporadaId, temporadaId, temporadaId, temporadaId, temporadaId)
  })

  ipcMain.handle('deudores:get-config', (_e, accionistaId: number, temporadaId: number) => {
    const db = getDb()
    const config = db
      .prepare('SELECT * FROM deudores_config WHERE accionista_id = ? AND temporada_id = ?')
      .get(accionistaId, temporadaId) as DeudorConfig | undefined

    const abonado = db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS total_abonado
         FROM abonos WHERE accionista_id = ? AND temporada_id = ?`
      )
      .get(accionistaId, temporadaId) as { total_abonado: number }

    const cargos = db
      .prepare(
        `SELECT
           COALESCE(SUM(
             CASE WHEN c.tipo_tarifa = 'fija' THEN c.tarifa
                  ELSE c.tarifa * (COALESCE(pt.total_acciones, 0) + COALESCE(pt.total_hectareas, 0))
             END
           ), 0) AS total_cargos,
           COALESCE(SUM(CASE WHEN ca.pagado = 1 THEN
             CASE WHEN c.tipo_tarifa = 'fija' THEN c.tarifa
                  ELSE c.tarifa * (COALESCE(pt.total_acciones, 0) + COALESCE(pt.total_hectareas, 0))
             END
           ELSE 0 END), 0) AS total_cargos_pagados
         FROM cargo_accionistas ca
         JOIN cargos c ON c.id = ca.cargo_id
         LEFT JOIN (
           SELECT accionista_id,
                  SUM(acciones)  AS total_acciones,
                  SUM(hectareas) AS total_hectareas
           FROM propiedades
           GROUP BY accionista_id
         ) pt ON pt.accionista_id = ca.accionista_id
         WHERE ca.accionista_id = ? AND c.temporada_id = ?`
      )
      .get(accionistaId, temporadaId) as { total_cargos: number; total_cargos_pagados: number }

    return {
      temporadas_adeudadas:  config?.temporadas_adeudadas ?? 1,
      total_abonado:         abonado.total_abonado,
      total_cargos:          cargos.total_cargos,
      total_cargos_pagados:  cargos.total_cargos_pagados
    }
  })

  /**
   * The full debt of one accionista, across every temporada (D13).
   *
   * Assembles the rows and hands them to the shared engine rather than
   * expressing the rules in SQL again — the cargo amount formula already exists
   * twice and the copies can drift (context.md G6).
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
   * that can disagree (context.md G6).
   */
  ipcMain.handle('deudores:list-deuda', (_e, hoy?: string) => {
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
      .filter(row => row.deuda.total_pendiente > 0)
  })

  ipcMain.handle('deudores:upsert-config', (_e, cfg: DeudorConfig) => {
    getDb()
      .prepare(
        `INSERT INTO deudores_config
           (accionista_id, temporada_id, temporadas_adeudadas)
         VALUES
           (@accionista_id, @temporada_id, @temporadas_adeudadas)
         ON CONFLICT(accionista_id, temporada_id) DO UPDATE SET
           temporadas_adeudadas = excluded.temporadas_adeudadas`
      )
      .run(cfg)
  })
}
