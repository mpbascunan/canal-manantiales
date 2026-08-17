import { ipcMain } from 'electron'
import { getDb } from '../connection'
import { roundPesos } from '../../../shared/deuda'
import type { Temporada } from '../../../shared/types'

/**
 * Whole pesos for both rates (D8). They are per-unit prices, but every amount
 * derived from them is rounded, so an unrounded rate makes the stored cuota
 * impossible to reproduce from what the temporada screen shows.
 */
function conMontosRedondeados<T extends Pick<Temporada, 'valor_accion' | 'monto_multa_por_accion'>>(t: T) {
  return {
    ...t,
    valor_accion: roundPesos(t.valor_accion),
    monto_multa_por_accion: roundPesos(t.monto_multa_por_accion ?? 0)
  }
}

export function registerTemporadaHandlers(): void {
  ipcMain.handle('temporadas:list', () => {
    return getDb().prepare('SELECT * FROM temporadas ORDER BY nombre DESC').all()
  })

  ipcMain.handle('temporadas:get-active', () => {
    return getDb().prepare('SELECT * FROM temporadas WHERE activa = 1 LIMIT 1').get() ?? null
  })

  ipcMain.handle('temporadas:create', (_e, t: Omit<Temporada, 'id'>) => {
    const db = getDb()
    const result = db
      .prepare(
        `INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, valor_accion, activa, nota_aviso, fecha_multa, monto_multa_por_accion)
         VALUES (@nombre, @fecha_inicio, @fecha_fin, @valor_accion, @activa, @nota_aviso, @fecha_multa, @monto_multa_por_accion)`
      )
      .run({ ...conMontosRedondeados(t), activa: t.activa ? 1 : 0, fecha_multa: t.fecha_multa ?? null })
    return db.prepare('SELECT * FROM temporadas WHERE id = ?').get(result.lastInsertRowid)
  })

  ipcMain.handle('temporadas:update', (_e, t: Temporada) => {
    getDb()
      .prepare(
        `UPDATE temporadas SET nombre=@nombre, fecha_inicio=@fecha_inicio, fecha_fin=@fecha_fin,
         valor_accion=@valor_accion, nota_aviso=@nota_aviso, fecha_multa=@fecha_multa,
         monto_multa_por_accion=@monto_multa_por_accion WHERE id=@id`
      )
      .run({ ...conMontosRedondeados(t), fecha_multa: t.fecha_multa ?? null })
    return getDb().prepare('SELECT * FROM temporadas WHERE id = ?').get(t.id)
  })

  ipcMain.handle('temporadas:set-active', (_e, id: number) => {
    const db = getDb()
    db.transaction(() => {
      db.prepare('UPDATE temporadas SET activa = 0').run()
      db.prepare('UPDATE temporadas SET activa = 1 WHERE id = ?').run(id)
    })()
  })
}
