import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { AbonoInput } from '../../../shared/types'

export function registerAbonoHandlers(): void {
  ipcMain.handle('abonos:create', (_e, input: AbonoInput) => {
    const db = getDb()

    db.prepare(
      `INSERT INTO abonos
       (numero_ingreso, accionista_id, temporada_id, fecha, temporadas_cubiertas,
        monto, multas, cuota_extraordinaria, otros_ingresos, total, notas)
       VALUES
       (@numero_ingreso, @accionista_id, @temporada_id, @fecha, 0,
        @monto, @multas, @cuota_extraordinaria, @otros_ingresos, @total, @notas)`
    ).run({
      numero_ingreso: input.numero_ingreso,
      accionista_id:  input.accionista_id,
      temporada_id:   input.temporada_id,
      fecha:          input.fecha,
      monto:          input.monto,
      multas:         input.multas,
      cuota_extraordinaria: input.cuota_extraordinaria,
      otros_ingresos: input.otros_ingresos,
      total:          input.total,
      notas:          input.notas ?? null
    })

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
