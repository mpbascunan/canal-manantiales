import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { AbonoInput } from '../../../shared/types'

export function registerAbonoHandlers(): void {
  ipcMain.handle('abonos:create', (_e, input: AbonoInput) => {
    const db = getDb()

    db.transaction(() => {
      db.prepare(
        `INSERT INTO abonos
         (numero_ingreso, accionista_id, temporada_id, fecha, temporadas_cubiertas,
          monto, multas, total, notas)
         VALUES
         (@numero_ingreso, @accionista_id, @temporada_id, @fecha, 0,
          @monto, @multas, @total, @notas)`
      ).run({
        numero_ingreso: input.numero_ingreso,
        accionista_id:  input.accionista_id,
        temporada_id:   input.temporada_id,
        fecha:          input.fecha,
        monto:          input.monto,
        multas:         input.multas,
        total:          input.total,
        notas:          input.notas ?? null
      })

      // Auto-mark cargos as paid if total abonado now covers all pending cargos
      const { total_abonado } = db.prepare(
        `SELECT COALESCE(SUM(total), 0) AS total_abonado
         FROM abonos WHERE accionista_id = ? AND temporada_id = ?`
      ).get(input.accionista_id, input.temporada_id) as { total_abonado: number }

      const { total_cargos_pendientes } = db.prepare(
        `SELECT COALESCE(SUM(ca.monto), 0) AS total_cargos_pendientes
         FROM cargo_accionistas ca
         JOIN cargos c ON c.id = ca.cargo_id
         WHERE ca.accionista_id = ? AND c.temporada_id = ? AND ca.pagado = 0`
      ).get(input.accionista_id, input.temporada_id) as { total_cargos_pendientes: number }

      if (total_cargos_pendientes > 0 && total_abonado >= total_cargos_pendientes) {
        db.prepare(
          `UPDATE cargo_accionistas SET pagado = 1
           WHERE accionista_id = ? AND pagado = 0
             AND cargo_id IN (SELECT id FROM cargos WHERE temporada_id = ?)`
        ).run(input.accionista_id, input.temporada_id)
      }
    })()

    return { success: true }
  })

  ipcMain.handle('abonos:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM abonos WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('abonos:list-by-accionista', (_e, accionistaId: number) => {
    return getDb()
      .prepare(
        `SELECT ab.*, a.nombre AS accionista_nombre, t.nombre AS temporada_nombre
         FROM abonos ab
         JOIN accionistas a ON a.id = ab.accionista_id
         JOIN temporadas t  ON t.id = ab.temporada_id
         WHERE ab.accionista_id = ?
         ORDER BY ab.fecha DESC, ab.id DESC`
      )
      .all(accionistaId)
  })

  ipcMain.handle('abonos:list-by-month', (_e, year: number, month: number) => {
    const from = `${year}-${String(month).padStart(2, '0')}-01`
    const to   = `${year}-${String(month).padStart(2, '0')}-31`
    return getDb()
      .prepare(
        `SELECT ab.*, a.nombre AS accionista_nombre, t.nombre AS temporada_nombre
         FROM abonos ab
         JOIN accionistas a ON a.id = ab.accionista_id
         JOIN temporadas t  ON t.id = ab.temporada_id
         WHERE ab.fecha BETWEEN ? AND ?
         ORDER BY ab.fecha, ab.numero_ingreso`
      )
      .all(from, to)
  })
}
