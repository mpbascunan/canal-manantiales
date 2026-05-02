import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/ipc'
import {
  calcularMontoAcciones, calcularMultas, calcularTotal,
  formatCLP, toISODate
} from '../lib/formulas'
import { exportComprobanteAbono } from '../lib/export'
import type { Accionista, Temporada } from '../../../shared/types'

type Mode = 'completo' | 'abono'

interface DeudorConfig {
  temporadas_adeudadas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total_abonado: number
}

export default function NuevoPago() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preselectedId = params.get('accionista') ? Number(params.get('accionista')) : null
  const initialMode = params.get('mode') === 'abono' ? 'abono' : 'completo'

  const [mode, setMode] = useState<Mode>(initialMode)

  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [accionistas, setAccionistas] = useState<Accionista[]>([])
  const [selectedAcc, setSelectedAcc] = useState<Accionista | null>(null)
  const [nextNum, setNextNum] = useState(0)
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  // Full payment form
  const [form, setForm] = useState({
    temporada_id: 0,
    fecha: toISODate(new Date()),
    numero_ingreso: 0,
    acciones_override: 0,
    hectareas_override: 0,
    temporadas_pagadas: 1,
    monto_acciones: 0,
    multas: 0,
    cuota_extraordinaria: 0,
    otros_ingresos: 0,
    notas: ''
  })

  // Abono form — just an amount + optional breakdown
  const [abonoForm, setAbonoForm] = useState({
    fecha: toISODate(new Date()),
    numero_ingreso: 0,
    monto: 0,       // cuota por acciones portion
    multas: 0,
    cuota_extraordinaria: 0,
    otros_ingresos: 0,
    notas: ''
  })
  const [deudorConfig, setDeudorConfig] = useState<DeudorConfig>({
    temporadas_adeudadas: 1,
    cuota_extraordinaria: 0,
    otros_ingresos: 0,
    total_abonado: 0
  })
  const [printComprobante, setPrintComprobante] = useState(false)
  // Duplicate payment guard: pago already exists for this accionista + temporada
  const [existingPago, setExistingPago] = useState<{ id: number; fecha: string; total: number } | null>(null)

  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const activeTemporada = temporadas.find(t => t.id === form.temporada_id)

  useEffect(() => {
    Promise.all([
      api.temporadas.list(),
      api.accionistas.list(),
      api.pagos.nextNumeroIngreso()
    ]).then(([ts, as, num]) => {
      setTemporadas(ts)
      setAccionistas(as)
      setNextNum(num)
      const active = ts.find((t: Temporada) => t.activa)
      if (active) setForm(f => ({ ...f, temporada_id: active.id }))
      setForm(f => ({ ...f, numero_ingreso: num }))
      setAbonoForm(f => ({ ...f, numero_ingreso: num }))
      if (preselectedId) {
        const a = as.find((x: Accionista) => x.id === preselectedId)
        if (a) selectAccionistaWith(a, ts.find((x: Temporada) => x.activa) ?? null, num)
      }
    })
  }, [])

  // Compute total debt the accionista owes (using deudorConfig values)
  const totalOweComputed = (acc: Accionista | null, t: Temporada | null, cfg: DeudorConfig) => {
    if (!acc || !t) return 0
    const monto = calcularMontoAcciones(t.valor_accion, acc.acciones, acc.hectareas, cfg.temporadas_adeudadas)
    const multas = calcularMultas(acc.acciones, acc.hectareas, cfg.temporadas_adeudadas)
    return calcularTotal(monto, multas, cfg.cuota_extraordinaria, cfg.otros_ingresos)
  }

  const selectAccionistaWith = (a: Accionista, t: Temporada | null, numIngreso: number) => {
    setSelectedAcc(a)
    setSearch(a.nombre)
    setShowDropdown(false)
    setExistingPago(null)
    setForm(f => ({
      ...f,
      acciones_override: a.acciones,
      hectareas_override: a.hectareas,
      monto_acciones: t ? calcularMontoAcciones(t.valor_accion, a.acciones, a.hectareas, f.temporadas_pagadas) : f.monto_acciones,
      numero_ingreso: numIngreso || f.numero_ingreso
    }))
    setAbonoForm(f => ({ ...f, numero_ingreso: numIngreso || f.numero_ingreso }))

    if (t) {
      // Check for duplicate full payment
      api.pagos.listByAccionista(a.id).then((pagos: any[]) => {
        const dup = pagos.find((p: any) => p.temporada_id === t.id)
        setExistingPago(dup ?? null)
      })

      // Load deudor config (includes total_abonado)
      api.deudores.getConfig(a.id, t.id).then((cfg: DeudorConfig) => {
        setDeudorConfig(cfg)
        // Pre-fill full payment temporadas
        const adeudadas = cfg.temporadas_adeudadas ?? 1
        setForm(prev => {
          const newMonto = t ? calcularMontoAcciones(t.valor_accion, a.acciones, a.hectareas, adeudadas) : prev.monto_acciones
          return { ...prev, temporadas_pagadas: adeudadas, monto_acciones: newMonto }
        })
        // Pre-fill abono with remaining balance
        const totalOwed = totalOweComputed(a, t, cfg)
        const remaining = Math.max(0, totalOwed - cfg.total_abonado)
        setAbonoForm(prev => ({ ...prev, monto: remaining }))
      })
    }
  }

  const selectAccionista = (a: Accionista) => {
    selectAccionistaWith(a, activeTemporada ?? null, nextNum)
  }

  // Full payment recalc
  const recalcMonto = useCallback(() => {
    if (!activeTemporada) return
    const monto = calcularMontoAcciones(
      activeTemporada.valor_accion,
      form.acciones_override,
      form.hectareas_override,
      form.temporadas_pagadas
    )
    setForm(f => ({ ...f, monto_acciones: monto }))
  }, [activeTemporada, form.acciones_override, form.hectareas_override, form.temporadas_pagadas])

  const autoMultas = () => {
    if (!selectedAcc) return
    const m = calcularMultas(form.acciones_override, form.hectareas_override, form.temporadas_pagadas)
    setForm(f => ({ ...f, multas: m }))
  }

  const total = calcularTotal(form.monto_acciones, form.multas, form.cuota_extraordinaria, form.otros_ingresos)
  const abonoTotal = calcularTotal(abonoForm.monto, abonoForm.multas, abonoForm.cuota_extraordinaria, abonoForm.otros_ingresos)

  // Debt summary values
  const totalOwed   = totalOweComputed(selectedAcc, activeTemporada ?? null, deudorConfig)
  const yaAbonado   = deudorConfig.total_abonado
  const pendiente   = Math.max(0, totalOwed - yaAbonado)
  const restanteTras = Math.max(0, pendiente - abonoTotal)

  const filteredAcc = accionistas.filter(a =>
    a.nombre.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 8)

  // ── Save handlers ────────────────────────────────────────────────────────────

  const handleSaveFull = async () => {
    if (!selectedAcc) return alert('Selecciona un accionista')
    if (!form.temporada_id) return alert('Selecciona una temporada')
    await api.pagos.create({
      numero_ingreso: form.numero_ingreso,
      accionista_id: selectedAcc.id,
      temporada_id: form.temporada_id,
      fecha: form.fecha,
      temporadas_pagadas: form.temporadas_pagadas,
      monto_acciones: form.monto_acciones,
      multas: form.multas,
      cuota_extraordinaria: form.cuota_extraordinaria,
      otros_ingresos: form.otros_ingresos,
      total,
      notas: form.notas || null
    })
    setSaved(true)
    setConfirming(false)
    setTimeout(() => navigate('/pagos/mes'), 1200)
  }

  const handleSaveAbono = async () => {
    if (!selectedAcc || !activeTemporada) return
    await api.abonos.create({
      numero_ingreso: abonoForm.numero_ingreso,
      accionista_id: selectedAcc.id,
      temporada_id: activeTemporada.id,
      fecha: abonoForm.fecha,
      monto: abonoForm.monto,
      multas: abonoForm.multas,
      cuota_extraordinaria: abonoForm.cuota_extraordinaria,
      otros_ingresos: abonoForm.otros_ingresos,
      total: abonoTotal,
      notas: abonoForm.notas || null
    })
    if (printComprobante) {
      exportComprobanteAbono({
        accionista: selectedAcc,
        temporada: activeTemporada,
        fecha: abonoForm.fecha,
        numero_ingreso: abonoForm.numero_ingreso,
        monto: abonoForm.monto,
        multas: abonoForm.multas,
        cuota_extraordinaria: abonoForm.cuota_extraordinaria,
        otros_ingresos: abonoForm.otros_ingresos,
        total: abonoTotal,
        monto_restante: restanteTras
      })
    }
    setSaved(true)
    setConfirming(false)
    setTimeout(() => navigate('/deudores'), 1200)
  }

  if (saved) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="text-green-600 text-4xl">✓</div>
        <p className="text-gray-700 font-medium">
          {mode === 'completo' ? 'Pago registrado correctamente' : 'Abono registrado correctamente'}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Registrar Pago</h1>

        {/* Mode tabs */}
        <div className="flex mt-4 border-b border-gray-200">
          <button
            className={`px-5 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              mode === 'completo' ? 'border-canal-600 text-canal-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setMode('completo')}
          >
            Pago completo
          </button>
          <button
            className={`px-5 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              mode === 'abono' ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setMode('abono')}
          >
            Abono parcial
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        {/* Shared: accionista search */}
        <div className="relative">
          <label className="label">Accionista</label>
          <input
            className="input"
            value={search}
            onChange={e => { setSearch(e.target.value); setShowDropdown(true); setSelectedAcc(null) }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Buscar accionista..."
          />
          {showDropdown && search && filteredAcc.length > 0 && (
            <div className="absolute z-20 top-full left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {filteredAcc.map(a => (
                <button
                  key={a.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-canal-50"
                  onMouseDown={() => selectAccionista(a)}
                >
                  <div className="font-medium">{a.nombre}</div>
                  <div className="text-xs text-gray-400">
                    {a.numeros ? `N° ${a.numeros}` : a.numero ? `N° ${a.numero}` : ''}
                    {a.acciones > 0 ? ` · ${a.acciones} acc.` : ''}
                    {a.hectareas > 0 ? ` · ${a.hectareas} ha` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── FULL PAYMENT FIELDS ── */}
        {mode === 'completo' && (
          <>
            {/* Already-paid warning — blocks saving */}
            {existingPago && (
              <div className="rounded-md bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-800">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <span>✕</span> Este accionista ya tiene un pago registrado para esta temporada
                </div>
                <div className="text-red-700">
                  Fecha: {existingPago.fecha.split('-').reverse().join('/')} · Total: {formatCLP(existingPago.total)}
                </div>
                <div className="mt-1 text-xs text-red-600">
                  Si necesitas corregir el pago, elimínalo primero desde el historial del accionista.
                </div>
              </div>
            )}

            {/* Debt info banner */}
            {selectedAcc && !existingPago && deudorConfig.temporadas_adeudadas > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800 flex items-center gap-3">
                <span className="text-lg">⚠</span>
                <div>
                  Deuda actual: <strong>{deudorConfig.temporadas_adeudadas} temporada{deudorConfig.temporadas_adeudadas !== 1 ? 's' : ''} adeudada{deudorConfig.temporadas_adeudadas !== 1 ? 's' : ''}</strong>
                  {activeTemporada && (
                    <span className="ml-2 text-amber-700">
                      ≈ {formatCLP(totalOwed)}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Temporada</label>
                <select
                  className="input"
                  value={form.temporada_id}
                  onChange={e => {
                    const tid = Number(e.target.value)
                    setForm(f => ({ ...f, temporada_id: tid }))
                    // Re-check duplicate when temporada changes
                    if (selectedAcc && tid) {
                      api.pagos.listByAccionista(selectedAcc.id).then((pagos: any[]) => {
                        const dup = pagos.find((p: any) => p.temporada_id === tid)
                        setExistingPago(dup ?? null)
                      })
                    }
                  }}
                >
                  <option value={0}>— Seleccionar —</option>
                  {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div>
                <label className="label">N° Ingreso</label>
                <input type="number" className="input" value={form.numero_ingreso} onChange={e => setForm(f => ({ ...f, numero_ingreso: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="label">N° Temporadas a pagar</label>
                <input type="number" min={1} className="input" value={form.temporadas_pagadas}
                  onChange={e => setForm(f => ({ ...f, temporadas_pagadas: Number(e.target.value) }))}
                  onBlur={recalcMonto}
                />
              </div>
              <div>
                <label className="label">Acciones</label>
                <input type="number" step="0.0001" className="input" value={form.acciones_override}
                  onChange={e => setForm(f => ({ ...f, acciones_override: Number(e.target.value) }))}
                  onBlur={recalcMonto}
                />
              </div>
              <div>
                <label className="label">Hectáreas</label>
                <input type="number" step="0.0001" className="input" value={form.hectareas_override}
                  onChange={e => setForm(f => ({ ...f, hectareas_override: Number(e.target.value) }))}
                  onBlur={recalcMonto}
                />
              </div>
            </div>

            <div className="bg-canal-50 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between">
                <label className="label mb-0">Monto Cancelado por Acciones</label>
                <button className="text-xs text-canal-600 hover:underline" onClick={recalcMonto}>Recalcular</button>
              </div>
              <input type="number" className="input bg-white font-semibold text-canal-900" value={form.monto_acciones}
                onChange={e => setForm(f => ({ ...f, monto_acciones: Number(e.target.value) }))} />
              {activeTemporada && (
                <p className="text-xs text-canal-500">
                  ({formatCLP(activeTemporada.valor_accion)} × ({form.acciones_override} acc + {form.hectareas_override} ha) × {form.temporadas_pagadas} temp.)
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label mb-0">Multas</label>
                  <button className="text-xs text-orange-600 hover:underline" onClick={autoMultas}>Auto-calcular</button>
                </div>
                <input type="number" className="input" value={form.multas} onChange={e => setForm(f => ({ ...f, multas: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="label">Cuota Extraordinaria</label>
                <input type="number" className="input" value={form.cuota_extraordinaria} onChange={e => setForm(f => ({ ...f, cuota_extraordinaria: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="label">Otros Ingresos</label>
                <input type="number" className="input" value={form.otros_ingresos} onChange={e => setForm(f => ({ ...f, otros_ingresos: Number(e.target.value) }))} />
              </div>
            </div>
            <div>
              <label className="label">Notas (opcional)</label>
              <input className="input" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>

            <div className="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
              <span className="text-gray-300 font-medium">TOTAL</span>
              <span className="text-white text-2xl font-bold tabular-nums">{formatCLP(total)}</span>
            </div>

            <div className="flex gap-3 justify-end">
              <button className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
              <button
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!!existingPago}
                onClick={() => setConfirming(true)}
              >
                Guardar pago
              </button>
            </div>
          </>
        )}

        {/* ── ABONO FIELDS ── */}
        {mode === 'abono' && (
          <>
            {/* Already-paid warning — blocks abono too */}
            {existingPago && (
              <div className="rounded-md bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-800">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <span>✕</span> Este accionista ya tiene un pago completo para esta temporada
                </div>
                <div className="text-red-700">
                  Fecha: {existingPago.fecha.split('-').reverse().join('/')} · Total: {formatCLP(existingPago.total)}
                </div>
                <div className="mt-1 text-xs text-red-600">
                  No corresponde registrar abonos cuando la deuda ya está saldada con un pago completo.
                </div>
              </div>
            )}

            {/* Debt summary card */}
            {selectedAcc && activeTemporada && !existingPago && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                <div className="text-sm font-semibold text-amber-800 mb-1">
                  Deuda temporada {activeTemporada.nombre}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-0.5">Total adeudado</div>
                    <div className="font-semibold text-gray-800 tabular-nums">{formatCLP(totalOwed)}</div>
                    <div className="text-xs text-gray-400">{deudorConfig.temporadas_adeudadas} temp.</div>
                  </div>
                  <div className="text-center border-x border-amber-200">
                    <div className="text-xs text-gray-500 mb-0.5">Ya abonado</div>
                    <div className="font-semibold text-canal-700 tabular-nums">{formatCLP(yaAbonado)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-0.5">Pendiente</div>
                    <div className={`font-bold tabular-nums ${pendiente > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                      {formatCLP(pendiente)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!selectedAcc && (
              <p className="text-sm text-gray-400 text-center py-2">Selecciona un accionista para ver su deuda</p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input" value={abonoForm.fecha}
                  onChange={e => setAbonoForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div>
                <label className="label">N° Ingreso</label>
                <input type="number" className="input" value={abonoForm.numero_ingreso}
                  onChange={e => setAbonoForm(f => ({ ...f, numero_ingreso: Number(e.target.value) }))} />
              </div>
            </div>

            {/* Main amount */}
            <div className="bg-canal-50 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between">
                <label className="label mb-0">Monto a abonar</label>
                {selectedAcc && pendiente > 0 && (
                  <button
                    className="text-xs text-canal-600 hover:underline"
                    onClick={() => setAbonoForm(f => ({ ...f, monto: pendiente, multas: 0, cuota_extraordinaria: 0, otros_ingresos: 0 }))}
                  >
                    Completar deuda ({formatCLP(pendiente)})
                  </button>
                )}
              </div>
              <input
                type="number"
                min={0}
                className="input bg-white font-semibold text-canal-900"
                value={abonoForm.monto === 0 ? '' : abonoForm.monto}
                onChange={e => setAbonoForm(f => ({ ...f, monto: e.target.value === '' ? 0 : Number(e.target.value) }))}
                placeholder="0"
              />
            </div>

            {/* Optional breakdown — collapsed behind a toggle */}
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
                Desglose opcional (multas, cuota extra, otros)
              </summary>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="label">Multas incluidas en el monto</label>
                  <input type="number" className="input"
                    value={abonoForm.multas === 0 ? '' : abonoForm.multas}
                    onChange={e => setAbonoForm(f => ({ ...f, multas: e.target.value === '' ? 0 : Number(e.target.value) }))}
                    placeholder="0" />
                </div>
                <div>
                  <label className="label">Cuota Extraordinaria</label>
                  <input type="number" className="input"
                    value={abonoForm.cuota_extraordinaria === 0 ? '' : abonoForm.cuota_extraordinaria}
                    onChange={e => setAbonoForm(f => ({ ...f, cuota_extraordinaria: e.target.value === '' ? 0 : Number(e.target.value) }))}
                    placeholder="0" />
                </div>
                <div>
                  <label className="label">Otros Ingresos</label>
                  <input type="number" className="input"
                    value={abonoForm.otros_ingresos === 0 ? '' : abonoForm.otros_ingresos}
                    onChange={e => setAbonoForm(f => ({ ...f, otros_ingresos: e.target.value === '' ? 0 : Number(e.target.value) }))}
                    placeholder="0" />
                </div>
              </div>
            </details>

            <div>
              <label className="label">Notas (opcional)</label>
              <input className="input" value={abonoForm.notas}
                onChange={e => setAbonoForm(f => ({ ...f, notas: e.target.value }))} />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={printComprobante} onChange={e => setPrintComprobante(e.target.checked)} />
              Generar comprobante PDF con saldo restante
            </label>

            {/* After-abono preview */}
            {selectedAcc && abonoTotal > 0 && (
              <div className={`rounded-md px-4 py-2.5 text-sm flex items-center gap-2 ${
                restanteTras <= 0
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}>
                {restanteTras <= 0
                  ? <>✓ <strong>Deuda cubierta completamente</strong></>
                  : <>Quedará pendiente: <strong className="tabular-nums">{formatCLP(restanteTras)}</strong></>
                }
              </div>
            )}

            <div className="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
              <span className="text-gray-300 font-medium">TOTAL ABONO</span>
              <span className="text-white text-2xl font-bold tabular-nums">{formatCLP(abonoTotal)}</span>
            </div>

            <div className="flex gap-3 justify-end">
              <button className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
              <button
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!selectedAcc || !activeTemporada || abonoTotal <= 0 || !!existingPago}
                onClick={() => setConfirming(true)}
              >
                Guardar abono
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Confirm dialog ── */}
      {confirming && selectedAcc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-3">
              {mode === 'completo' ? 'Confirmar pago' : 'Confirmar abono'}
            </h2>
            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between"><span>Accionista:</span><span className="font-medium">{selectedAcc.nombre}</span></div>
              {mode === 'completo' ? (
                <>
                  <div className="flex justify-between"><span>Temporadas:</span><span>{form.temporadas_pagadas}</span></div>
                  <div className="flex justify-between"><span>Monto acciones:</span><span>{formatCLP(form.monto_acciones)}</span></div>
                  {form.multas > 0 && <div className="flex justify-between"><span>Multas:</span><span>{formatCLP(form.multas)}</span></div>}
                  {form.cuota_extraordinaria > 0 && <div className="flex justify-between"><span>Cuota extra:</span><span>{formatCLP(form.cuota_extraordinaria)}</span></div>}
                  {form.otros_ingresos > 0 && <div className="flex justify-between"><span>Otros:</span><span>{formatCLP(form.otros_ingresos)}</span></div>}
                  <div className="flex justify-between border-t pt-1 font-bold text-gray-900"><span>TOTAL:</span><span>{formatCLP(total)}</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span>Monto abonado:</span><span className="font-medium tabular-nums">{formatCLP(abonoTotal)}</span></div>
                  <div className="flex justify-between border-t pt-1">
                    <span>Pendiente tras abono:</span>
                    <span className={`font-bold tabular-nums ${restanteTras <= 0 ? 'text-green-600' : 'text-amber-600'}`}>
                      {restanteTras <= 0 ? '✓ Deuda cubierta' : formatCLP(restanteTras)}
                    </span>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button className="btn-secondary" onClick={() => setConfirming(false)}>Volver</button>
              <button className="btn-primary" onClick={mode === 'completo' ? handleSaveFull : handleSaveAbono}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
