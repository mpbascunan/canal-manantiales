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

      // Deliberately does NOT mark cargos as paid.
      //
      // It used to: if the accionista's total abonado for the temporada reached
      // the sum of their pending cargos, every one of them was flipped to
      // `pagado`. That spent the same money twice — the abono settled the cargos
      // *and* still counted in full against the cuota.
      //
      // How much of a cargo an abono has covered is now derived, by
      // `calcularDeudaPorTemporada` allocating each abono across the cuota, then
      // the cargos, then the multa (D3). `cargo_accionistas.pagado` keeps its
      // narrower meaning: settled outside the abono flow, by a pago or by hand.
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
