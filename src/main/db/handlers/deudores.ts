import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { DeudorConfig } from '../../../shared/types'

// Reuse the same propiedades aggregation join from accionistas handler
const PROPS_AGG = `
  LEFT JOIN (
    SELECT accionista_id,
           SUM(acciones)  AS total_acciones,
           SUM(hectareas) AS total_hectareas,
           GROUP_CONCAT(
             CASE WHEN numero IS NOT NULL AND TRIM(numero) != '' THEN numero ELSE NULL END,
             ', '
           ) AS numeros
    FROM propiedades
    GROUP BY accionista_id
  ) pt ON pt.accionista_id = a.id
  LEFT JOIN propiedades pf ON pf.accionista_id = a.id
         AND pf.id = (SELECT MIN(id) FROM propiedades WHERE accionista_id = a.id)
`

export function registerDeudorHandlers(): void {
  ipcMain.handle('deudores:list', (_e, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT a.id, a.nombre, a.activo, a.notas,
                COALESCE(pt.total_acciones, 0)   AS acciones,
                COALESCE(pt.total_hectareas, 0) AS hectareas,
                COALESCE(pf.tipo, a.tipo)                 AS tipo,
                COALESCE(pf.numero, a.numero)             AS numero,
                COALESCE(pt.numeros, a.numero)            AS numeros,
                COALESCE(dc.temporadas_adeudadas, 1)      AS temporadas_adeudadas,
                COALESCE(dc.cuota_extraordinaria, 0)      AS cuota_extraordinaria,
                COALESCE(dc.otros_ingresos, 0)            AS otros_ingresos,
                COALESCE(abn.total_abonado, 0)            AS total_abonado,
                COALESCE(cg.total_cargos, 0)              AS total_cargos
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
                          END) AS total_cargos
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
           AND NOT EXISTS (
             SELECT 1 FROM pagos p
             WHERE p.accionista_id = a.id AND p.temporada_id = ?
           )
         ORDER BY a.nombre`
      )
      .all(temporadaId, temporadaId, temporadaId, temporadaId)
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
      cuota_extraordinaria:  config?.cuota_extraordinaria ?? 0,
      otros_ingresos:        config?.otros_ingresos ?? 0,
      total_abonado:         abonado.total_abonado,
      total_cargos:          cargos.total_cargos,
      total_cargos_pagados:  cargos.total_cargos_pagados
    }
  })

  ipcMain.handle('deudores:upsert-config', (_e, cfg: DeudorConfig) => {
    getDb()
      .prepare(
        `INSERT INTO deudores_config
           (accionista_id, temporada_id, temporadas_adeudadas, cuota_extraordinaria, otros_ingresos)
         VALUES
           (@accionista_id, @temporada_id, @temporadas_adeudadas, @cuota_extraordinaria, @otros_ingresos)
         ON CONFLICT(accionista_id, temporada_id) DO UPDATE SET
           temporadas_adeudadas = excluded.temporadas_adeudadas,
           cuota_extraordinaria = excluded.cuota_extraordinaria,
           otros_ingresos       = excluded.otros_ingresos`
      )
      .run(cfg)
  })
}
