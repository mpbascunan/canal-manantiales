import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { PagoInput } from '../../../shared/types'

const JOIN_SQL = `
  SELECT p.*, a.nombre AS accionista_nombre, a.tipo AS accionista_tipo,
         t.nombre AS temporada_nombre
  FROM pagos p
  JOIN accionistas a ON a.id = p.accionista_id
  JOIN temporadas t ON t.id = p.temporada_id
`

export function registerPagoHandlers(): void {
  ipcMain.handle('pagos:list-by-month', (_e, year: number, month: number) => {
    const from = `${year}-${String(month).padStart(2, '0')}-01`
    const to = `${year}-${String(month).padStart(2, '0')}-31`
    return getDb()
      .prepare(`${JOIN_SQL} WHERE p.fecha BETWEEN ? AND ? ORDER BY p.fecha, p.numero_ingreso`)
      .all(from, to)
  })

  ipcMain.handle('pagos:list-by-accionista', (_e, accionistaId: number) => {
    return getDb()
      .prepare(`${JOIN_SQL} WHERE p.accionista_id = ? ORDER BY p.fecha DESC`)
      .all(accionistaId)
  })

  ipcMain.handle('pagos:list-by-temporada', (_e, temporadaId: number) => {
    return getDb()
      .prepare(`${JOIN_SQL} WHERE p.temporada_id = ? ORDER BY p.fecha, p.numero_ingreso`)
      .all(temporadaId)
  })

  ipcMain.handle('pagos:recent', (_e, limit = 10) => {
    return getDb()
      .prepare(`${JOIN_SQL} ORDER BY p.created_at DESC LIMIT ?`)
      .all(limit)
  })

  ipcMain.handle('pagos:create', (_e, p: PagoInput) => {
    const db = getDb()
    const insertPago = db.prepare(
      `INSERT INTO pagos
       (numero_ingreso, accionista_id, temporada_id, fecha, temporadas_pagadas,
        monto_acciones, multas, cuota_extraordinaria, otros_ingresos, total, notas)
       VALUES
       (@numero_ingreso, @accionista_id, @temporada_id, @fecha, @temporadas_pagadas,
        @monto_acciones, @multas, @cuota_extraordinaria, @otros_ingresos, @total, @notas)`
    )
    const markCargosPaid = db.prepare(
      `UPDATE cargo_accionistas SET pagado = 1
       WHERE accionista_id = @accionista_id
         AND cargo_id IN (SELECT id FROM cargos WHERE temporada_id = @temporada_id)`
    )

    let pagoId: bigint | number
    db.transaction(() => {
      const result = insertPago.run(p)
      pagoId = result.lastInsertRowid
      markCargosPaid.run({ accionista_id: p.accionista_id, temporada_id: p.temporada_id })
    })()

    return db.prepare(`${JOIN_SQL} WHERE p.id = ?`).get(pagoId!)
  })

  ipcMain.handle('pagos:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM pagos WHERE id = ?').run(id)
  })

  ipcMain.handle('pagos:resumen-contable', (_e, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT
           COALESCE(SUM(monto_acciones), 0)       AS monto_acciones,
           COALESCE(SUM(multas), 0)               AS multas,
           COALESCE(SUM(cuota_extraordinaria), 0) AS cuota_extraordinaria,
           COALESCE(SUM(otros_ingresos), 0)       AS otros_ingresos,
           COALESCE(SUM(total), 0)                AS total
         FROM (
           SELECT monto_acciones, multas, cuota_extraordinaria, otros_ingresos, total
           FROM pagos WHERE temporada_id = ?
           UNION ALL
           SELECT monto AS monto_acciones, multas, cuota_extraordinaria, otros_ingresos, total
           FROM abonos WHERE temporada_id = ?
         )`
      )
      .get(temporadaId, temporadaId)
  })

  ipcMain.handle('pagos:resumen-mensual', (_e, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT
           strftime('%m', fecha) AS mes,
           strftime('%Y', fecha) AS anio,
           COALESCE(SUM(monto_acciones), 0)       AS monto_acciones,
           COALESCE(SUM(multas), 0)               AS multas,
           COALESCE(SUM(cuota_extraordinaria), 0) AS cuota_extraordinaria,
           COALESCE(SUM(otros_ingresos), 0)       AS otros_ingresos,
           COALESCE(SUM(total), 0)                AS total
         FROM (
           SELECT fecha, monto_acciones, multas, cuota_extraordinaria, otros_ingresos, total
           FROM pagos WHERE temporada_id = ?
           UNION ALL
           SELECT fecha, monto AS monto_acciones, multas, cuota_extraordinaria, otros_ingresos, total
           FROM abonos WHERE temporada_id = ?
         )
         GROUP BY strftime('%Y-%m', fecha)
         ORDER BY fecha`
      )
      .all(temporadaId, temporadaId)
  })

}
