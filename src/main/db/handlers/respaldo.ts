import { ipcMain, dialog, app } from 'electron'
import { statSync } from 'fs'
import { join } from 'path'
import { getDb, getDbPath } from '../connection'

export interface RespaldoInfo {
  ruta: string
  tamano_bytes: number
  modificado: string
}

export type RespaldoResult =
  | { ok: true; ruta: string }
  | { ok: false; cancelado: true }
  | { ok: false; error: string }

export function registerRespaldoHandlers(): void {
  ipcMain.handle('respaldo:info', (): RespaldoInfo => {
    getDb() // ensures the file exists even if nothing has queried it yet
    const ruta = getDbPath()
    const stat = statSync(ruta)
    return {
      ruta,
      tamano_bytes: stat.size,
      modificado: stat.mtime.toISOString()
    }
  })

  ipcMain.handle('respaldo:exportar', async (): Promise<RespaldoResult> => {
    const stamp = new Date().toISOString().slice(0, 10)
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Guardar respaldo',
      defaultPath: join(app.getPath('documents'), `canal-respaldo-${stamp}.db`),
      filters: [{ name: 'Respaldo Canal', extensions: ['db'] }]
    })

    if (canceled || !filePath) return { ok: false, cancelado: true }

    try {
      // SQLite's online backup API — writes a consistent copy including any
      // pending WAL contents, unlike a plain file copy.
      await getDb().backup(filePath)
      return { ok: true, ruta: filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
