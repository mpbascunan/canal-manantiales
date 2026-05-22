import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerTemporadaHandlers } from './db/handlers/temporadas'
import { registerAccionistaHandlers } from './db/handlers/accionistas'
import { registerPagoHandlers } from './db/handlers/pagos'
import { registerDeudorHandlers } from './db/handlers/deudores'
import { registerImportHandlers } from './db/handlers/import'
import { registerPropiedadHandlers } from './db/handlers/propiedades'
import { registerAbonoHandlers } from './db/handlers/abonos'
import { registerCargoHandlers } from './db/handlers/cargos'

function createWindow(): BrowserWindow {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = is.dev
    ? join(__dirname, '../../resources', iconFile)
    : join(process.resourcesPath, 'resources', iconFile)

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.canal.contabilidad')
  app.on('browser-window-created', (_, win) => optimizer.watchWindowShortcuts(win))

  registerTemporadaHandlers()
  registerAccionistaHandlers()
  registerPagoHandlers()
  registerDeudorHandlers()
  registerImportHandlers()
  registerPropiedadHandlers()
  registerAbonoHandlers()
  registerCargoHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
