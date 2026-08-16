import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/ipc'
import {
  calcularMultaVencimiento, tieneMultaVencimiento,
  formatCLP, formatFecha, formatNumber
} from '../lib/formulas'
import { exportAvisosCobro, previewAvisoCobro } from '../lib/export'
import type {
  Accionista, Pago, Temporada, Propiedad, Abono, Cargo
} from '../../../shared/types'
import type { DeudaPorTemporada } from '../../../shared/deuda'
import { nombreCompleto } from '../../../shared/types'
import { AccionistaModal, BLANK_PROPIEDAD, type AccionistaEditForm } from '../components/AccionistaModal'
import { DeudaInicialPanel } from '../components/DeudaInicialPanel'

const TIPO_LABELS: Record<string, string> = {
  PARCELA: 'Parcela', SITIO: 'Sitio', 'PEQUEÑO_PROPIETARIO': 'Pequeño Propietario'
}

interface DeudorConfig {
  temporadas_adeudadas: number
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
  const [editForm, setEditForm] = useState<AccionistaEditForm | null>(null)
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null)
  const [deudaCompleta, setDeudaCompleta] = useState<DeudaPorTemporada | null>(null)

  const reload = () => {
    const aid = Number(id)
    Promise.all([
      api.accionistas.get(aid),
      api.pagos.listByAccionista(aid),
      api.abonos.listByAccionista(aid),
      api.propiedades.list(aid),
      api.temporadas.getActive(),
      // Every temporada at once (D13) — the debt is no longer a single-season figure.
      api.deudores.getDeuda(aid)
    ]).then(([a, ps, abs, props, t, d]) => {
      setAccionista(a)
      setPagos(ps)
      setAbonos(abs)
      setPropiedades(props)
      setTemporada(t)
      setDeudaCompleta(d)
      // Load debt config and cargos for the active temporada
      if (t) {
        api.deudores.getConfig(aid, t.id).then(setDeudorConfig)
        api.cargos.listByAccionista(aid, t.id).then(setCargos)
      }
    })
  }

  useEffect(() => { reload() }, [id])

  const openEdit = async () => {
    if (!accionista) return
    const props = await api.propiedades.list(accionista.id)
    const propiedades = props.length > 0
      ? props.map((p: any) => ({
          id: p.id, nombre: p.nombre ?? '', tipo: p.tipo,
          acciones: p.acciones, hectareas: p.hectareas,
          direccion: p.direccion ?? '', marco: p.marco ?? ''
        }))
      : [BLANK_PROPIEDAD]
    setEditForm({
      id: accionista.id, nombre: accionista.nombre,
      apellido_paterno: accionista.apellido_paterno ?? '', apellido_materno: accionista.apellido_materno ?? '',
      rut: accionista.rut ?? '', numero_socio: accionista.numero_socio ?? '',
      activo: accionista.activo, notas: accionista.notas ?? '', propiedades
    })
  }

  const saveEdit = async () => {
    if (!editForm) return
    await api.accionistas.update({
      id: editForm.id!, nombre: editForm.nombre,
      apellido_paterno: editForm.apellido_paterno || null,
      apellido_materno: editForm.apellido_materno || null,
      rut: editForm.rut || null,
      numero_socio: editForm.numero_socio || null,
      activo: editForm.activo, notas: editForm.notas || null,
      propiedades: editForm.propiedades.map(p => ({
        ...p, nombre: p.nombre || null, direccion: p.direccion || null,
        marco: p.marco || null
      }))
    })
    setEditForm(null)
    reload()
  }

  if (!accionista) return <div className="text-gray-400 p-8">Cargando...</div>

  const grandTotal = pagos.reduce((s, p) => s + p.total, 0)          + abonos.reduce((s, a) => s + a.total, 0)

  // The active temporada's multa, still needed by the aviso until export.ts is
  // rewritten to take the per-temporada breakdown.
  const multaVencimiento = (temporada && accionista && deudorConfig && tieneMultaVencimiento(temporada))
    ? calcularMultaVencimiento(accionista.acciones, accionista.hectareas, temporada.monto_multa_por_accion, temporada.valor_accion, deudorConfig.total_abonado)
    : 0

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
          {accionista.nombres_propiedades && (
            <div className="mb-1">
              <span className="text-gray-400 text-sm">{accionista.nombres_propiedades}</span>
            </div>
          )}
          <h1 className="text-xl font-bold text-gray-900">{nombreCompleto(accionista)}</h1>
          {(accionista.rut || accionista.numero_socio) && (
            <p className="text-xs text-gray-400 mt-0.5">
              {[
                accionista.rut && `RUT: ${accionista.rut}`,
                accionista.numero_socio && `N° socio: ${accionista.numero_socio}`
              ].filter(Boolean).join(' · ')}
            </p>
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

      {/* Debt across every temporada (D13), not just the active one */}
      {deudaCompleta && <DeudaBreakdownCard deuda={deudaCompleta} />}

      {/* Debt carried in from before the system existed (D14) */}
      <DeudaInicialPanel accionistaId={Number(id)} onChange={reload} />

      {/* Propiedades breakdown */}
      {propiedades.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-sm text-gray-700">Propiedades ({propiedades.length})</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-2 text-left">Propiedad</th>
                <th className="px-4 py-2 text-left">Tipo</th>
                <th className="px-4 py-2 text-left">Dirección</th>
                <th className="px-4 py-2 text-left">Marco</th>
                <th className="px-4 py-2 text-right">Acciones</th>
                <th className="px-4 py-2 text-right">Hectáreas</th>
              </tr>
            </thead>
            <tbody>
              {propiedades.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="px-4 py-2 text-gray-500">{p.nombre ?? '—'}</td>
                  <td className="px-4 py-2">{TIPO_LABELS[p.tipo]}</td>
                  <td className="px-4 py-2 text-gray-600">{p.direccion ?? '—'}</td>
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
      {deudaCompleta && (() => {
        const showMulta = deudaCompleta.total_multas > 0
        const cols = showMulta ? 'grid-cols-3' : 'grid-cols-2'
        const unidades = accionista.acciones + accionista.hectareas
        const cards: { label: string; value: number; tooltip?: string }[] = [
          {
            label: 'Cuotas adeudadas',
            value: deudaCompleta.total_cuotas,
            tooltip: deudaCompleta.temporadas
              .filter(t => t.cuota > 0)
              .map(t => `${t.nombre}: ${formatCLP(t.cuota)}`)
              .join('\n') || undefined
          },
          ...(showMulta ? [{
            label: 'Multas por atraso',
            value: deudaCompleta.total_multas,
            tooltip: deudaCompleta.temporadas
              .filter(t => t.multa > 0)
              .map(t => `${t.nombre}: ${formatCLP(t.multa)} (${formatNumber(unidades)} unid.)`)
              .join('\n')
          }] : []),
          { label: 'Total pagado', value: grandTotal }
        ]
        return (
          <div className={`grid ${cols} gap-3`}>
            {cards.map(({ label, value, tooltip }) => (
              <div key={label} className="card p-3 text-center relative group">
                <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
                  {label}
                  {tooltip && <span className="text-gray-300 cursor-help text-xs">ⓘ</span>}
                </div>
                <div className="font-bold text-sm mt-1">{formatCLP(value)}</div>
                {tooltip && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    {tooltip}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })()}

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

      {/* Historial unificado */}
      {(() => {
        const historial = [
          ...pagos.map(p => ({
            key: `p-${p.id}`, tipo: 'pago' as const,
            fecha: p.fecha, numero_ingreso: p.numero_ingreso,
            temporada_nombre: p.temporada_nombre,
            periodos: p.temporadas_pagadas,
            monto: p.monto_acciones, multas: p.multas, total: p.total
          })),
          ...abonos.map(a => ({
            key: `a-${a.id}`, tipo: 'abono' as const,
            fecha: a.fecha, numero_ingreso: a.numero_ingreso,
            temporada_nombre: a.temporada_nombre,
            periodos: null,
            monto: a.monto, multas: a.multas, total: a.total
          }))
        ].sort((a, b) => a.fecha.localeCompare(b.fecha))

        return (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-sm text-gray-700">Historial de pagos</h2>
            </div>
            {historial.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">Sin pagos registrados.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-header">
                    <th className="px-4 py-2 text-left">Tipo</th>
                    <th className="px-4 py-2 text-left">Fecha</th>
                    <th className="px-4 py-2 text-left">N° Ingreso</th>
                    <th className="px-4 py-2 text-left">Temporada</th>
                    <th className="px-4 py-2 text-right">Períodos</th>
                    <th className="px-4 py-2 text-right">Monto</th>
                    <th className="px-4 py-2 text-right">Multas</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map(r => (
                    <tr key={r.key} className="table-row">
                      <td className="px-4 py-2">
                        {r.tipo === 'pago'
                          ? <span className="badge-blue">Pago</span>
                          : <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">Abono</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{formatFecha(r.fecha)}</td>
                      <td className="px-4 py-2">{r.numero_ingreso}</td>
                      <td className="px-4 py-2 text-gray-500">{r.temporada_nombre}</td>
                      <td className="px-4 py-2 text-right">{r.periodos ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCLP(r.monto)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.multas > 0 ? formatCLP(r.multas) : '—'}</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{formatCLP(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })()}

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

    </div>
  )
}

/**
 * The debt, temporada by temporada (D13). Each season shows its own cuota,
 * cargos and multa rather than one aggregate figure, because each is priced at
 * its own `valor_accion` and `monto_multa_por_accion` — a single total is
 * impossible to check against paper.
 */
function DeudaBreakdownCard({ deuda }: { deuda: DeudaPorTemporada }) {
  const pendiente = deuda.total_pendiente
  const conDeuda = deuda.temporadas.filter(t => t.pendiente > 0)
  const inicialPendiente = deuda.deuda_inicial.filter(l => l.pendiente > 0)

  if (pendiente <= 0) {
    return (
      <div className="card p-4 flex items-center justify-between border-green-200 bg-green-50">
        <span className="font-semibold text-sm text-gray-700">Estado de deuda</span>
        <span className="text-green-700 font-semibold text-sm">✓ Sin deuda pendiente</span>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden border-amber-200">
      <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
        <span className="font-semibold text-sm text-gray-700">Deuda pendiente</span>
        <span className="text-amber-700 font-bold tabular-nums">{formatCLP(pendiente)}</span>
      </div>

      <div className="divide-y divide-gray-100">
        {inicialPendiente.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-semibold text-gray-600 mb-1.5">Temporadas anteriores al sistema</div>
            <div className="space-y-0.5">
              {inicialPendiente.map(l => (
                <div key={l.id} className="flex justify-between text-xs text-gray-500">
                  <span>{l.concepto}{l.abonado > 0 && ` · abonado ${formatCLP(l.abonado)}`}</span>
                  <span className="tabular-nums">{formatCLP(l.pendiente)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {conDeuda.map(t => (
          <div key={t.temporada_id} className="px-4 py-3">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-xs font-semibold text-gray-600">
                {t.nombre}
                {t.pagada && <span className="ml-2 font-normal text-green-700">cuota pagada</span>}
              </span>
              <span className="text-xs font-semibold text-gray-700 tabular-nums">{formatCLP(t.pendiente)}</span>
            </div>
            <div className="space-y-0.5">
              {t.pendiente_cuota > 0 && (
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Cuota{t.abonado > 0 && ` · abonado ${formatCLP(t.abonado)} de ${formatCLP(t.cuota)}`}</span>
                  <span className="tabular-nums">{formatCLP(t.pendiente_cuota)}</span>
                </div>
              )}
              {t.cargos.filter(c => c.pendiente > 0).map(c => (
                <div key={c.cargo_id} className="flex justify-between text-xs text-gray-500">
                  <span>{c.nombre}{c.abonado > 0 && ` · abonado ${formatCLP(c.abonado)}`}</span>
                  <span className="tabular-nums">{formatCLP(c.pendiente)}</span>
                </div>
              ))}
              {t.pendiente_multa > 0 && (
                <div className="flex justify-between text-xs text-orange-600">
                  <span>Multa por atraso{t.multa_abonada > 0 && ` · abonado ${formatCLP(t.multa_abonada)}`}</span>
                  <span className="tabular-nums">{formatCLP(t.pendiente_multa)}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {deuda.excedente > 0 && (
        <div className="px-4 py-2 bg-green-50 border-t border-green-100 flex justify-between text-xs text-green-700">
          <span>Excedente a favor</span>
          <span className="tabular-nums">{formatCLP(deuda.excedente)}</span>
        </div>
      )}
    </div>
  )
}
