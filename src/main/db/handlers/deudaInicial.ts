import { ipcMain } from 'electron'
import { getDb } from '../connection'
import { roundPesos } from '../../../shared/deuda'
import type { DeudaInicial, DeudaInicialInput } from '../../../shared/types'

/**
 * Debt an accionista carried in from before the app existed (context.md D14).
 *
 * These rows are transcribed from the administration's records, so nothing here
 * computes an amount — unlike cargos, whose per-person montos are derived from a
 * tarifa. How much is still owed is not stored either: `deuda_inicial` is the
 * oldest debt in the abono allocation, and `calcularDeudaPorTemporada` works it
 * out from the abonos.
 */
export function registerDeudaInicialHandlers(): void {
  ipcMain.handle('deuda-inicial:list-by-accionista', (_e, accionistaId: number) => {
    return getDb()
      .prepare(
        `SELECT * FROM deuda_inicial
         WHERE accionista_id = ?
         ORDER BY CASE tipo WHEN 'CUOTA' THEN 0 WHEN 'OTRO' THEN 1 ELSE 2 END, id`
      )
      .all(accionistaId)
  })

  /** Every line, joined to its accionista — the listing the entry screen shows. */
  ipcMain.handle('deuda-inicial:list', () => {
    return getDb()
      .prepare(
        `SELECT di.*,
                a.nombre, a.apellido_paterno, a.apellido_materno, a.numero_socio
         FROM deuda_inicial di
         JOIN accionistas a ON a.id = di.accionista_id
         ORDER BY a.nombre, di.id`
      )
      .all()
  })

  ipcMain.handle('deuda-inicial:create', (_e, input: DeudaInicialInput) => {
    const db = getDb()
    const result = db
      .prepare(
        `INSERT INTO deuda_inicial (accionista_id, concepto, tipo, monto, notas)
         VALUES (@accionista_id, @concepto, @tipo, @monto, @notas)`
      )
      .run({
        accionista_id: input.accionista_id,
        concepto: input.concepto,
        tipo: input.tipo,
        // Whole pesos on the way in (D8), so the stored figure and the one on
        // screen can never disagree.
        monto: roundPesos(input.monto),
        notas: input.notas ?? null
      })
    return db.prepare('SELECT * FROM deuda_inicial WHERE id = ?').get(result.lastInsertRowid)
  })

  ipcMain.handle('deuda-inicial:update', (_e, linea: DeudaInicial) => {
    const db = getDb()
    db.prepare(
      `UPDATE deuda_inicial
       SET concepto=@concepto, tipo=@tipo, monto=@monto, notas=@notas
       WHERE id=@id`
    ).run({
      id: linea.id,
      concepto: linea.concepto,
      tipo: linea.tipo,
      monto: roundPesos(linea.monto),
      notas: linea.notas ?? null
    })
    return db.prepare('SELECT * FROM deuda_inicial WHERE id = ?').get(linea.id)
  })

  ipcMain.handle('deuda-inicial:delete', (_e, id: number) => {
    getDb().prepare('DELETE FROM deuda_inicial WHERE id = ?').run(id)
  })

  /**
   * Replaces every line for one accionista in a single transaction. What the
   * entry screen saves: editing the set as a whole avoids a half-applied state
   * if one line is rejected.
   */
  ipcMain.handle(
    'deuda-inicial:replace-for-accionista',
    (_e, accionistaId: number, lineas: DeudaInicialInput[]) => {
      const db = getDb()
      db.transaction(() => {
        db.prepare('DELETE FROM deuda_inicial WHERE accionista_id = ?').run(accionistaId)
        const insert = db.prepare(
          `INSERT INTO deuda_inicial (accionista_id, concepto, tipo, monto, notas)
           VALUES (@accionista_id, @concepto, @tipo, @monto, @notas)`
        )
        for (const linea of lineas) {
          insert.run({
            accionista_id: accionistaId,
            concepto: linea.concepto,
            tipo: linea.tipo,
            monto: roundPesos(linea.monto),
            notas: linea.notas ?? null
          })
        }
      })()
      return db
        .prepare(
          `SELECT * FROM deuda_inicial
           WHERE accionista_id = ?
           ORDER BY CASE tipo WHEN 'CUOTA' THEN 0 WHEN 'OTRO' THEN 1 ELSE 2 END, id`
        )
        .all(accionistaId)
    }
  )
}
