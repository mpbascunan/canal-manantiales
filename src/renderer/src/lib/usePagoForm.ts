import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from './ipc'
import { calcularMontoAcciones, calcularTotal, toISODate } from './formulas'
import { exportComprobanteAbono } from './export'
import type { Accionista, Temporada } from '../../../shared/types'
import type { DeudaPorTemporada } from '../../../shared/deuda'
import { nombreCompleto } from '../../../shared/types'

export type Mode = 'completo' | 'abono'

/** A date input is empty while it is being retyped; `''` must not reach the IPC. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function usePagoForm() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preselectedId = params.get('accionista') ? Number(params.get('accionista')) : null
  const initialMode = params.get('mode') === 'abono' ? 'abono' : 'completo'

  const [mode, setMode] = useState<Mode>(initialMode)
  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [accionistas, setAccionistas] = useState<Accionista[]>([])
  const [selectedAcc, setSelectedAcc] = useState<Accionista | null>(null)
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const [form, setForm] = useState({
    temporada_id: 0,
    fecha: toISODate(new Date()),
    numero_ingreso: 0,
    acciones_override: 0,
    hectareas_override: 0,
    temporadas_pagadas: 1,
    monto_acciones: 0,
    multas: 0,
    notas: ''
  })

  const [abonoForm, setAbonoForm] = useState({
    fecha: toISODate(new Date()),
    numero_ingreso: 0,
    monto: 0,
    multas: 0,
    notas: ''
  })

  const [deuda, setDeuda] = useState<DeudaPorTemporada | null>(null)
  const [cargosDetalle, setCargosDetalle] = useState<{ id: number; nombre: string; monto: number; pagado: boolean }[]>([])
  const [printComprobante, setPrintComprobante] = useState(false)
  const [existingPago, setExistingPago] = useState<{ id: number; fecha: string; total: number } | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const activeTemporada = temporadas.find(t => t.id === form.temporada_id)

  useEffect(() => {
    Promise.all([api.temporadas.list(), api.accionistas.list()]).then(([ts, as]) => {
      setTemporadas(ts)
      setAccionistas(as)
      const active = ts.find((t: Temporada) => t.activa)
      if (active) setForm(f => ({ ...f, temporada_id: active.id }))
      if (preselectedId) {
        const a = as.find((x: Accionista) => x.id === preselectedId)
        if (a) selectAccionistaWith(a, ts.find((x: Temporada) => x.activa) ?? null)
      }
    })
  }, [])

  const selectAccionistaWith = (a: Accionista, t: Temporada | null) => {
    setSelectedAcc(a)
    setSearch(nombreCompleto(a))
    setShowDropdown(false)
    setExistingPago(null)
    setForm(f => ({
      ...f,
      acciones_override: a.acciones,
      hectareas_override: a.hectareas,
      monto_acciones: t ? calcularMontoAcciones(t.valor_accion, a.acciones, a.hectareas, f.temporadas_pagadas) : f.monto_acciones
    }))

    setCargosDetalle([])
    if (t) {
      Promise.all([
        api.pagos.listByAccionista(a.id),
        api.cargos.listByAccionista(a.id, t.id)
      ]).then(([pagos, cargos]: [any[], any[]]) => {
        const dup = pagos.find((p: any) => p.temporada_id === t.id)
        setExistingPago(dup ?? null)
        setCargosDetalle(cargos.map(c => ({ id: c.id, nombre: c.nombre, monto: c.monto, pagado: !!c.pagado })))
      })
    }
    // The deuda itself is loaded by the effect below, which also reloads it
    // whenever the date on the form moves.
  }

  /**
   * The date the debt is evaluated at: the one **on the form**, not today's.
   *
   * A pago transcribed weeks after the money changed hands is still a pago made
   * on its own `fecha`. If that date falls on or before a temporada's
   * `fecha_multa`, that temporada's multa por atraso never accrued and must not
   * be charged (D6 rule 5) — reading the clock instead fined the accionista for
   * the administration's delay in typing up the receipt.
   */
  const referenceDate = mode === 'completo' ? form.fecha : abonoForm.fecha

  /**
   * The `total_pendiente` last written into `abonoForm.monto`, so a refreshed
   * debt can refill an untouched amount without overwriting a typed one.
   */
  const seededAmount = useRef<number | null>(null)

  useEffect(() => {
    if (!selectedAcc || !ISO_DATE.test(referenceDate)) return
    let cancelled = false
    // The whole picture across temporadas (D13): the same figure the debt card
    // shows, so the two can no longer disagree (README 15).
    api.deudores.getDeuda(selectedAcc.id, referenceDate).then((d: DeudaPorTemporada) => {
      if (cancelled) return
      setDeuda(d)

      // A "pago completo" settles everything outstanding, so the form is
      // seeded from the derived breakdown rather than from a season count.
      const cuotas = d.temporadas.reduce((s, x) => s + x.pendiente_cuota, 0)
      const multas = d.temporadas.reduce((s, x) => s + x.pendiente_multa, 0)
      setForm(prev => ({
        ...prev,
        temporadas_pagadas: Math.max(1, d.temporadas.filter(x => x.pendiente_cuota > 0).length),
        monto_acciones: cuotas,
        multas
      }))
      // The ref is written here, not inside the updater: a state updater must
      // stay pure — React can call it twice, and the second call would then see
      // the value it had just written and read an untouched amount as typed.
      const previousSeed = seededAmount.current
      seededAmount.current = d.total_pendiente
      setAbonoForm(prev =>
        prev.monto === 0 || prev.monto === previousSeed
          ? { ...prev, monto: d.total_pendiente }
          : prev
      )
    })
    return () => { cancelled = true }
  }, [selectedAcc?.id, referenceDate])

  const selectAccionista = (a: Accionista) => selectAccionistaWith(a, activeTemporada ?? null)

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setShowDropdown(true)
    setSelectedAcc(null)
  }

  const handleTemporadaChange = (tid: number) => {
    setForm(f => ({ ...f, temporada_id: tid }))
    if (selectedAcc && tid) {
      api.pagos.listByAccionista(selectedAcc.id).then((pagos: any[]) => {
        setExistingPago(pagos.find((p: any) => p.temporada_id === tid) ?? null)
      })
    }
  }

  // Computed
  const total = calcularTotal(form.monto_acciones, form.multas)
  const abonoTotal = calcularTotal(abonoForm.monto, abonoForm.multas)
  const yaAbonado = deuda?.total_abonado ?? 0
  const pendiente = deuda?.total_pendiente ?? 0
  const pendingCargosAmount = deuda
    ? deuda.temporadas.reduce((s, t) => s + t.pendiente_cargos, 0)
    : 0
  const hasUnpaidCargos = pendingCargosAmount > 0
  const pendienteParaAbono = pendiente
  const cargosPendientesDetalle = cargosDetalle.filter(c => !c.pagado)
  /** The active temporada's cargos, at the amount `calcularMontoCargo` gives. */
  const totalCargos = cargosDetalle.reduce((s, c) => s + c.monto, 0)
  /** How many seasons the cuota shown covers — every one still owing one (D13). */
  const temporadasConCuota = (deuda?.temporadas ?? []).filter(t => t.pendiente_cuota > 0).length

  // One line per temporada that carries a fine, each at its own rate (D6) —
  // a single "multas" figure cannot be checked against the paper record.
  const multaDetalle: { nombre: string; monto: number }[] = (deuda?.temporadas ?? [])
    .filter(t => t.pendiente_multa > 0)
    .map(t => ({ nombre: `Multa por atraso ${t.nombre}`, monto: t.pendiente_multa }))

  /**
   * Temporadas whose fine the *form's* date waives: the deadline has passed by
   * now, but not by the date being registered. Shown so a receipt with no multa
   * on it is visibly a deliberate consequence of the date, not a missing charge —
   * silence there reads as a bug to whoever reconciles it on paper.
   */
  const multaOmitidaDetalle: { nombre: string; fecha_multa: string }[] = temporadas
    .filter(t =>
      t.fecha_multa !== null &&
      t.fecha_multa < toISODate(new Date()) &&
      ISO_DATE.test(referenceDate) &&
      referenceDate <= t.fecha_multa &&
      (deuda?.temporadas.some(x => x.temporada_id === t.id && x.pendiente_cuota > 0) ?? false)
    )
    .map(t => ({ nombre: t.nombre, fecha_multa: t.fecha_multa! }))

  const restanteTras = Math.max(0, pendienteParaAbono - abonoTotal)
  const totalCompleto = pendiente
  const filteredAcc = accionistas
    .filter(a => nombreCompleto(a).toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8)

  const handleSaveFull = async () => {
    if (!selectedAcc) return alert('Selecciona un accionista')
    if (!form.temporada_id) return alert('Selecciona una temporada')
    // The button is disabled until the deuda loads, but the guard belongs here
    // too: every amount below is derived from it, and a pago saved with the
    // zeroes of the loading state would settle the temporada for nothing (D2).
    if (!deuda) return alert('Todavía se está calculando la deuda, espera un momento')
    await api.pagos.create({
      numero_ingreso: form.numero_ingreso,
      accionista_id: selectedAcc.id,
      temporada_id: form.temporada_id,
      fecha: form.fecha,
      temporadas_pagadas: form.temporadas_pagadas,
      monto_acciones: form.monto_acciones,
      multas: form.multas,
      total: totalCompleto,
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
        total: abonoTotal,
        monto_restante: restanteTras
      })
    }
    setSaved(true)
    setConfirming(false)
    setTimeout(() => navigate('/deudores'), 1200)
  }

  return {
    // UI state
    mode, setMode,
    search, showDropdown, setShowDropdown,
    selectedAcc,
    form, setForm,
    abonoForm, setAbonoForm,
    printComprobante, setPrintComprobante,
    existingPago,
    saved,
    confirming, setConfirming,
    // Data
    activeTemporada,
    temporadas,
    filteredAcc,
    // Computed
    total,
    abonoTotal,
    deuda,
    yaAbonado,
    pendiente,
    hasUnpaidCargos,
    pendingCargosAmount,
    pendienteParaAbono,
    restanteTras,
    totalCompleto,
    multaDetalle,
    multaOmitidaDetalle,
    cargosDetalle,
    cargosPendientesDetalle,
    totalCargos,
    temporadasConCuota,
    // Handlers
    handleSearchChange,
    selectAccionista,
    handleTemporadaChange,
    handleSaveFull,
    handleSaveAbono,
    navigate,
  }
}
