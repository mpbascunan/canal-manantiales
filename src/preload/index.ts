import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Temporadas
  temporadas: {
    list: () => ipcRenderer.invoke('temporadas:list'),
    getActive: () => ipcRenderer.invoke('temporadas:get-active'),
    create: (t: any) => ipcRenderer.invoke('temporadas:create', t),
    update: (t: any) => ipcRenderer.invoke('temporadas:update', t),
    setActive: (id: number) => ipcRenderer.invoke('temporadas:set-active', id)
  },
  // Accionistas
  accionistas: {
    list: (includeInactive?: boolean) => ipcRenderer.invoke('accionistas:list', includeInactive),
    get: (id: number) => ipcRenderer.invoke('accionistas:get', id),
    create: (a: any) => ipcRenderer.invoke('accionistas:create', a),
    update: (a: any) => ipcRenderer.invoke('accionistas:update', a),
    withPagoStatus: (temporadaId: number) =>
      ipcRenderer.invoke('accionistas:with-pago-status', temporadaId)
  },
  // Propiedades
  propiedades: {
    list: (accionistaId: number) => ipcRenderer.invoke('propiedades:list', accionistaId)
  },
  // Pagos
  pagos: {
    listByMonth: (year: number, month: number) =>
      ipcRenderer.invoke('pagos:list-by-month', year, month),
    listByAccionista: (id: number) => ipcRenderer.invoke('pagos:list-by-accionista', id),
    listByTemporada: (id: number) => ipcRenderer.invoke('pagos:list-by-temporada', id),
    recent: (limit?: number) => ipcRenderer.invoke('pagos:recent', limit),
    create: (p: any) => ipcRenderer.invoke('pagos:create', p),
    delete: (id: number) => ipcRenderer.invoke('pagos:delete', id),
    resumenContable: (temporadaId: number) =>
      ipcRenderer.invoke('pagos:resumen-contable', temporadaId),
    resumenMensual: (temporadaId: number) =>
      ipcRenderer.invoke('pagos:resumen-mensual', temporadaId),
    nextNumeroIngreso: () => ipcRenderer.invoke('pagos:next-numero-ingreso')
  },
  // Abonos
  abonos: {
    create: (a: any) => ipcRenderer.invoke('abonos:create', a),
    delete: (id: number) => ipcRenderer.invoke('abonos:delete', id),
    listByAccionista: (id: number) => ipcRenderer.invoke('abonos:list-by-accionista', id),
    listByMonth: (year: number, month: number) => ipcRenderer.invoke('abonos:list-by-month', year, month)
  },
  // Deudores
  deudores: {
    list: (temporadaId: number) => ipcRenderer.invoke('deudores:list', temporadaId),
    getConfig: (accionistaId: number, temporadaId: number) =>
      ipcRenderer.invoke('deudores:get-config', accionistaId, temporadaId),
    upsertConfig: (cfg: any) => ipcRenderer.invoke('deudores:upsert-config', cfg)
  },
  // Import
  import: {
    selectFile: () => ipcRenderer.invoke('import:select-file'),
    readFile: (filePath: string) => ipcRenderer.invoke('import:read-file', filePath),
    previewAccionistas: (rows: any[]) => ipcRenderer.invoke('import:preview-accionistas', rows),
    previewPagos: (rows: any[], temporadaId: number) => ipcRenderer.invoke('import:preview-pagos', rows, temporadaId),
    accionistas: (rows: any[]) => ipcRenderer.invoke('import:accionistas', rows),
    pagos: (rows: any[], temporadaId: number) =>
      ipcRenderer.invoke('import:pagos', rows, temporadaId)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore
  window.api = api
}

export type ElectronAPI = typeof api
