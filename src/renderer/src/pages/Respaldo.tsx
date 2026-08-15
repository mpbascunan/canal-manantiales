import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'

interface RespaldoInfo {
  ruta: string
  tamano_bytes: number
  modificado: string
}

type Result =
  | { ok: true; ruta: string }
  | { ok: false; cancelado: true }
  | { ok: false; error: string }

function formatTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function Respaldo() {
  const [info, setInfo] = useState<RespaldoInfo | null>(null)
  const [exportando, setExportando] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const cargarInfo = () => {
    api.respaldo.info().then(setInfo).catch(() => setInfo(null))
  }

  useEffect(cargarInfo, [])

  const handleExportar = async () => {
    setExportando(true)
    setResult(null)
    try {
      const r: Result = await api.respaldo.exportar()
      setResult(r)
      if (r.ok) cargarInfo()
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Respaldo</h1>
        <p className="text-sm text-gray-500 mt-1">
          Guarda una copia de seguridad de toda la información del sistema.
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Exportar respaldo</h2>
        <p className="text-sm text-gray-600">
          Se creará un archivo con <strong>todos los datos</strong>: accionistas, propiedades,
          pagos, abonos, cargos y temporadas. Guárdalo en un pendrive o en la nube.
        </p>
        <p className="text-xs text-gray-400">
          Se recomienda exportar un respaldo antes de instalar una nueva versión del programa
          y al cerrar cada temporada.
        </p>
        <button className="btn-primary" onClick={handleExportar} disabled={exportando}>
          {exportando ? 'Guardando...' : 'Exportar respaldo'}
        </button>

        {result?.ok && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3">
            <div className="text-sm font-medium text-green-800">Respaldo guardado</div>
            <div className="text-xs text-green-700 mt-1 break-all">{result.ruta}</div>
          </div>
        )}

        {result && !result.ok && 'error' in result && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3">
            <div className="text-sm font-medium text-red-800">No se pudo guardar el respaldo</div>
            <div className="text-xs text-red-700 mt-1 break-all">{result.error}</div>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Base de datos actual</h2>
        {info && (
          <dl className="text-sm space-y-2">
            <div>
              <dt className="text-gray-500 text-xs">Ubicación</dt>
              <dd className="text-gray-900 break-all font-mono text-xs mt-0.5">{info.ruta}</dd>
            </div>
            <div className="flex gap-8">
              <div>
                <dt className="text-gray-500 text-xs">Tamaño</dt>
                <dd className="text-gray-900 mt-0.5">{formatTamano(info.tamano_bytes)}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs">Última modificación</dt>
                <dd className="text-gray-900 mt-0.5">{formatFecha(info.modificado)}</dd>
              </div>
            </div>
          </dl>
        )}
        <p className="text-xs text-gray-400">
          Esta carpeta no se modifica al instalar una nueva versión: los datos se mantienen.
          Además, el programa guarda una copia automática en esa misma carpeta antes de
          actualizar la estructura de la base de datos.
        </p>
      </div>
    </div>
  )
}
