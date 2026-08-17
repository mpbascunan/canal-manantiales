import { usePagoForm } from '../lib/usePagoForm'
import { formatCLP } from '../lib/formulas'
import { nombreCompleto } from '../../../shared/types'
import { DEUDA_TIPO_LABELS } from '../lib/labels'

export default function NuevoPago() {
  const {
    mode, setMode,
    search, showDropdown, setShowDropdown,
    selectedAcc,
    form, setForm,
    abonoForm, setAbonoForm,
    printComprobante, setPrintComprobante,
    existingPago,
    saved,
    confirming, setConfirming,
    activeTemporada,
    temporadas,
    filteredAcc,
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
    cargosDetalle,
    cargosPendientesDetalle,
    totalCargos,
    temporadasConCuota,
    handleSearchChange,
    selectAccionista,
    handleTemporadaChange,
    handleSaveFull,
    handleSaveAbono,
    navigate,
  } = usePagoForm()

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
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Registrar Pago</h1>

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
            Abono
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-4 max-w-2xl mx-auto">
        {/* Shared: accionista search */}
        <div className="relative">
          <label className="label">Accionista</label>
          <input
            className="input"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
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
                  <div className="font-medium">{nombreCompleto(a)}</div>
                  <div className="text-xs text-gray-400">
                    {a.nombres_propiedades ?? ''}
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
            {existingPago && (
              <div className="rounded-md bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-800">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <span>✕</span> Este accionista ya tiene un pago registrado para esta temporada
                </div>
                <div className="text-red-700">
                  Fecha: {existingPago.fecha.split('-').reverse().join('/')} · Total: {formatCLP(existingPago.total)}
                </div>
                {hasUnpaidCargos ? (
                  <div className="mt-1 text-xs text-red-600">
                    Hay cargos pendientes ({formatCLP(pendingCargosAmount)}). Usa la pestaña <strong>Abono</strong> para cubrirlos.
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-red-600">
                    Si necesitas corregir el pago, elimínalo primero desde el historial del accionista.
                  </div>
                )}
              </div>
            )}

            {/* README 7 & 15: this box and the payment detail below used to be
                computed two different ways and disagreed. Both now read the
                same breakdown from `deudores:get-deuda`. */}
            {selectedAcc && !existingPago && deuda && deuda.total_pendiente > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800 flex items-start gap-3">
                <span className="text-lg leading-none">⚠</span>
                <div className="flex-1">
                  <div className="flex justify-between gap-4">
                    <span>Deuda actual</span>
                    <strong className="tabular-nums">{formatCLP(deuda.total_pendiente)}</strong>
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs text-amber-700">
                    {deuda.deuda_inicial.filter(l => l.pendiente > 0).map(l => (
                      <div key={`di-${l.id}`} className="flex justify-between gap-4">
                        <span>{DEUDA_TIPO_LABELS[l.tipo]} · {l.concepto}</span>
                        <span className="tabular-nums">{formatCLP(l.pendiente)}</span>
                      </div>
                    ))}
                    {deuda.temporadas.filter(t => t.pendiente > 0).map(t => (
                      <div key={t.temporada_id} className="flex justify-between gap-4">
                        <span>{t.nombre}</span>
                        <span className="tabular-nums">{formatCLP(t.pendiente)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Temporada</label>
                <select
                  className="input"
                  value={form.temporada_id}
                  onChange={e => handleTemporadaChange(Number(e.target.value))}
                >
                  <option value={0}>— Seleccionar —</option>
                  {temporadas.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input" value={form.fecha}
                  onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div>
                <label className="label">N° Ingreso</label>
                <input type="number" className="input"
                  value={form.numero_ingreso === 0 ? '' : form.numero_ingreso}
                  placeholder="0"
                  onChange={e => setForm(f => ({ ...f, numero_ingreso: e.target.value === '' ? 0 : Number(e.target.value) }))} />
              </div>
            </div>

            <div>
              <label className="label">Notas (opcional)</label>
              <input className="input" value={form.notas}
                onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>

            {selectedAcc && activeTemporada ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-sm font-semibold text-gray-700 mb-2">Detalle del pago</div>
                <div className="space-y-1.5 text-sm text-gray-700">
                  <div className="flex justify-between gap-4">
                    <span>
                      Cuota por acciones
                      <span className="block text-xs text-gray-400">
                        {formatCLP(activeTemporada.valor_accion)} × ({form.acciones_override} acc + {form.hectareas_override} ha) × {form.temporadas_pagadas} temporada{form.temporadas_pagadas !== 1 ? 's' : ''}
                      </span>
                    </span>
                    <span className="tabular-nums font-medium">{formatCLP(form.monto_acciones)}</span>
                  </div>
                  {multaDetalle.map(m => (
                    <div key={m.nombre} className="flex justify-between gap-4 text-amber-700">
                      <span>{m.nombre}</span>
                      <span className="tabular-nums">+ {formatCLP(m.monto)}</span>
                    </div>
                  ))}
                  {cargosDetalle.map(c => (
                    <div key={c.id} className="flex justify-between gap-4 text-indigo-700">
                      <span>{c.nombre}{c.pagado ? ' (pagado)' : ''}</span>
                      <span className="tabular-nums">+ {formatCLP(c.monto)}</span>
                    </div>
                  ))}
                  {yaAbonado > 0 && (
                    <div className="flex justify-between gap-4 text-sky-700">
                      <span>Abonos previos descontados</span>
                      <span className="tabular-nums">− {formatCLP(yaAbonado)}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-2">Selecciona un accionista para ver el detalle del pago</p>
            )}

            <div className="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
              <span className="text-gray-300 font-medium">TOTAL A PAGAR</span>
              <span className="text-white text-2xl font-bold tabular-nums">{formatCLP(totalCompleto)}</span>
            </div>

            <div className="flex gap-3 justify-end">
              <button className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
              <button
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                // Until the deuda arrives every figure on this form is 0, and a
                // pago settles the temporada whatever it says (D2).
                disabled={!!existingPago || !selectedAcc || !deuda}
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
            {existingPago && !hasUnpaidCargos && (
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

            {existingPago && hasUnpaidCargos && (
              <div className="rounded-md bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-800">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <span>⚠</span> Cuota de temporada pagada — hay cargos pendientes
                </div>
                <div className="text-amber-700">
                  Cargos por cubrir: <strong>{formatCLP(pendingCargosAmount)}</strong>
                  {cargosPendientesDetalle.length > 0 && (
                    <span className="ml-1">({cargosPendientesDetalle.map(c => c.nombre).join(', ')})</span>
                  )}
                </div>
              </div>
            )}

            {selectedAcc && activeTemporada && !existingPago && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                <div className="text-sm font-semibold text-amber-800 mb-1">
                  Deuda temporada {activeTemporada.nombre}
                </div>
                <div className="space-y-1.5 text-sm text-gray-700">
                  <div className="flex justify-between gap-4">
                    <span>
                      Cuota por acciones
                      {/* Each season is priced at its own valor_accion (D13), so
                          the active season's rate is only a reference here. */}
                      <span className="block text-xs text-gray-400">
                        {selectedAcc.acciones} acc + {selectedAcc.hectareas} ha · {temporadasConCuota} temporada{temporadasConCuota !== 1 ? 's' : ''} pendiente{temporadasConCuota !== 1 ? 's' : ''}
                      </span>
                    </span>
                    <span className="tabular-nums font-medium">{formatCLP(deuda?.temporadas.reduce((s, t) => s + t.pendiente_cuota, 0) ?? 0)}</span>
                  </div>
                  {multaDetalle.map(m => (
                    <div key={m.nombre} className="flex justify-between gap-4 text-amber-700">
                      <span>{m.nombre}</span>
                      <span className="tabular-nums">+ {formatCLP(m.monto)}</span>
                    </div>
                  ))}
                  {cargosDetalle.map(c => (
                    <div key={c.id} className="flex justify-between gap-4 text-indigo-700">
                      <span>{c.nombre}{c.pagado ? ' (pagado)' : ''}</span>
                      <span className="tabular-nums">+ {formatCLP(c.monto)}</span>
                    </div>
                  ))}
                  {yaAbonado > 0 && (
                    <div className="flex justify-between gap-4 text-sky-700">
                      <span>Abonado previamente</span>
                      <span className="tabular-nums">− {formatCLP(yaAbonado)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 pt-1.5 border-t border-amber-200 font-semibold">
                    <span className="text-amber-800">Pendiente</span>
                    <span className={`tabular-nums ${pendiente > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                      {formatCLP(pendiente)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {selectedAcc && activeTemporada && existingPago && hasUnpaidCargos && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                <div className="text-sm font-semibold text-amber-800 mb-1">
                  Cargos pendientes — {activeTemporada.nombre}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-center">
                    <div className="text-xs text-gray-500 mb-0.5">Total cargos</div>
                    <div className="font-semibold text-gray-800 tabular-nums">{formatCLP(totalCargos)}</div>
                  </div>
                  <div className="text-center border-l border-amber-200">
                    <div className="text-xs text-gray-500 mb-0.5">Pendiente</div>
                    <div className="font-bold text-amber-700 tabular-nums">{formatCLP(pendingCargosAmount)}</div>
                  </div>
                </div>
                {cargosPendientesDetalle.length > 0 && (
                  <div className="pt-2 border-t border-amber-200 space-y-0.5 text-xs text-amber-700">
                    {cargosPendientesDetalle.map(c => (
                      <div key={c.id} className="flex justify-between">
                        <span>{c.nombre}</span>
                        <span className="tabular-nums">{formatCLP(c.monto)}</span>
                      </div>
                    ))}
                  </div>
                )}
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
                <input type="number" className="input"
                  value={abonoForm.numero_ingreso === 0 ? '' : abonoForm.numero_ingreso}
                  placeholder="0"
                  onChange={e => setAbonoForm(f => ({ ...f, numero_ingreso: e.target.value === '' ? 0 : Number(e.target.value) }))} />
              </div>
            </div>

            <div className="bg-canal-50 rounded-lg p-3 space-y-1">
              <div className="flex items-center justify-between">
                <label className="label mb-0">Monto a abonar</label>
                {selectedAcc && pendienteParaAbono > 0 && (
                  <button
                    className="text-xs text-canal-600 hover:underline"
                    onClick={() => setAbonoForm(f => ({ ...f, monto: pendienteParaAbono, multas: 0 }))}
                  >
                    Completar deuda ({formatCLP(pendienteParaAbono)})
                  </button>
                )}
              </div>
              <input
                type="number" min={0}
                className="input bg-white font-semibold text-canal-900"
                value={abonoForm.monto === 0 ? '' : abonoForm.monto}
                onChange={e => setAbonoForm(f => ({ ...f, monto: e.target.value === '' ? 0 : Number(e.target.value) }))}
                placeholder="0"
              />
            </div>

            <div>
              <label className="label">Notas (opcional)</label>
              <input className="input" value={abonoForm.notas}
                onChange={e => setAbonoForm(f => ({ ...f, notas: e.target.value }))} />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={printComprobante} onChange={e => setPrintComprobante(e.target.checked)} />
              Generar comprobante PDF con saldo restante
            </label>

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
                disabled={!selectedAcc || !activeTemporada || abonoTotal <= 0 || (!!existingPago && !hasUnpaidCargos)}
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
              <div className="flex justify-between"><span>Accionista:</span><span className="font-medium">{nombreCompleto(selectedAcc)}</span></div>
              {mode === 'completo' ? (
                <>
                  <div className="flex justify-between"><span>Temporadas:</span><span>{form.temporadas_pagadas}</span></div>
                  <div className="flex justify-between"><span>Cuota por acciones:</span><span>{formatCLP(form.monto_acciones)}</span></div>
                  {form.multas > 0 && (multaDetalle.length > 0
                    ? multaDetalle.map(m => (
                        <div key={m.nombre} className="flex justify-between"><span>{m.nombre}:</span><span>{formatCLP(m.monto)}</span></div>
                      ))
                    : <div className="flex justify-between"><span>Multas:</span><span>{formatCLP(form.multas)}</span></div>
                  )}
                  {totalCargos > 0 && (
                    <>
                      <div className="flex justify-between text-indigo-700"><span>Cargos adicionales:</span><span>+ {formatCLP(totalCargos)}</span></div>
                      {cargosDetalle.map(c => (
                        <div key={c.id} className="flex justify-between text-xs text-indigo-500 pl-3">
                          <span>{c.nombre}{c.pagado ? ' (pagado)' : ''}</span>
                          <span className="tabular-nums">{formatCLP(c.monto)}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {yaAbonado > 0 && <div className="flex justify-between text-sky-700"><span>Abonos previos:</span><span>− {formatCLP(yaAbonado)}</span></div>}
                  <div className="flex justify-between border-t pt-1 font-bold text-gray-900"><span>TOTAL A PAGAR:</span><span>{formatCLP(totalCompleto)}</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span>Monto abonado:</span><span className="font-medium tabular-nums">{formatCLP(abonoTotal)}</span></div>
                  {existingPago && hasUnpaidCargos && cargosPendientesDetalle.length > 0 && (
                    <div className="flex justify-between text-xs text-indigo-500">
                      <span>Cubre cargos:</span>
                      <span className="text-right">{cargosPendientesDetalle.map(c => c.nombre).join(', ')}</span>
                    </div>
                  )}
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
