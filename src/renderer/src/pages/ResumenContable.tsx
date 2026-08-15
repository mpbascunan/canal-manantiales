import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import { formatCLP, mesNombre } from '../lib/formulas'
import { exportResumenContable, exportResumenContablePdf } from '../lib/export'
import type { Temporada, ResumenContable as IResumen, ResumenMensual, CargoResumen } from '../../../shared/types'

export default function ResumenContable() {
  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [selectedId, setSelectedId] = useState<number>(0)
  const [resumen, setResumen] = useState<IResumen | null>(null)
  const [mensual, setMensual] = useState<ResumenMensual[]>([])
  const [cargoResumen, setCargoResumen] = useState<CargoResumen[]>([])

  useEffect(() => {
    api.temporadas.list().then(ts => {
      setTemporadas(ts)
      const active = ts.find((t: Temporada) => t.activa)
      if (active) setSelectedId(active.id)
    })
  }, [])

  useEffect(() => {
    if (!selectedId) return
    Promise.all([
      api.pagos.resumenContable(selectedId),
      api.pagos.resumenMensual(selectedId),
      api.cargos.resumenByTemporada(selectedId)
    ]).then(([r, m, cr]) => {
      setResumen(r)
      setMensual(m)
      setCargoResumen(cr)
    })
  }, [selectedId])

  const temporada = temporadas.find(t => t.id === selectedId)

  // Cargos named "Multa..." count as multa income; the rest get their own row
  const multaCargos = cargoResumen.filter(c => /multa/i.test(c.nombre))
  const otrosCargos = cargoResumen.filter(c => !/multa/i.test(c.nombre))
  const ingresoMultas = (resumen?.multas ?? 0)
    + multaCargos.reduce((s, c) => s + c.total_cobrado, 0)

  // Grand total = pagos/abonos total + all cargo cobrado
  const totalConCargos = (resumen?.total ?? 0)
    + cargoResumen.reduce((s, c) => s + c.total_cobrado, 0)

  const handleExcelExport = () => {
    if (!resumen || !temporada) return
    exportResumenContable(resumen, mensual, temporada, cargoResumen)
  }

  const handlePdfExport = () => {
    if (!resumen || !temporada) return
    exportResumenContablePdf(resumen, mensual, temporada, cargoResumen)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Resumen Contable</h1>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={handleExcelExport} disabled={!resumen}>Exportar Excel</button>
          <button className="btn-secondary btn-sm" onClick={handlePdfExport} disabled={!resumen}>Exportar PDF</button>
        </div>
      </div>

      {/* Temporada selector */}
      <div className="flex items-center gap-3">
        <label className="label mb-0 whitespace-nowrap">Temporada:</label>
        <select className="input max-w-[200px]" value={selectedId} onChange={e => setSelectedId(Number(e.target.value))}>
          <option value={0}>— Seleccionar —</option>
          {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </div>

      {resumen && temporada && (
        <>
          {/* Main income summary */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-slate-800 text-white text-sm font-semibold">
              RESUMEN INGRESOS TEMPORADA {temporada.nombre}
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="table-row">
                  <td className="px-4 py-3">Ingreso por Cuota Acciones</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCLP(resumen.monto_acciones)}</td>
                </tr>
                <tr className="table-row">
                  <td className="px-4 py-3">Ingresos por Multas</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCLP(ingresoMultas)}</td>
                </tr>
                {otrosCargos.map(c => (
                  <tr key={c.id} className="table-row">
                    <td className="px-4 py-3">
                      {c.nombre}
                      <span className="ml-2 text-xs text-gray-400 font-normal">
                        (cargo · emitido: {formatCLP(c.total_emitido)})
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCLP(c.total_cobrado)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-800 text-white">
                  <td className="px-4 py-3 font-bold">TOTAL RECAUDADO</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-lg">{formatCLP(totalConCargos)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Cargo detail table (if any) */}
          {cargoResumen.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-sm text-gray-700">Cargos emitidos / recaudados</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-2 text-left">Cargo</th>
                    <th className="px-4 py-2 text-right">Emitido</th>
                    <th className="px-4 py-2 text-right">Recaudado</th>
                    <th className="px-4 py-2 text-right">Pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  {cargoResumen.map(c => (
                    <tr key={c.id} className="table-row">
                      <td className="px-4 py-2 font-medium">{c.nombre}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatCLP(c.total_emitido)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-green-700 font-medium">{formatCLP(c.total_cobrado)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {c.total_emitido - c.total_cobrado > 0
                          ? <span className="text-amber-600">{formatCLP(c.total_emitido - c.total_cobrado)}</span>
                          : <span className="text-gray-400">—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                    <td className="px-4 py-2">TOTALES</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(cargoResumen.reduce((s, c) => s + c.total_emitido, 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-700">{formatCLP(cargoResumen.reduce((s, c) => s + c.total_cobrado, 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600">{formatCLP(cargoResumen.reduce((s, c) => s + (c.total_emitido - c.total_cobrado), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Monthly breakdown */}
          {mensual.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-sm text-gray-700">Cancelaciones Mensuales</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-2 text-left">Mes</th>
                    <th className="px-4 py-2 text-right">Monto Acc.</th>
                    <th className="px-4 py-2 text-right">Multas</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mensual.map(m => (
                    <tr key={`${m.anio}-${m.mes}`} className="table-row">
                      <td className="px-4 py-2 font-medium">{mesNombre(m.mes)} {m.anio}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCLP(m.monto_acciones)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.multas > 0 ? formatCLP(m.multas) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatCLP(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                    <td className="px-4 py-2">TOTALES</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(resumen.monto_acciones)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(resumen.multas)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(resumen.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
