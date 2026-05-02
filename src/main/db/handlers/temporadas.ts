import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { Temporada } from '../../../shared/types'

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
        `INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, valor_accion, activa, nota_aviso)
         VALUES (@nombre, @fecha_inicio, @fecha_fin, @valor_accion, @activa, @nota_aviso)`
      )
      .run({ ...t, activa: t.activa ? 1 : 0 })
    return db.prepare('SELECT * FROM temporadas WHERE id = ?').get(result.lastInsertRowid)
  })

  ipcMain.handle('temporadas:update', (_e, t: Temporada) => {
    getDb()
      .prepare(
        `UPDATE temporadas SET nombre=@nombre, fecha_inicio=@fecha_inicio, fecha_fin=@fecha_fin,
         valor_accion=@valor_accion, nota_aviso=@nota_aviso WHERE id=@id`
      )
      .run(t)
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
