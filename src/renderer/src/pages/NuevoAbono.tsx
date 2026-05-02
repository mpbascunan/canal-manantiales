import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/ipc'
import { calcularMontoAcciones, calcularMultas, calcularTotal, formatCLP, toISODate } from '../lib/formulas'
import { exportComprobanteAbono } from '../lib/export'
import type { Accionista, Temporada } from '../../../shared/types'

export default function NuevoAbono() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preselectedId = params.get('accionista') ? Number(params.get('accionista')) : null

  const [accionista, setAccionista] = useState<Accionista | null>(null)
  const [temporada, setTemporada] = useState<Temporada | null>(null)
  const [deudorConfig, setDeudorConfig] = useState<{ temporadas_adeudadas: number }>({ temporadas_adeudadas: 1 })
  const [nextNum, setNextNum] = useState(0)
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [printComprobante, setPrintComprobante] = useState(false)

  const [form, setForm] = useState({
    fecha: toISODate(new Date()),
    numero_ingreso: 0,
    temporadas_cubiertas: 1,
    monto: 0,
    multas: 0,
    cuota_extraordinaria: 0,
    otros_ingresos: 0,
    notas: ''
  })

  useEffect(() => {
    const loadData = async () => {
      const [t, num] = await Promise.all([
        api.temporadas.getActive(),
        api.pagos.nextNumeroIngreso()
      ])
      setTemporada(t)
      setNextNum(num)
      setForm(f => ({ ...f, numero_ingreso: num }))

      if (preselectedId && t) {
        const [a, cfg] = await Promise.all([
          api.accionistas.get(preselectedId),
          api.deudores.getConfig(preselectedId, t.id)
        ])
        setAccionista(a)
        setDeudorConfig(cfg)
        // Auto-fill monto based on temporadas_cubiertas=1
        if (a && t) {
          const monto = calcularMontoAcciones(t.valor_accion, a.acciones, a.hectareas, 1)
          setForm(f => ({ ...f, monto }))
        }
      }
    }
    loadData()
  }, [])

  const recalcMonto = useCallback(() => {
    if (!temporada || !accionista) return
    const monto = calcularMontoAcciones(
      temporada.valor_accion, accionista.acciones, accionista.hectareas, form.temporadas_cubiertas
    )
    setForm(f => ({ ...f, monto }))
  }, [temporada, accionista, form.temporadas_cubiertas])

  const autoMultas = () => {
    if (!accionista) return
    const m = calcularMultas(accionista.acciones, accionista.hectareas, form.temporadas_cubiertas)
    setForm(f => ({ ...f, multas: m }))
  }

  const total = calcularTotal(form.monto, form.multas, form.cuota_extraordinaria, form.otros_ingresos)
  const remaining = deudorConfig.temporadas_adeudadas - form.temporadas_cubiertas

  const handleSave = async () => {
    if (!accionista || !temporada) return
    await api.abonos.create({
      numero_ingreso: form.numero_ingreso,
      accionista_id: accionista.id,
      temporada_id: temporada.id,
      fecha: form.fecha,
      temporadas_cubiertas: form.temporadas_cubiertas,
      monto: form.monto,
      multas: form.multas,
      cuota_extraordinaria: form.cuota_extraordinaria,
      otros_ingresos: form.otros_ingresos,
      total,
      notas: form.notas || null,
      temporadas_restantes: remaining
    })

    if (printComprobante) {
      exportComprobanteAbono({
        accionista,
        temporada,
        fecha: form.fecha,
        numero_ingreso: form.numero_ingreso,
        temporadas_cubiertas: form.temporadas_cubiertas,
        temporadas_restantes: remaining,
        monto: form.monto,
        multas: form.multas,
        cuota_extraordinaria: form.cuota_extraordinaria,
        otros_ingresos: form.otros_ingresos,
        total
      })
    }

    setSaved(true)
    setConfirming(false)
    setTimeout(() => navigate('/deudores'), 1200)
  }

  if (!preselectedId || (!accionista && !temporada)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-gray-500 text-sm">Accede a este formulario desde la página de Deudores.</p>
        <button className="btn-secondary" onClick={() => navigate('/deudores')}>← Volver a Deudores</button>
      </div>
    )
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="text-green-600 text-4xl">✓</div>
        <p className="text-gray-700 font-medium">Abono registrado correctamente</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <button className="text-sm text-gray-400 hover:text-gray-600 mb-2" onClick={() => navigate('/deudores')}>
          ← Deudores
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Registrar Abono</h1>
        <p className="text-sm text-gray-500 mt-1">Pago parcial que reduce la deuda sin saldar la temporada completa</p>
      </div>

      {/* Current debt info */}
      {accionista && temporada && (
        <div className="card p-4 bg-amber-50 border border-amber-200 space-y-2">
          <div className="font-semibold text-amber-900">{accionista.nombre}</div>
          {accionista.numeros && (
            <div className="text-xs text-amber-700">N° {accionista.numeros}</div>
          )}
          <div className="flex gap-6 text-sm text-amber-800">
            {accionista.acciones > 0 && <span>{accionista.acciones} acc.</span>}
            {accionista.hectareas > 0 && <span>{accionista.hectareas} ha</span>}
            <span className="font-medium">{deudorConfig.temporadas_adeudadas} temporada{deudorConfig.temporadas_adeudadas !== 1 ? 's' : ''} adeudada{deudorConfig.temporadas_adeudadas !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* Fecha */}
          <div>
            <label className="label">Fecha</label>
            <input type="date" className="input" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
          </div>
          {/* N° Ingreso */}
          <div>
            <label className="label">N° Ingreso</label>
            <input type="number" className="input" value={form.numero_ingreso}
              onChange={e => setForm(f => ({ ...f, numero_ingreso: Number(e.target.value) }))} />
          </div>
          {/* Temporadas cubiertas */}
          <div>
            <label className="label">Temporadas a cubrir con este abono</label>
            <input type="number" min={1} max={deudorConfig.temporadas_adeudadas} className="input"
              value={form.temporadas_cubiertas}
              onChange={e => setForm(f => ({ ...f, temporadas_cubiertas: Number(e.target.value) }))}
              onBlur={recalcMonto}
            />
            <p className="text-xs text-gray-400 mt-1">
              Máximo: {deudorConfig.temporadas_adeudadas} adeudadas
            </p>
          </div>
          {/* Remaining indicator */}
          <div className="flex items-end pb-1">
            <div className={`card p-3 w-full text-center ${remaining > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
              <div className="text-xs text-gray-500">Temporadas restantes</div>
              <div className={`text-xl font-bold ${remaining > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                {Math.max(0, remaining)}
              </div>
            </div>
          </div>
        </div>

        {/* Monto */}
        <div className="bg-canal-50 rounded-lg p-3 space-y-1">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Monto por acciones</label>
            <button className="text-xs text-canal-600 hover:underline" onClick={recalcMonto}>Recalcular</button>
          </div>
          <input type="number" className="input bg-white font-semibold text-canal-900"
            value={form.monto}
            onChange={e => setForm(f => ({ ...f, monto: Number(e.target.value) }))} />
          {temporada && accionista && (
            <p className="text-xs text-canal-500">
              ({formatCLP(temporada.valor_accion)} × ({accionista.acciones} acc + {accionista.hectareas} ha) × {form.temporadas_cubiertas} temp.)
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Multas */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Multas</label>
              <button className="text-xs text-orange-600 hover:underline" onClick={autoMultas}>Auto-calcular</button>
            </div>
            <input type="number" className="input" value={form.multas}
              onChange={e => setForm(f => ({ ...f, multas: Number(e.target.value) }))} />
          </div>
          {/* Cuota Extraordinaria */}
          <div>
            <label className="label">Cuota Extraordinaria</label>
            <input type="number" className="input" value={form.cuota_extraordinaria}
              onChange={e => setForm(f => ({ ...f, cuota_extraordinaria: Number(e.target.value) }))} />
          </div>
          {/* Otros Ingresos */}
          <div>
            <label className="label">Otros Ingresos</label>
            <input type="number" className="input" value={form.otros_ingresos}
              onChange={e => setForm(f => ({ ...f, otros_ingresos: Number(e.target.value) }))} />
          </div>
        </div>

        {/* Notas */}
        <div>
          <label className="label">Notas (opcional)</label>
          <input className="input" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
        </div>

        {/* Total */}
        <div className="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
          <span className="text-gray-300 font-medium">TOTAL ABONO</span>
          <span className="text-white text-2xl font-bold tabular-nums">{formatCLP(total)}</span>
        </div>

        {/* Comprobante option */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={printComprobante} onChange={e => setPrintComprobante(e.target.checked)} />
          Generar comprobante PDF con saldo restante
        </label>

        <div className="flex gap-3 justify-end">
          <button className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
          <button className="btn-primary"
            disabled={!accionista || !temporada || form.temporadas_cubiertas < 1 || form.temporadas_cubiertas > deudorConfig.temporadas_adeudadas}
            onClick={() => setConfirming(true)}
          >
            Guardar abono
          </button>
        </div>
      </div>

      {/* Confirm dialog */}
      {confirming && accionista && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Confirmar abono</h2>
            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between"><span>Accionista:</span><span className="font-medium">{accionista.nombre}</span></div>
              <div className="flex justify-between"><span>Temporadas cubiertas:</span><span>{form.temporadas_cubiertas}</span></div>
              <div className="flex justify-between"><span>Temporadas restantes:</span>
                <span className={remaining > 0 ? 'text-amber-600 font-medium' : 'text-green-600 font-medium'}>
                  {Math.max(0, remaining)}
                </span>
              </div>
              <div className="flex justify-between"><span>Monto acciones:</span><span>{formatCLP(form.monto)}</span></div>
              {form.multas > 0 && <div className="flex justify-between"><span>Multas:</span><span>{formatCLP(form.multas)}</span></div>}
              {form.cuota_extraordinaria > 0 && <div className="flex justify-between"><span>Cuota extra:</span><span>{formatCLP(form.cuota_extraordinaria)}</span></div>}
              {form.otros_ingresos > 0 && <div className="flex justify-between"><span>Otros:</span><span>{formatCLP(form.otros_ingresos)}</span></div>}
              <div className="flex justify-between border-t pt-1 font-bold text-gray-900">
                <span>TOTAL:</span><span>{formatCLP(total)}</span>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-secondary" onClick={() => setConfirming(false)}>Volver</button>
              <button className="btn-primary" onClick={handleSave}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
