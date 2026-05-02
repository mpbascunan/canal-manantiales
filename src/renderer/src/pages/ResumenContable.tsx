import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import { formatCLP, mesNombre } from '../lib/formulas'
import { exportResumenContable, exportResumenContablePdf } from '../lib/export'
import type { Temporada, ResumenContable as IResumen, ResumenMensual } from '../../../shared/types'

export default function ResumenContable() {
  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [selectedId, setSelectedId] = useState<number>(0)
  const [resumen, setResumen] = useState<IResumen | null>(null)
  const [mensual, setMensual] = useState<ResumenMensual[]>([])

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
      api.pagos.resumenMensual(selectedId)
    ]).then(([r, m]) => {
      setResumen(r)
      setMensual(m)
    })
  }, [selectedId])

  const temporada = temporadas.find(t => t.id === selectedId)

  const handleExcelExport = () => {
    if (!resumen || !temporada) return
    exportResumenContable(resumen, mensual, temporada)
  }

  const handlePdfExport = () => {
    if (!resumen || !temporada) return
    exportResumenContablePdf(resumen, mensual, temporada)
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
          <div className="card overflow-hidden">
            <div className="px-4 py-3 bg-slate-800 text-white text-sm font-semibold">
              RESUMEN INGRESOS TEMPORADA {temporada.nombre}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['Ingreso por Cuota Acciones', resumen.monto_acciones],
                  ['Ingresos por Multas', resumen.multas],
                  ['Cuota Extraordinaria', resumen.cuota_extraordinaria],
                  ['Otros Ingresos', resumen.otros_ingresos]
                ].map(([label, value]) => (
                  <tr key={label as string} className="table-row">
                    <td className="px-4 py-3">{label}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCLP(value as number)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-800 text-white">
                  <td className="px-4 py-3 font-bold">TOTAL RECAUDADO</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-lg">{formatCLP(resumen.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

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
                    <th className="px-4 py-2 text-right">Cuota Extra.</th>
                    <th className="px-4 py-2 text-right">Otros</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {mensual.map(m => (
                    <tr key={`${m.anio}-${m.mes}`} className="table-row">
                      <td className="px-4 py-2 font-medium">{mesNombre(m.mes)} {m.anio}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCLP(m.monto_acciones)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.multas > 0 ? formatCLP(m.multas) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.cuota_extraordinaria > 0 ? formatCLP(m.cuota_extraordinaria) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.otros_ingresos > 0 ? formatCLP(m.otros_ingresos) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatCLP(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                    <td className="px-4 py-2">TOTALES</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(resumen.monto_acciones)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(resumen.multas)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(resumen.cuota_extraordinaria)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCLP(resumen.otros_ingresos)}</td>
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
