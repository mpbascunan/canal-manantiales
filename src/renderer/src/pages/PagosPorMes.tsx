import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/ipc'
import { formatCLP, formatFecha, mesNombre } from '../lib/formulas'
import { exportPagosMes, exportPagosMesPdf, exportPagosTemporada } from '../lib/export'
import type { Pago, Abono, Temporada } from '../../../shared/types'

/** What the table is showing: one month, or a whole temporada (README 37). */
type Ambito = 'mes' | 'temporada'

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
    total: a.total
  }
}

export default function PagosPorMes() {
  const now = new Date()
  const [ambito, setAmbito] = useState<Ambito>('mes')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [temporadaId, setTemporadaId] = useState(0)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [abonos, setAbonos] = useState<Abono[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.temporadas.list().then((ts: Temporada[]) => {
      setTemporadas(ts)
      const activa = ts.find(t => t.activa) ?? ts[0]
      if (activa) setTemporadaId(activa.id)
    })
  }, [])

  const load = () => {
    if (ambito === 'temporada') {
      if (!temporadaId) return
      Promise.all([
        api.pagos.listByTemporada(temporadaId),
        api.abonos.listByTemporada(temporadaId)
      ]).then(([ps, abs]) => { setPagos(ps); setAbonos(abs) })
      return
    }
    Promise.all([
      api.pagos.listByMonth(year, month),
      api.abonos.listByMonth(year, month)
    ]).then(([ps, abs]) => { setPagos(ps); setAbonos(abs) })
  }

  useEffect(() => { load() }, [ambito, year, month, temporadaId])

  const temporada = temporadas.find(t => t.id === temporadaId)

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

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return filas
    return filas.filter(r =>
      r.accionista_nombre.toLowerCase().includes(q) ||
      String(r.numero_ingreso).includes(q)
    )
  }, [filas, search])

  // Totals follow what the table shows, so the TOTALES row always adds up the
  // visible movimientos rather than the whole period.
  const totals = useMemo(() => ({
    monto_acciones: filtradas.reduce((s, r) => s + r.monto_acciones, 0),
    multas:         filtradas.reduce((s, r) => s + r.multas, 0),
    total:          filtradas.reduce((s, r) => s + r.total, 0)
  }), [filtradas])

  const countPagos = filtradas.filter(r => r.kind === 'pago').length
  const countAbonos = filtradas.filter(r => r.kind === 'abono').length

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const porTemporada = ambito === 'temporada'

  const handleExcel = () => {
    if (porTemporada) {
      if (temporada) exportPagosTemporada(pagos, abonos, temporada)
    } else {
      exportPagosMes(pagos, year, month)
    }
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {porTemporada ? 'Pagos por Temporada' : 'Pagos por Mes'}
        </h1>
        <div className="flex gap-2">
          <button
            className="btn-secondary btn-sm"
            onClick={handleExcel}
            disabled={porTemporada && !temporada}
          >
            Exportar Excel
          </button>
          {/* The PDF is the monthly ingresos sheet the administration files;
              a whole temporada is a spreadsheet, not a sheet of paper. */}
          {!porTemporada && (
            <button className="btn-secondary btn-sm" onClick={() => exportPagosMesPdf(pagos, year, month)}>
              Exportar PDF
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="flex rounded-md border border-gray-200 overflow-hidden text-sm">
          {(['mes', 'temporada'] as Ambito[]).map(a => (
            <button
              key={a}
              className={`px-3 py-1.5 transition-colors ${
                ambito === a ? 'bg-canal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => setAmbito(a)}
            >
              {a === 'mes' ? 'Por mes' : 'Por temporada'}
            </button>
          ))}
        </div>

        {porTemporada ? (
          <select
            className="input max-w-[220px]"
            value={temporadaId}
            onChange={e => setTemporadaId(Number(e.target.value))}
          >
            {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        ) : (
          <>
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
          </>
        )}

        <input
          className="input max-w-xs"
          placeholder="Buscar por accionista o N° ingreso..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <span className="text-sm text-gray-500">
          {countPagos} pago{countPagos !== 1 ? 's' : ''}
          {countAbonos > 0 && <>, {countAbonos} abono{countAbonos !== 1 ? 's' : ''}</>}
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
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(r => (
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
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatCLP(r.total)}</td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                {search.trim()
                  ? 'Sin movimientos que coincidan con la búsqueda'
                  : porTemporada ? 'Sin movimientos en esta temporada' : 'Sin movimientos en este mes'}
              </td></tr>
            )}
          </tbody>
          {filtradas.length > 0 && (
            <tfoot>
              <tr className="bg-gray-50 font-bold text-gray-800 border-t-2 border-gray-200">
                <td className="px-3 py-2" colSpan={4}>TOTALES</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.monto_acciones)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.multas)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCLP(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
