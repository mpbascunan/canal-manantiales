import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/ipc'
import { formatCLP, formatFecha, mesNombre } from '../lib/formulas'
import { exportPagosMes, exportPagosMesPdf } from '../lib/export'
import type { Pago, Abono } from '../../../shared/types'

// Unified row for display — pagos and abonos merged
interface FilaMes {
  _key: string
  kind: 'pago' | 'abono'
  fecha: string
  numero_ingreso: number
  accionista_nombre: string
  temporadas_pagadas: number | null
  monto_acciones: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total: number
}

function pagoToFila(p: Pago): FilaMes {
  return {
    _key: `p-${p.id}`,
    kind: 'pago',
    fecha: p.fecha,
    numero_ingreso: p.numero_ingreso,
    accionista_nombre: p.accionista_nombre ?? '',
    temporadas_pagadas: p.temporadas_pagadas,
    monto_acciones: p.monto_acciones,
    multas: p.multas,
    cuota_extraordinaria: p.cuota_extraordinaria,
    otros_ingresos: p.otros_ingresos,
    total: p.total
  }
}

function abonoToFila(a: Abono): FilaMes {
  return {
    _key: `a-${a.id}`,
    kind: 'abono',
    fecha: a.fecha,
    numero_ingreso: a.numero_ingreso,
    accionista_nombre: (a as any).accionista_nombre ?? '',
    temporadas_pagadas: null,
    monto_acciones: a.monto,
    multas: a.multas,
    cuota_extraordinaria: a.cuota_extraordinaria,
    otros_ingresos: a.otros_ingresos,
    total: a.total
  }
}

export default function PagosPorMes() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [abonos, setAbonos] = useState<Abono[]>([])

  const load = () => {
    Promise.all([
      api.pagos.listByMonth(year, month),
      api.abonos.listByMonth(year, month)
    ]).then(([ps, abs]) => {
      setPagos(ps)
      setAbonos(abs)
    })
  }

  useEffect(() => { load() }, [year, month])

  const filas = useMemo<FilaMes[]>(() => {
    const merged = [
      ...pagos.map(pagoToFila),
      ...abonos.map(abonoToFila)
    ]
    // Sort by date then by numero_ingreso
    merged.sort((a, b) =>
      a.fecha.localeCompare(b.fecha) || a.numero_ingreso - b.numero_ingreso
    )
    return merged
  }, [pagos, abonos])

  const totals = useMemo(() => ({
    monto_acciones:     filas.reduce((s, r) => s + r.monto_acciones, 0),
    multas:             filas.reduce((s, r) => s + r.multas, 0),
    cuota_extraordinaria: filas.reduce((s, r) => s + r.cuota_extraordinaria, 0),
    otros_ingresos:     filas.reduce((s, r) => s + r.otros_ingresos, 0),
    total:              filas.reduce((s, r) => s + r.total, 0)
  }), [filas])

  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Pagos por Mes</h1>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => exportPagosMes(pagos, year, month)}>
            Exportar Excel
          </button>
          <button className="btn-secondary btn-sm" onClick={() => exportPagosMesPdf(pagos, year, month)}>
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <select className="input max-w-[150px]" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {months.map(m => <option key={m} value={m}>{mesNombre(m)}</option>)}
        </select>
        <input
          type="number"
          className="input w-24"
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          min={2000} max={2100}
        />
        <span className="text-sm text-gray-500">
          {pagos.length} pago{pagos.length !== 1 ? 's' : ''}
          {abonos.length > 0 && <>, {abonos.length} abono{abonos.length !== 1 ? 's' : ''}</>}
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="table-header">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">N° Ingreso</th>
              <th className="px-3 py-2 text-left">Accionista</th>
              <th className="px-3 py-2 text-right">N° Temp.</th>
              <th className="px-3 py-2 text-right">Monto Acciones</th>
              <th className="px-3 py-2 text-right">Multas</th>
              <th className="px-3 py-2 text-right">Cuota Extra.</th>
              <th className="px-3 py-2 text-right">Otros</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(r => (
              <tr key={r._key} className={`table-row ${r.kind === 'abono' ? 'bg-amber-50/40' : ''}`}>
                <td className="px-3 py-2 text-gray-500">{formatFecha(r.fecha)}</td>
                <td className="px-3 py-2">{r.numero_ingreso}</td>
                <td className="px-3 py-2">
                  <span className="font-medium">{r.accionista_nombre}</span>
                  {r.kind === 'abono' && (
                    <span className="ml-2 inline-block px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
                      Abono
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-400">
                  {r.temporadas_pagadas ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(r.monto_acciones)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.multas > 0 ? formatCLP(r.multas) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.cuota_extraordinaria > 0 ? formatCLP(r.cuota_extraordinaria) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.otros_ingresos > 0 ? formatCLP(r.otros_ingresos) : '—'}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCLP(r.total)}</td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Sin movimientos en este mes</td></tr>
            )}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-bold text-gray-800 border-t-2 border-gray-200">
                <td className="px-3 py-2" colSpan={4}>TOTALES</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.monto_acciones)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.multas)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.cuota_extraordinaria)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.otros_ingresos)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
