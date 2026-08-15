import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from './ipc'
import {
  calcularMontoAcciones, calcularMultas, calcularMultaVencimiento,
  tieneMultaVencimiento, calcularTotal, calcularDeuda,
  toISODate, formatFecha
} from './formulas'
import { exportComprobanteAbono } from './export'
import type { Accionista, Temporada } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'

export type Mode = 'completo' | 'abono'

interface DeudorConfig {
  temporadas_adeudadas: number
  total_abonado: number
  total_cargos: number
  total_cargos_pagados: number
}

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

  const [deudorConfig, setDeudorConfig] = useState<DeudorConfig>({
    temporadas_adeudadas: 1,
    total_abonado: 0,
    total_cargos: 0,
    total_cargos_pagados: 0
  })

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

  const totalOweComputed = (acc: Accionista | null, t: Temporada | null, cfg: DeudorConfig) => {
    if (!acc || !t) return calcularDeuda({ valorAccion: 0, acciones: 0, hectareas: 0, temporadasAdeudadas: 1, totalAbonado: 0, totalCargos: 0, totalCargosPagados: 0, montoPorAccion: 0, multaVencimiento: 0 })
    const multaVenc = tieneMultaVencimiento(t)
      ? calcularMultaVencimiento(acc.acciones, acc.hectareas, t.monto_multa_por_accion, t.valor_accion, cfg.total_abonado)
      : 0
    return calcularDeuda({
      valorAccion:         t.valor_accion,
      acciones:            acc.acciones,
      hectareas:           acc.hectareas,
      temporadasAdeudadas: cfg.temporadas_adeudadas,
      totalAbonado:        cfg.total_abonado,
      totalCargos:         cfg.total_cargos,
      totalCargosPagados:  cfg.total_cargos_pagados,
      montoPorAccion:      t.monto_multa_por_accion,
      multaVencimiento:    multaVenc
    })
  }

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
        api.deudores.getConfig(a.id, t.id),
        api.cargos.listByAccionista(a.id, t.id)
      ]).then(([pagos, cfg, cargos]: [any[], DeudorConfig, any[]]) => {
        const dup = pagos.find((p: any) => p.temporada_id === t.id)
        setExistingPago(dup ?? null)
        setDeudorConfig(cfg)
        setCargosDetalle(cargos.map(c => ({ id: c.id, nombre: c.nombre, monto: c.monto, pagado: !!c.pagado })))

        const adeudadas = cfg.temporadas_adeudadas ?? 1
        const multaPrevias = calcularMultas(a.acciones, a.hectareas, adeudadas, t.monto_multa_por_accion)
        const multaVenc = tieneMultaVencimiento(t)
          ? calcularMultaVencimiento(a.acciones, a.hectareas, t.monto_multa_por_accion, t.valor_accion, cfg.total_abonado)
          : 0
        setForm(prev => {
          const newMonto = calcularMontoAcciones(t.valor_accion, a.acciones, a.hectareas, adeudadas)
          return { ...prev, temporadas_pagadas: adeudadas, monto_acciones: newMonto, multas: multaPrevias + multaVenc }
        })
        if (dup) {
          setAbonoForm(prev => ({ ...prev, monto: Math.max(0, cfg.total_cargos - cfg.total_cargos_pagados) }))
        } else {
          const deuda = totalOweComputed(a, t, cfg)
          setAbonoForm(prev => ({ ...prev, monto: deuda.pendiente }))
        }
      })
    }
  }

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
  const deudaBreakdown = totalOweComputed(selectedAcc, activeTemporada ?? null, deudorConfig)
  const yaAbonado = deudorConfig.total_abonado
  const pendiente = deudaBreakdown.pendiente
  const hasUnpaidCargos = deudorConfig.total_cargos > deudorConfig.total_cargos_pagados
  const pendingCargosAmount = Math.max(0, deudorConfig.total_cargos - deudorConfig.total_cargos_pagados)
  const pendienteParaAbono = (existingPago && hasUnpaidCargos) ? pendingCargosAmount : pendiente
  const cargosPendientesDetalle = cargosDetalle.filter(c => !c.pagado)

  const multaDetalle: { nombre: string; monto: number }[] = []
  if (selectedAcc && activeTemporada) {
    const previas = calcularMultas(
      selectedAcc.acciones, selectedAcc.hectareas,
      deudorConfig.temporadas_adeudadas, activeTemporada.monto_multa_por_accion
    )
    if (previas > 0) {
      const n = deudorConfig.temporadas_adeudadas - 1
      multaDetalle.push({
        nombre: `Multa por ${n} temporada${n !== 1 ? 's' : ''} adeudada${n !== 1 ? 's' : ''}`,
        monto: previas
      })
    }
    if (tieneMultaVencimiento(activeTemporada)) {
      const venc = calcularMultaVencimiento(
        selectedAcc.acciones, selectedAcc.hectareas,
        activeTemporada.monto_multa_por_accion, activeTemporada.valor_accion,
        deudorConfig.total_abonado
      )
      if (venc > 0) {
        multaDetalle.push({
          nombre: `Multa por vencimiento (plazo ${formatFecha(activeTemporada.fecha_multa!)})`,
          monto: venc
        })
      }
    }
  }
  const restanteTras = Math.max(0, pendienteParaAbono - abonoTotal)
  const totalCompleto = deudaBreakdown.pendiente
  const filteredAcc = accionistas
    .filter(a => nombreCompleto(a).toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8)

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
    deudorConfig,
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
    deudaBreakdown,
    yaAbonado,
    pendiente,
    hasUnpaidCargos,
    pendingCargosAmount,
    pendienteParaAbono,
    restanteTras,
    totalCompleto,
    multaDetalle,
    cargosDetalle,
    cargosPendientesDetalle,
    // Handlers
    handleSearchChange,
    selectAccionista,
    handleTemporadaChange,
    handleSaveFull,
    handleSaveAbono,
    navigate,
  }
}
