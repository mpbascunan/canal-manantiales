import { ipcMain } from 'electron'
import { getDb } from '../connection'

export function registerCargoHandlers(): void {
  // List cargo headers for a temporada with accionista count and total monto
  ipcMain.handle('cargos:list-by-temporada', (_e, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT c.*,
                t.nombre AS temporada_nombre,
                COUNT(ca.id)            AS accionista_count,
                COALESCE(SUM(ca.monto), 0) AS total_monto,
                SUM(CASE WHEN ca.pagado = 1 THEN 1 ELSE 0 END) AS pagados_count
         FROM cargos c
         JOIN temporadas t ON t.id = c.temporada_id
         LEFT JOIN cargo_accionistas ca ON ca.cargo_id = c.id
         WHERE c.temporada_id = ?
         GROUP BY c.id
         ORDER BY c.fecha DESC, c.nombre`
      )
      .all(temporadaId)
  })

  // Get a single cargo header with its full list of accionistas
  ipcMain.handle('cargos:get-with-accionistas', (_e, cargoId: number) => {
    const db = getDb()
    const cargo = db
      .prepare(
        `SELECT c.*, t.nombre AS temporada_nombre
         FROM cargos c
         JOIN temporadas t ON t.id = c.temporada_id
         WHERE c.id = ?`
      )
      .get(cargoId) as any

    if (!cargo) return null

    const accionistas = db
      .prepare(
        `SELECT ca.accionista_id AS id, a.nombre,
                COALESCE(pt.total_acciones,  0) AS acciones,
                COALESCE(pt.total_hectareas, 0) AS hectareas,
                ca.monto, ca.pagado
         FROM cargo_accionistas ca
         JOIN accionistas a ON a.id = ca.accionista_id
         LEFT JOIN (
           SELECT accionista_id,
                  SUM(acciones)  AS total_acciones,
                  SUM(hectareas) AS total_hectareas
           FROM propiedades
           GROUP BY accionista_id
         ) pt ON pt.accionista_id = a.id
         WHERE ca.cargo_id = ?
         ORDER BY a.nombre`
      )
      .all(cargoId)

    return { ...cargo, accionistas }
  })

  // Create a cargo header + junction rows in one transaction.
  // For 'proporcional': monto = tarifa × (acciones + hectareas).
  // For 'fija': monto = tarifa (same for every accionista).
  ipcMain.handle(
    'cargos:create',
    (
      _e,
      input: {
        nombre: string
        temporada_id: number
        tarifa: number
        tipo_tarifa: 'proporcional' | 'fija'
        fecha: string
        notas?: string | null
        accionista_ids: number[]
      }
    ) => {
      const db = getDb()
      const tipoTarifa = input.tipo_tarifa ?? 'proporcional'

      const getAccionista = db.prepare(
        `SELECT COALESCE(pt.total_acciones,  0) AS acciones,
                COALESCE(pt.total_hectareas, 0) AS hectareas
         FROM accionistas a
         LEFT JOIN (
           SELECT accionista_id,
                  SUM(acciones)  AS total_acciones,
                  SUM(hectareas) AS total_hectareas
           FROM propiedades
           GROUP BY accionista_id
         ) pt ON pt.accionista_id = a.id
         WHERE a.id = ?`
      )

      const insertCargo = db.prepare(
        `INSERT INTO cargos (nombre, temporada_id, tarifa, tipo_tarifa, fecha, notas)
         VALUES (@nombre, @temporada_id, @tarifa, @tipo_tarifa, @fecha, @notas)`
      )
      const insertCA = db.prepare(
        `INSERT OR IGNORE INTO cargo_accionistas (cargo_id, accionista_id, monto)
         VALUES (@cargo_id, @accionista_id, @monto)`
      )

      let cargoId: number
      db.transaction(() => {
        const result = insertCargo.run({
          nombre: input.nombre,
          temporada_id: input.temporada_id,
          tarifa: input.tarifa,
          tipo_tarifa: tipoTarifa,
          fecha: input.fecha,
          notas: input.notas ?? null
        })
        cargoId = Number(result.lastInsertRowid)

        for (const accionistaId of input.accionista_ids) {
          let monto: number
          if (tipoTarifa === 'fija') {
            monto = input.tarifa
          } else {
            const row = getAccionista.get(accionistaId) as { acciones: number; hectareas: number } | undefined
            monto = input.tarifa * ((row?.acciones ?? 0) + (row?.hectareas ?? 0))
          }
          insertCA.run({ cargo_id: cargoId, accionista_id: accionistaId, monto })
        }
      })()

      return { success: true, id: cargoId! }
    }
  )

  // Add more accionistas to an existing cargo
  ipcMain.handle('cargos:add-accionistas', (_e, cargoId: number, accionistaIds: number[]) => {
    const db = getDb()
    const cargo = db.prepare('SELECT tarifa, tipo_tarifa FROM cargos WHERE id = ?').get(cargoId) as { tarifa: number; tipo_tarifa: string } | undefined
    if (!cargo) return { success: false }

    const getAccionista = db.prepare(
      `SELECT COALESCE(pt.total_acciones,  0) AS acciones,
              COALESCE(pt.total_hectareas, 0) AS hectareas
       FROM accionistas a
       LEFT JOIN (
         SELECT accionista_id,
                SUM(acciones)  AS total_acciones,
                SUM(hectareas) AS total_hectareas
         FROM propiedades
         GROUP BY accionista_id
       ) pt ON pt.accionista_id = a.id
       WHERE a.id = ?`
    )
    const insertCA = db.prepare(
      `INSERT OR IGNORE INTO cargo_accionistas (cargo_id, accionista_id, monto)
       VALUES (@cargo_id, @accionista_id, @monto)`
    )

    db.transaction(() => {
      for (const accionistaId of accionistaIds) {
        let monto: number
        if (cargo.tipo_tarifa === 'fija') {
          monto = cargo.tarifa
        } else {
          const row = getAccionista.get(accionistaId) as { acciones: number; hectareas: number } | undefined
          monto = cargo.tarifa * ((row?.acciones ?? 0) + (row?.hectareas ?? 0))
        }
        insertCA.run({ cargo_id: cargoId, accionista_id: accionistaId, monto })
      }
    })()

    return { success: true }
  })

  // Remove one accionista from a cargo
  ipcMain.handle('cargos:remove-accionista', (_e, cargoId: number, accionistaId: number) => {
    getDb()
      .prepare('DELETE FROM cargo_accionistas WHERE cargo_id = ? AND accionista_id = ?')
      .run(cargoId, accionistaId)
    return { success: true }
  })

  // Toggle paid status for one accionista's cargo
  ipcMain.handle('cargos:set-pagado', (_e, cargoId: number, accionistaId: number, pagado: boolean) => {
    getDb()
      .prepare('UPDATE cargo_accionistas SET pagado = ? WHERE cargo_id = ? AND accionista_id = ?')
      .run(pagado ? 1 : 0, cargoId, accionistaId)
    return { success: true }
  })

  // Per-cargo summary for a temporada: total emitted and total collected (pagado=1)
  ipcMain.handle('cargos:resumen-by-temporada', (_e, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT c.id, c.nombre,
                COALESCE(SUM(ca.monto), 0) AS total_emitido,
                COALESCE(SUM(CASE WHEN ca.pagado = 1 THEN ca.monto ELSE 0 END), 0) AS total_cobrado
         FROM cargos c
         LEFT JOIN cargo_accionistas ca ON ca.cargo_id = c.id
         WHERE c.temporada_id = ?
         GROUP BY c.id, c.nombre
         ORDER BY c.nombre`
      )
      .all(temporadaId)
  })

  // Delete a cargo header (cascades to cargo_accionistas)
  ipcMain.handle('cargos:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM cargos WHERE id = ?').run(id)
    return { success: true }
  })

  // List cargos assigned to a specific accionista in a specific temporada.
  // Proporcional: monto recomputed live from propiedades. Fija: use stored tarifa.
  ipcMain.handle('cargos:list-by-accionista', (_e, accionistaId: number, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT c.id, c.nombre, c.fecha, c.tarifa, c.tipo_tarifa, c.notas, ca.pagado,
                CASE WHEN c.tipo_tarifa = 'fija' THEN c.tarifa
                     ELSE c.tarifa * (COALESCE(pt.total_acciones, 0) + COALESCE(pt.total_hectareas, 0))
                END AS monto
         FROM cargo_accionistas ca
         JOIN cargos c ON c.id = ca.cargo_id
         LEFT JOIN (
           SELECT accionista_id,
                  SUM(acciones)  AS total_acciones,
                  SUM(hectareas) AS total_hectareas
           FROM propiedades
           GROUP BY accionista_id
         ) pt ON pt.accionista_id = ca.accionista_id
         WHERE ca.accionista_id = ? AND c.temporada_id = ?
         ORDER BY c.fecha DESC, c.nombre`
      )
      .all(accionistaId, temporadaId)
  })
}
