import { ipcMain } from 'electron'
import { getDb } from '../connection'

export function registerPropiedadHandlers(): void {
  ipcMain.handle('propiedades:list', (_e, accionistaId: number) => {
    return getDb()
      .prepare('SELECT * FROM propiedades WHERE accionista_id = ? ORDER BY id')
      .all(accionistaId)
  })
}
