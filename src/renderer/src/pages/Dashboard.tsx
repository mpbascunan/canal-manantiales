import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import { formatCLP, formatFecha, mesNombre } from '../lib/formulas'
import { exportAvisosCobro } from '../lib/export'
import type { Temporada, Pago, ResumenContable, ResumenMensual, Accionista } from '../../../shared/types'

// ── SVG Donut Chart ────────────────────────────────────────────────────────

interface DonutSegment {
  value: number
  color: string
  label: string
}

function DonutChart({ segments, total }: { segments: DonutSegment[]; total: number }) {
  const cx = 80; const cy = 80; const r = 56; const stroke = 22
  const circumference = 2 * Math.PI * r

  let cumulativePercent = 0
  const arcs = segments
    .filter(s => s.value > 0)
    .map(seg => {
      const percent = total > 0 ? seg.value / total : 0
      const startPercent = cumulativePercent
      cumulativePercent += percent
      return { ...seg, percent, startPercent }
    })

  return (
    <svg width="160" height="160" viewBox="0 0 160 160">
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
      {arcs.map((seg) => {
        const arcLen = seg.percent * circumference
        const dashOffset = circumference - seg.startPercent * circumference
        return (
          <circle
            key={seg.label}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={`${arcLen} ${circumference - arcLen}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        )
      })}
      {/* Center text */}
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize="10" fill="#6b7280">Total</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill="#111827" fontWeight="bold">
        {total >= 1_000_000
          ? `$${(total / 1_000_000).toFixed(1)}M`
          : total >= 1_000
          ? `$${(total / 1_000).toFixed(0)}K`
          : `$${total}`}
      </text>
    </svg>
  )
}

// ── SVG Bar Chart ──────────────────────────────────────────────────────────

function BarChart({ data }: { data: ResumenMensual[] }) {
  if (data.length === 0) return null
  const maxTotal = Math.max(...data.map(d => d.total), 1)
  const barW = 26
  const gap = 8
  const chartH = 100
  const totalW = data.length * (barW + gap) - gap + 40

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${totalW} ${chartH + 30}`}
      style={{ overflow: 'visible' }}
    >
      {data.map((d, i) => {
        const x = i * (barW + gap) + 20
        const totalH = (d.total / maxTotal) * chartH
        const accH  = (d.monto_acciones / maxTotal) * chartH
        const multH = (d.multas / maxTotal) * chartH
        const otrosH = ((d.cuota_extraordinaria + d.otros_ingresos) / maxTotal) * chartH

        const y = chartH - totalH
        let stackY = chartH

        return (
          <g key={`${d.anio}-${d.mes}`}>
            {/* Stacked bars */}
            {[
              { h: accH,  color: '#3698b0' },
              { h: multH, color: '#ef4444' },
              { h: otrosH,color: '#f59e0b' }
            ].map(({ h, color }) => {
              if (h <= 0) return null
              stackY -= h
              return (
                <rect key={color} x={x} y={stackY} width={barW} height={h} fill={color} rx="1" />
              )
            })}
            {/* Month label */}
            <text x={x + barW / 2} y={chartH + 14} textAnchor="middle" fontSize="9" fill="#6b7280">
              {mesNombre(d.mes).slice(0, 3)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [temporada, setTemporada] = useState<Temporada | null>(null)
  const [recientes, setRecientes] = useState<Pago[]>([])
  const [resumen, setResumen] = useState<ResumenContable | null>(null)
  const [mensual, setMensual] = useState<ResumenMensual[]>([])
  const [printing, setPrinting] = useState<'deudores' | 'todos' | null>(null)
  const navigate = useNavigate()

  const handlePrintAvisos = async (mode: 'deudores' | 'todos') => {
    if (!temporada) return
    setPrinting(mode)
    try {
      let accionistas: Accionista[]
      if (mode === 'deudores') {
        accionistas = await api.deudores.list(temporada.id)
      } else {
        accionistas = await api.accionistas.list()
      }
      if (accionistas.length === 0) {
        alert(mode === 'deudores' ? 'No hay deudores esta temporada.' : 'No hay accionistas registrados.')
        return
      }
      exportAvisosCobro(accionistas, temporada, temporada.valor_accion)
    } finally {
      setPrinting(null)
    }
  }

  useEffect(() => {
    api.temporadas.getActive().then(async t => {
      setTemporada(t)
      if (t) {
        const [pagos, res, mensualData] = await Promise.all([
          api.pagos.recent(8),
          api.pagos.resumenContable(t.id),
          api.pagos.resumenMensual(t.id)
        ])
        setRecientes(pagos)
        setResumen(res)
        setMensual(mensualData)
      }
    })
  }, [])

  if (!temporada) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-500 text-sm">No hay temporada activa.</p>
        <button className="btn-primary" onClick={() => navigate('/temporadas')}>
          Configurar Temporada
        </button>
      </div>
    )
  }

  // Donut segments
  const donutSegments: DonutSegment[] = resumen ? [
    { label: 'Cuota acciones', value: resumen.monto_acciones, color: '#3698b0' },
    { label: 'Multas',         value: resumen.multas,         color: '#ef4444' },
    { label: 'Otros',          value: resumen.cuota_extraordinaria + resumen.otros_ingresos, color: '#f59e0b' }
  ] : []

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inicio</h1>
        <p className="text-sm text-gray-500 mt-1">
          Temporada {temporada.nombre} · Valor acción: {formatCLP(temporada.valor_accion)}
        </p>
      </div>

      {/* ── Charts + summary ── */}
      {resumen && (
        <div className="grid grid-cols-3 gap-4">
          {/* Donut chart */}
          <div className="card p-4 flex flex-col items-center">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recaudado</h2>
            <DonutChart segments={donutSegments} total={resumen.total} />
            <div className="mt-3 space-y-1 w-full">
              {donutSegments.map(s => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    <span className="text-gray-600">{s.label}</span>
                  </div>
                  <span className="font-medium tabular-nums text-gray-800">{formatCLP(s.value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-xs border-t pt-1 mt-1">
                <span className="text-gray-600 font-semibold">Total</span>
                <span className="font-bold tabular-nums text-gray-900">{formatCLP(resumen.total)}</span>
              </div>
            </div>
          </div>

          {/* Monthly bar chart */}
          <div className="card p-4 col-span-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Por mes — temporada {temporada.nombre}</h2>
            {mensual.length > 0 ? (
              <>
                <BarChart data={mensual} />
                <div className="flex gap-4 mt-2 justify-center">
                  {[
                    { color: '#3698b0', label: 'Acciones' },
                    { color: '#ef4444', label: 'Multas' },
                    { color: '#f59e0b', label: 'Otros' }
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1 text-xs text-gray-500">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
                      {label}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">Sin ingresos registrados aún.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Avisos de cobro ── */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-semibold text-sm text-gray-700">Avisos de Cobro</h2>
            <p className="text-xs text-gray-400 mt-0.5">Genera PDFs individuales para imprimir y entregar</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            className="btn-secondary flex-1"
            onClick={() => handlePrintAvisos('deudores')}
            disabled={!!printing}
          >
            {printing === 'deudores' ? 'Generando...' : 'PDF Deudores'}
          </button>
          <button
            className="btn-primary flex-1"
            onClick={() => handlePrintAvisos('todos')}
            disabled={!!printing}
          >
            {printing === 'todos' ? 'Generando...' : 'PDF Todos los accionistas'}
          </button>
        </div>
      </div>

      {/* ── Recent payments ── */}
      <div className="card">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-sm text-gray-700">Últimos pagos</h2>
          <button className="text-xs text-canal-600 hover:underline" onClick={() => navigate('/pagos/mes')}>
            Ver todos →
          </button>
        </div>
        {recientes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">Sin pagos registrados aún.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-left">Accionista</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {recientes.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="px-4 py-2 text-gray-500">{formatFecha(p.fecha)}</td>
                  <td className="px-4 py-2">{p.accionista_nombre}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCLP(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button className="btn-primary" onClick={() => navigate('/pagos/nuevo')}>
        + Registrar nuevo pago
      </button>
    </div>
  )
}
