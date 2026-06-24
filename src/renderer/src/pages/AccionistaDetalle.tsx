import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import {
  calcularDeuda, calcularMultaVencimiento, tieneMultaVencimiento,
  formatCLP, formatFecha, formatNumber
} from '../lib/formulas'
import { exportAvisosCobro, previewAvisoCobro } from '../lib/export'
import type { Accionista, Pago, Temporada, Propiedad, Abono, Cargo } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'
import { AccionistaModal, type AccionistaEditForm } from '../components/AccionistaModal'

const TIPO_LABELS: Record<string, string> = {
  PARCELA: 'Parcela', SITIO: 'Sitio', 'PEQUEÑO_PROPIETARIO': 'Pequeño Propietario'
}

type PendingDelete =
  | { type: 'pago';  item: Pago }
  | { type: 'abono'; item: Abono }

interface DeudorConfig {
  temporadas_adeudadas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total_abonado: number
  total_cargos: number
  total_cargos_pagados: number
}

export default function AccionistaDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [accionista, setAccionista] = useState<Accionista | null>(null)
  const [pagos, setPagos] = useState<Pago[]>([])
  const [abonos, setAbonos] = useState<Abono[]>([])
  const [propiedades, setPropiedades] = useState<Propiedad[]>([])
  const [temporada, setTemporada] = useState<Temporada | null>(null)
  const [deudorConfig, setDeudorConfig] = useState<DeudorConfig | null>(null)
  const [cargos, setCargos] = useState<(Cargo & { monto: number; pagado: number })[]>([])
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editForm, setEditForm] = useState<AccionistaEditForm | null>(null)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)

  const reload = () => {
    const aid = Number(id)
    Promise.all([
      api.accionistas.get(aid),
      api.pagos.listByAccionista(aid),
      api.abonos.listByAccionista(aid),
      api.propiedades.list(aid),
      api.temporadas.getActive()
    ]).then(([a, ps, abs, props, t]) => {
      setAccionista(a)
      setPagos(ps)
      setAbonos(abs)
      setPropiedades(props)
      setTemporada(t)
      // Load debt config and cargos for the active temporada
      if (t) {
        api.deudores.getConfig(aid, t.id).then(setDeudorConfig)
        api.cargos.listByAccionista(aid, t.id).then(setCargos)
      }
    })
  }

  useEffect(() => { reload() }, [id])

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    if (pendingDelete.type === 'pago') {
      await api.pagos.delete(pendingDelete.item.id)
    } else {
      await api.abonos.delete(pendingDelete.item.id)
    }
    setPendingDelete(null)
    setDeleting(false)
    reload()
  }

  const openEdit = async () => {
    if (!accionista) return
    const props = await api.propiedades.list(accionista.id)
    const propiedades = props.length > 0
      ? props.map((p: any) => ({
          id: p.id, numero: p.numero ?? '', tipo: p.tipo,
          acciones: p.acciones, hectareas: p.hectareas,
          direccion: p.direccion ?? '', sector: p.sector ?? '',
          comuna: p.comuna ?? '', marco: p.marco ?? ''
        }))
      : [{ numero: accionista.numero ?? '', tipo: accionista.tipo, acciones: accionista.acciones, hectareas: accionista.hectareas, direccion: '', sector: '', comuna: '', marco: '' }]
    setEditForm({
      id: accionista.id, nombre: accionista.nombre,
      apellido_paterno: accionista.apellido_paterno ?? '', apellido_materno: accionista.apellido_materno ?? '',
      numero_socio: accionista.numero_socio ?? '', activo: accionista.activo, notas: accionista.notas ?? '', propiedades
    })
  }

  const saveEdit = async () => {
    if (!editForm) return
    await api.accionistas.update({
      id: editForm.id!, nombre: editForm.nombre,
      apellido_paterno: editForm.apellido_paterno || null,
      apellido_materno: editForm.apellido_materno || null,
      numero_socio: editForm.numero_socio || null,
      activo: editForm.activo, notas: editForm.notas || null,
      propiedades: editForm.propiedades.map(p => ({
        ...p, numero: p.numero || null, direccion: p.direccion || null,
        sector: p.sector || null, comuna: p.comuna || null, marco: p.marco || null
      }))
    })
    setEditForm(null)
    reload()
  }

  if (!accionista) return <div className="text-gray-400 p-8">Cargando...</div>

  const totalAcc    = pagos.reduce((s, p) => s + p.monto_acciones, 0) + abonos.reduce((s, a) => s + a.monto, 0)
  const totalMultas = pagos.reduce((s, p) => s + p.multas, 0)         + abonos.reduce((s, a) => s + a.multas, 0)
  const totalCuota  = pagos.reduce((s, p) => s + p.cuota_extraordinaria, 0) + abonos.reduce((s, a) => s + a.cuota_extraordinaria, 0)
  const totalOtros  = pagos.reduce((s, p) => s + p.otros_ingresos, 0) + abonos.reduce((s, a) => s + a.otros_ingresos, 0)
  const grandTotal  = pagos.reduce((s, p) => s + p.total, 0)          + abonos.reduce((s, a) => s + a.total, 0)

  // Debt status for active temporada
  const hasPaidThisSeason = temporada
    ? pagos.some(p => p.temporada_id === temporada.id)
    : false

  const totalCargos        = cargos.reduce((s, c) => s + c.monto, 0)
  const totalCargosPagados = cargos.filter(c => c.pagado).reduce((s, c) => s + c.monto, 0)

  const multaVencimiento = (temporada && accionista && deudorConfig && tieneMultaVencimiento(temporada))
    ? calcularMultaVencimiento(accionista.acciones, accionista.hectareas, temporada.monto_multa_por_accion, temporada.valor_accion, deudorConfig.total_abonado)
    : 0

  const deuda = (temporada && accionista && deudorConfig)
    ? calcularDeuda({
        valorAccion:          temporada.valor_accion,
        acciones:             accionista.acciones,
        hectareas:            accionista.hectareas,
        temporadasAdeudadas:  deudorConfig.temporadas_adeudadas,
        cuotaExtraordinaria:  deudorConfig.cuota_extraordinaria,
        otrosIngresos:        deudorConfig.otros_ingresos,
        totalAbonado:         deudorConfig.total_abonado,
        totalCargos,
        totalCargosPagados,
        montoPorAccion:       temporada.monto_multa_por_accion,
        multaVencimiento
      })
    : null

  const debtTotal     = deuda?.total ?? 0
  const debtPendiente = deuda?.pendiente ?? 0

  const handlePrintAviso = () => {
    if (!temporada) return
    const url = previewAvisoCobro([accionista], temporada, temporada.valor_accion, multaVencimiento, propiedades, cargos)
    setPdfPreviewUrl(url)
  }

  const handleDownloadAviso = () => {
    if (!temporada) return
    exportAvisosCobro([accionista], temporada, temporada.valor_accion, multaVencimiento, propiedades, cargos)
  }

  const closePdfPreview = () => {
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl)
    setPdfPreviewUrl(null)
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <button className="text-gray-400 hover:text-gray-600 text-sm" onClick={() => navigate('/accionistas')}>
          ← Accionistas
        </button>
      </div>

      {/* Header card */}
      <div className="card p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="badge-blue">{TIPO_LABELS[accionista.tipo]}</span>
            {accionista.numeros && (
              <span className="text-gray-400 text-sm">N° {accionista.numeros}</span>
            )}
          </div>
          <h1 className="text-xl font-bold text-gray-900">{nombreCompleto(accionista)}</h1>
          {accionista.numero_socio && (
            <p className="text-xs text-gray-400 mt-0.5">N° socio: {accionista.numero_socio}</p>
          )}
          <div className="flex gap-6 mt-3 text-sm text-gray-600">
            {accionista.acciones > 0 && (
              <div><span className="text-gray-400">Acciones totales: </span>
                <span className="font-medium">{formatNumber(accionista.acciones)}</span></div>
            )}
            {accionista.hectareas > 0 && (
              <div><span className="text-gray-400">Hectáreas totales: </span>
                <span className="font-medium">{formatNumber(accionista.hectareas)}</span></div>
            )}
          </div>
          {accionista.notas && <p className="text-xs text-gray-400 mt-2">{accionista.notas}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={openEdit}>
            Editar
          </button>
          {temporada && (
            <button className="btn-secondary btn-sm" onClick={handlePrintAviso}>
              Imprimir aviso
            </button>
          )}
          <button className="btn-primary btn-sm" onClick={() => navigate(`/pagos/nuevo?accionista=${accionista.id}`)}>
            + Registrar pago
          </button>
        </div>
      </div>

      {/* Active season debt status */}
      {temporada && deudorConfig && (
        <div className={`card p-4 flex items-center justify-between ${
          hasPaidThisSeason
            ? 'border-green-200 bg-green-50'
            : debtPendiente > 0
              ? 'border-amber-200 bg-amber-50'
              : 'border-gray-200'
        }`}>
          <div className="text-sm">
            <span className="font-semibold text-gray-700">Temporada activa: </span>
            <span className="text-gray-600">{temporada.nombre}</span>
          </div>

          {hasPaidThisSeason ? (
            <span className="text-green-700 font-semibold text-sm">✓ Pagado</span>
          ) : debtPendiente > 0 ? (
            <div className="text-right text-sm">
              <div className="text-amber-700 font-semibold">
                Deuda pendiente: {formatCLP(debtPendiente)}
              </div>
              {deudorConfig.total_abonado > 0 && (
                <div className="text-xs text-gray-500">
                  Total: {formatCLP(debtTotal)} · Abonado: {formatCLP(deudorConfig.total_abonado)}
                </div>
              )}
              <div className="text-xs text-gray-400">
                {deudorConfig.temporadas_adeudadas} temporada{deudorConfig.temporadas_adeudadas !== 1 ? 's' : ''} adeudada{deudorConfig.temporadas_adeudadas !== 1 ? 's' : ''}
              </div>
              {multaVencimiento > 0 && temporada?.fecha_multa && (
                <div className="text-xs text-orange-600 mt-0.5">
                  Incluye multa por vencimiento ({formatCLP(multaVencimiento)}) · límite {formatFecha(temporada.fecha_multa)}
                </div>
              )}
            </div>
          ) : (
            <span className="text-gray-400 text-sm">Sin deuda registrada</span>
          )}
        </div>
      )}

      {/* Propiedades breakdown */}
      {propiedades.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-sm text-gray-700">Propiedades ({propiedades.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">N°</th>
                <th className="px-4 py-2 text-left">Tipo</th>
                <th className="px-4 py-2 text-left">Dirección</th>
                <th className="px-4 py-2 text-left">Sector</th>
                <th className="px-4 py-2 text-left">Comuna</th>
                <th className="px-4 py-2 text-left">Marco</th>
                <th className="px-4 py-2 text-right">Acciones</th>
                <th className="px-4 py-2 text-right">Hectáreas</th>
              </tr>
            </thead>
            <tbody>
              {propiedades.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="px-4 py-2 text-gray-500">{p.numero ?? '—'}</td>
                  <td className="px-4 py-2">{TIPO_LABELS[p.tipo]}</td>
                  <td className="px-4 py-2 text-gray-600">{p.direccion ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{p.sector ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{p.comuna ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{p.marco ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.acciones > 0 ? formatNumber(p.acciones) : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.hectareas > 0 ? formatNumber(p.hectareas) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals summary */}
      {(pagos.length > 0 || abonos.length > 0) && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Cuota acciones', value: totalAcc },
            { label: 'Multas', value: totalMultas },
            { label: 'Cuota extra + Otros', value: totalCuota + totalOtros },
            { label: 'Total pagado', value: grandTotal }
          ].map(({ label, value }) => (
            <div key={label} className="card p-3 text-center">
              <div className="text-xs text-gray-500">{label}</div>
              <div className="font-bold text-sm mt-1">{formatCLP(value)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Payments table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-sm text-gray-700">Historial de pagos</h2>
        </div>
        {pagos.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">Sin pagos registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-left">N° Ingreso</th>
                <th className="px-4 py-2 text-left">Temporada</th>
                <th className="px-4 py-2 text-right">Períodos</th>
                <th className="px-4 py-2 text-right">Monto Acc.</th>
                <th className="px-4 py-2 text-right">Multas</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {pagos.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="px-4 py-2 text-gray-500">{formatFecha(p.fecha)}</td>
                  <td className="px-4 py-2">{p.numero_ingreso}</td>
                  <td className="px-4 py-2 text-gray-500">{p.temporada_nombre}</td>
                  <td className="px-4 py-2 text-right">{p.temporadas_pagadas}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCLP(p.monto_acciones)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.multas > 0 ? formatCLP(p.multas) : '—'}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatCLP(p.total)}</td>
                  <td className="px-4 py-2">
                    <button
                      className="text-red-400 hover:text-red-600 text-xs hover:underline"
                      onClick={() => setPendingDelete({ type: 'pago', item: p })}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Abonos table */}
      {abonos.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-sm text-gray-700">Abonos</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-left">N° Ingreso</th>
                <th className="px-4 py-2 text-left">Temporada</th>
                <th className="px-4 py-2 text-right">Monto</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {abonos.map(a => (
                <tr key={a.id} className="table-row">
                  <td className="px-4 py-2 text-gray-500">{formatFecha(a.fecha)}</td>
                  <td className="px-4 py-2">{a.numero_ingreso}</td>
                  <td className="px-4 py-2 text-gray-500">{a.temporada_nombre}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCLP(a.monto)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatCLP(a.total)}</td>
                  <td className="px-4 py-2">
                    <button
                      className="text-red-400 hover:text-red-600 text-xs hover:underline"
                      onClick={() => setPendingDelete({ type: 'abono', item: a })}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cargos table */}
      {cargos.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-sm text-gray-700">Cargos temporada activa</h2>
            <span className="text-xs text-gray-400">
              Total: {formatCLP(cargos.reduce((s, c) => s + c.monto, 0))}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">Nombre</th>
                <th className="px-4 py-2 text-left">Fecha</th>
                <th className="px-4 py-2 text-right">Monto</th>
                <th className="px-4 py-2 text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {cargos.map(c => (
                <tr key={c.id} className="table-row">
                  <td className="px-4 py-2">{c.nombre}</td>
                  <td className="px-4 py-2 text-gray-500">{formatFecha(c.fecha)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCLP(c.monto)}</td>
                  <td className="px-4 py-2 text-center">
                    {c.pagado
                      ? <span className="text-green-600 text-xs font-medium">Pagado</span>
                      : <span className="text-amber-600 text-xs font-medium">Pendiente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit accionista modal */}
      {editForm && (
        <AccionistaModal
          value={editForm}
          isNew={false}
          onChange={setEditForm}
          onSave={saveEdit}
          onClose={() => setEditForm(null)}
        />
      )}

      {/* PDF preview modal */}
      {pdfPreviewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-lg shadow-xl flex flex-col" style={{ width: '820px', height: '90vh' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
              <h3 className="font-semibold text-gray-900 text-sm">Vista previa — Aviso de cobranza</h3>
              <div className="flex items-center gap-2">
                <button className="btn-secondary btn-sm" onClick={handleDownloadAviso}>
                  Descargar PDF
                </button>
                <button className="text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={closePdfPreview}>
                  ×
                </button>
              </div>
            </div>
            <iframe
              src={pdfPreviewUrl}
              title="Vista previa aviso de cobranza"
              className="flex-1 w-full rounded-b-lg"
            />
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-1">
              ¿Eliminar {pendingDelete.type === 'pago' ? 'pago' : 'abono'}?
            </h2>
            <p className="text-sm text-gray-500 mb-4">Esta acción no se puede deshacer.</p>
            <div className="space-y-1 text-sm text-gray-700 mb-4">
              <div className="flex justify-between">
                <span>Fecha:</span>
                <span>{formatFecha(pendingDelete.item.fecha)}</span>
              </div>
              <div className="flex justify-between">
                <span>N° Ingreso:</span>
                <span>{pendingDelete.item.numero_ingreso}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Total:</span>
                <span>{formatCLP(pendingDelete.item.total)}</span>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancelar
              </button>
              <button
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md disabled:opacity-50"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
