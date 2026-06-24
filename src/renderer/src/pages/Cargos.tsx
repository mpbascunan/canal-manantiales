import { useEffect, useState, useMemo } from 'react'
import { api } from '../lib/ipc'
import { formatCLP, toISODate } from '../lib/formulas'
import type { Cargo, CargoConAccionistas, Accionista, Temporada } from '../../../shared/types'
import { nombreCompleto } from '../../../shared/types'

export default function Cargos() {
  const [temporadas, setTemporadas] = useState<Temporada[]>([])
  const [accionistas, setAccionistas] = useState<Accionista[]>([])
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [selectedTemporadaId, setSelectedTemporadaId] = useState<number>(0)

  // Expanded cargo detail
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedData, setExpandedData] = useState<CargoConAccionistas | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Create form
  const [showForm, setShowForm] = useState(false)
  const [formNombrePreset, setFormNombrePreset] = useState('')
  const [formNombreCustom, setFormNombreCustom] = useState('')
  const [formTipoTarifa, setFormTipoTarifa] = useState<'proporcional' | 'fija'>('proporcional')
  const [formTarifa, setFormTarifa] = useState<number>(0)
  const [formFecha, setFormFecha] = useState(toISODate(new Date()))
  const [formNotas, setFormNotas] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [searchForm, setSearchForm] = useState('')
  const [saving, setSaving] = useState(false)

  const NOMBRES_PREDEFINIDOS = [
    'Limpieza acequia',
    'Multa por inasistencia a reunion',
    'Multa por inasistencia a votaciones',
    'Cuota extraordinaria'
  ]
  const formNombre = formNombrePreset === '__custom__' ? formNombreCustom : formNombrePreset

  // Add-accionistas panel (inside expanded detail)
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [addSelectedIds, setAddSelectedIds] = useState<Set<number>>(new Set())
  const [addingSaving, setAddingSaving] = useState(false)

  useEffect(() => {
    Promise.all([api.temporadas.list(), api.accionistas.list()]).then(([ts, as]) => {
      setTemporadas(ts)
      setAccionistas(as)
      const active = ts.find((t: Temporada) => t.activa)
      if (active) setSelectedTemporadaId(active.id)
    })
  }, [])

  useEffect(() => {
    if (selectedTemporadaId) {
      api.cargos.listByTemporada(selectedTemporadaId).then(setCargos)
      setExpandedId(null)
      setExpandedData(null)
    }
  }, [selectedTemporadaId])

  const reloadList = () => {
    if (selectedTemporadaId) api.cargos.listByTemporada(selectedTemporadaId).then(setCargos)
  }

  const loadDetail = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); setExpandedData(null); return }
    setExpandedId(id)
    setExpandedData(null)
    setLoadingDetail(true)
    setShowAddPanel(false)
    setAddSelectedIds(new Set())
    const data = await api.cargos.getWithAccionistas(id)
    setExpandedData(data)
    setLoadingDetail(false)
  }

  // ── Create form helpers ────────────────────────────────────────────────────
  const filteredFormAcc = useMemo(
    () => accionistas.filter(a => nombreCompleto(a).toLowerCase().includes(searchForm.toLowerCase())),
    [accionistas, searchForm]
  )
  const allVisible = filteredFormAcc.length > 0 && filteredFormAcc.every(a => selectedIds.has(a.id))

  const toggleAll = () => {
    if (allVisible) {
      setSelectedIds(prev => { const n = new Set(prev); filteredFormAcc.forEach(a => n.delete(a.id)); return n })
    } else {
      setSelectedIds(prev => { const n = new Set(prev); filteredFormAcc.forEach(a => n.add(a.id)); return n })
    }
  }

  // Preview: estimated monto per selected accionista
  const previewTotal = useMemo(() => {
    if (formTarifa <= 0) return 0
    const selected = accionistas.filter(a => selectedIds.has(a.id))
    if (formTipoTarifa === 'fija') return formTarifa * selected.length
    return selected.reduce((sum, a) => sum + formTarifa * (a.acciones + a.hectareas), 0)
  }, [accionistas, selectedIds, formTarifa, formTipoTarifa])

  const handleCreate = async () => {
    if (!formNombre.trim()) return alert('Ingresa un nombre para el cargo')
    if (formTarifa <= 0) return alert('La tarifa debe ser mayor a 0')
    if (selectedIds.size === 0) return alert('Selecciona al menos un accionista')
    setSaving(true)
    await api.cargos.create({
      nombre: formNombre.trim(),
      temporada_id: selectedTemporadaId,
      tarifa: formTarifa,
      tipo_tarifa: formTipoTarifa,
      fecha: formFecha,
      notas: formNotas || null,
      accionista_ids: Array.from(selectedIds)
    })
    setSaving(false)
    setShowForm(false)
    resetForm()
    reloadList()
  }

  const resetForm = () => {
    setFormNombrePreset(''); setFormNombreCustom(''); setFormTarifa(0)
    setFormTipoTarifa('proporcional'); setFormFecha(toISODate(new Date()))
    setFormNotas(''); setSelectedIds(new Set()); setSearchForm('')
  }

  // ── Delete cargo ───────────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este cargo y todos sus registros de accionistas?')) return
    await api.cargos.delete(id)
    if (expandedId === id) { setExpandedId(null); setExpandedData(null) }
    reloadList()
  }

  // ── Toggle pagado ──────────────────────────────────────────────────────────
  const handleTogglePagado = async (cargoId: number, accionistaId: number, current: boolean) => {
    await api.cargos.setPagado(cargoId, accionistaId, !current)
    const updated = await api.cargos.getWithAccionistas(cargoId)
    setExpandedData(updated)
    reloadList()
  }

  // ── Remove accionista from cargo ───────────────────────────────────────────
  const handleRemoveAccionista = async (cargoId: number, accionistaId: number) => {
    if (!confirm('¿Quitar este accionista del cargo?')) return
    await api.cargos.removeAccionista(cargoId, accionistaId)
    const updated = await api.cargos.getWithAccionistas(cargoId)
    setExpandedData(updated)
    reloadList()
  }

  // ── Add-accionistas panel ──────────────────────────────────────────────────
  const existingIds = useMemo(
    () => new Set((expandedData?.accionistas ?? []).map(a => a.id)),
    [expandedData]
  )
  const addableAccionistas = useMemo(
    () => accionistas.filter(a => !existingIds.has(a.id) && nombreCompleto(a).toLowerCase().includes(addSearch.toLowerCase())),
    [accionistas, existingIds, addSearch]
  )

  const handleAddAccionistas = async () => {
    if (addSelectedIds.size === 0 || !expandedId) return
    setAddingSaving(true)
    await api.cargos.addAccionistas(expandedId, Array.from(addSelectedIds))
    setAddingSaving(false)
    setShowAddPanel(false)
    setAddSelectedIds(new Set())
    setAddSearch('')
    const updated = await api.cargos.getWithAccionistas(expandedId)
    setExpandedData(updated)
    reloadList()
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalMonto = cargos.reduce((s, c) => s + (c.total_monto ?? 0), 0)
  const totalPagado = cargos.reduce((s, c) => s + ((c.pagados_count ?? 0) / Math.max(c.accionista_count ?? 1, 1)) * (c.total_monto ?? 0), 0)

  const activeTemporada = temporadas.find(t => t.id === selectedTemporadaId)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cargos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cobros adicionales
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)} disabled={!selectedTemporadaId}>
          + Nuevo cargo
        </button>
      </div>

      {/* Temporada selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Temporada:</label>
        <select
          className="input w-48"
          value={selectedTemporadaId}
          onChange={e => setSelectedTemporadaId(Number(e.target.value))}
        >
          <option value={0}>— Seleccionar —</option>
          {temporadas.map(t => (
            <option key={t.id} value={t.id}>{t.nombre}{t.activa ? ' (activa)' : ''}</option>
          ))}
        </select>
      </div>

      {/* Summary */}
      {selectedTemporadaId > 0 && cargos.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="text-xs text-gray-500 mb-1">Tipos de cargo</div>
            <div className="text-xl font-bold text-gray-800">{cargos.length}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-gray-500 mb-1">Monto total emitido</div>
            <div className="text-xl font-bold text-gray-800 tabular-nums">{formatCLP(totalMonto)}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-gray-500 mb-1">Accionistas con cargos</div>
            <div className="text-xl font-bold text-indigo-700">
              {cargos.reduce((s, c) => s + (c.accionista_count ?? 0), 0)}
            </div>
          </div>
        </div>
      )}

      {/* Cargo list */}
      {selectedTemporadaId > 0 && (
        <div className="card overflow-hidden">
          {cargos.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              No hay cargos registrados para esta temporada.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {cargos.map(cargo => (
                <div key={cargo.id}>
                  {/* Header row */}
                  <div
                    className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => loadDetail(cargo.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{cargo.nombre}</span>
                        <span className="text-xs text-gray-400">
                          {cargo.tipo_tarifa === 'fija'
                            ? `monto fijo ${formatCLP(cargo.tarifa)} / accionista`
                            : `tarifa ${formatCLP(cargo.tarifa)} / (acc + ha)`}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {cargo.fecha.split('-').reverse().join('/')}
                        {cargo.notas && <span className="ml-2 italic">{cargo.notas}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums text-gray-800">
                        {formatCLP(cargo.total_monto ?? 0)}
                      </div>
                      <div className="text-xs text-gray-400">
                        {cargo.accionista_count ?? 0} accionistas ·{' '}
                        <span className={
                          (cargo.pagados_count ?? 0) === (cargo.accionista_count ?? 0) && (cargo.accionista_count ?? 0) > 0
                            ? 'text-green-600 font-medium'
                            : 'text-amber-600'
                        }>
                          {cargo.pagados_count ?? 0}/{cargo.accionista_count ?? 0} pagados
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-gray-400 text-xs">{expandedId === cargo.id ? '▲' : '▼'}</span>
                      <button
                        className="text-gray-400 hover:text-red-500 transition-colors text-xs px-1"
                        onClick={e => { e.stopPropagation(); handleDelete(cargo.id) }}
                        title="Eliminar cargo"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Expanded accionistas list */}
                  {expandedId === cargo.id && (
                    <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 space-y-3">
                      {loadingDetail ? (
                        <div className="text-sm text-gray-400 py-2">Cargando…</div>
                      ) : expandedData ? (
                        <>
                          {/* Accionistas table */}
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-gray-500 border-b border-gray-200">
                                <th className="text-left py-1.5 pr-4 font-medium">Accionista</th>
                                <th className="text-right py-1.5 pr-4 font-medium">Acc + Ha</th>
                                <th className="text-right py-1.5 pr-4 font-medium">Monto</th>
                                <th className="text-center py-1.5 pr-4 font-medium">Estado</th>
                                <th className="py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {expandedData.accionistas.map(a => (
                                <tr key={a.id} className="hover:bg-white transition-colors">
                                  <td className="py-2 pr-4 font-medium text-gray-800">{a.nombre}</td>
                                  <td className="py-2 pr-4 text-right text-gray-500 tabular-nums">
                                    {a.acciones + a.hectareas}
                                  </td>
                                  <td className="py-2 pr-4 text-right tabular-nums font-medium text-gray-800">
                                    {formatCLP(a.monto)}
                                  </td>
                                  <td className="py-2 pr-4 text-center">
                                    <button
                                      onClick={() => handleTogglePagado(cargo.id, a.id, a.pagado)}
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                                        a.pagado
                                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                          : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                      }`}
                                    >
                                      {a.pagado ? '✓ Pagado' : 'Pendiente'}
                                    </button>
                                  </td>
                                  <td className="py-2 text-right">
                                    <button
                                      onClick={() => handleRemoveAccionista(cargo.id, a.id)}
                                      className="text-gray-300 hover:text-red-400 transition-colors text-xs"
                                      title="Quitar accionista"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Add-accionistas panel */}
                          {!showAddPanel ? (
                            <button
                              className="text-xs text-indigo-600 hover:underline"
                              onClick={() => setShowAddPanel(true)}
                            >
                              + Agregar accionistas
                            </button>
                          ) : (
                            <div className="border border-indigo-200 rounded-md p-3 space-y-2 bg-white">
                              <div className="text-xs font-medium text-indigo-700 mb-1">Agregar accionistas</div>
                              <input
                                className="input text-sm"
                                placeholder="Buscar..."
                                value={addSearch}
                                onChange={e => setAddSearch(e.target.value)}
                              />
                              <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded">
                                {addableAccionistas.length === 0 ? (
                                  <div className="p-3 text-xs text-gray-400 text-center">
                                    {accionistas.length === existingIds.size
                                      ? 'Todos los accionistas ya están asignados'
                                      : 'Sin resultados'}
                                  </div>
                                ) : addableAccionistas.map(a => (
                                  <label key={a.id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 ${addSelectedIds.has(a.id) ? 'bg-indigo-50' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={addSelectedIds.has(a.id)}
                                      onChange={() => {
                                        setAddSelectedIds(prev => {
                                          const n = new Set(prev)
                                          n.has(a.id) ? n.delete(a.id) : n.add(a.id)
                                          return n
                                        })
                                      }}
                                    />
                                    <span className="text-sm text-gray-800">{a.nombre}</span>
                                    <span className="text-xs text-gray-400 ml-auto">
                                      {formatCLP(cargo.tipo_tarifa === 'fija' ? cargo.tarifa : cargo.tarifa * (a.acciones + a.hectareas))}
                                    </span>
                                  </label>
                                ))}
                              </div>
                              <div className="flex gap-2 justify-end">
                                <button className="btn-secondary text-xs py-1 px-3" onClick={() => { setShowAddPanel(false); setAddSelectedIds(new Set()); setAddSearch('') }}>
                                  Cancelar
                                </button>
                                <button
                                  className="btn-primary text-xs py-1 px-3 disabled:opacity-40"
                                  disabled={addSelectedIds.size === 0 || addingSaving}
                                  onClick={handleAddAccionistas}
                                >
                                  {addingSaving ? 'Guardando…' : `Agregar ${addSelectedIds.size > 0 ? addSelectedIds.size : ''}`}
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Create cargo modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Nuevo cargo</h2>
              {activeTemporada && (
                <p className="text-xs text-gray-500 mt-0.5">Temporada: {activeTemporada.nombre}</p>
              )}
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Nombre del cargo</label>
                  <select
                    className="input"
                    value={formNombrePreset}
                    onChange={e => { setFormNombrePreset(e.target.value); if (e.target.value !== '__custom__') setFormNombreCustom('') }}
                  >
                    <option value="">— Seleccionar nombre —</option>
                    {NOMBRES_PREDEFINIDOS.map(n => <option key={n} value={n}>{n}</option>)}
                    <option value="__custom__">Personalizado…</option>
                  </select>
                  {formNombrePreset === '__custom__' && (
                    <input
                      className="input mt-2"
                      placeholder="Nombre personalizado del cargo…"
                      value={formNombreCustom}
                      onChange={e => setFormNombreCustom(e.target.value)}
                      autoFocus
                    />
                  )}
                </div>

                {/* Tipo de tarifa toggle */}
                <div className="col-span-2">
                  <label className="label">Tipo de cobro</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormTipoTarifa('proporcional')}
                      className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                        formTipoTarifa === 'proporcional'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      Proporcional
                      <span className="block text-xs opacity-70 font-normal">tarifa × (acc + ha)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormTipoTarifa('fija')}
                      className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                        formTipoTarifa === 'fija'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      Fija
                      <span className="block text-xs opacity-70 font-normal">igual para todos</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label">
                    {formTipoTarifa === 'fija' ? 'Monto fijo por accionista' : 'Tarifa ($ por acc + ha)'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={formTarifa === 0 ? '' : formTarifa}
                    onChange={e => setFormTarifa(e.target.value === '' ? 0 : Number(e.target.value))}
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formTipoTarifa === 'fija'
                      ? 'Monto idéntico para cada accionista seleccionado'
                      : 'Monto = tarifa × (acciones + hectáreas) por accionista'}
                  </p>
                </div>
                <div>
                  <label className="label">Fecha</label>
                  <input
                    type="date"
                    className="input"
                    value={formFecha}
                    onChange={e => setFormFecha(e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">Notas (opcional)</label>
                  <input
                    className="input"
                    placeholder="Descripción adicional…"
                    value={formNotas}
                    onChange={e => setFormNotas(e.target.value)}
                  />
                </div>
              </div>

              {/* Accionista multi-select */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">
                    Accionistas a cobrar
                    {selectedIds.size > 0 && (
                      <span className="ml-2 text-xs font-normal text-indigo-600">
                        {selectedIds.size} seleccionados
                        {formTarifa > 0 && ` · Total estimado: ${formatCLP(previewTotal)}`}
                      </span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <button type="button" className="text-xs text-indigo-600 hover:underline"
                      onClick={() => setSelectedIds(new Set(accionistas.map(a => a.id)))}>
                      Todos
                    </button>
                    <span className="text-gray-300">|</span>
                    <button type="button" className="text-xs text-gray-500 hover:underline"
                      onClick={() => setSelectedIds(new Set())}>
                      Limpiar
                    </button>
                  </div>
                </div>

                <input
                  className="input mb-2"
                  placeholder="Buscar accionista…"
                  value={searchForm}
                  onChange={e => setSearchForm(e.target.value)}
                />

                <div className="border border-gray-200 rounded-md overflow-hidden">
                  {filteredFormAcc.length > 1 && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                      <input type="checkbox" id="sel-all" checked={allVisible} onChange={toggleAll} className="rounded" />
                      <label htmlFor="sel-all" className="text-xs text-gray-600 cursor-pointer select-none">
                        Seleccionar todos los visibles ({filteredFormAcc.length})
                      </label>
                    </div>
                  )}
                  <div className="max-h-52 overflow-y-auto divide-y divide-gray-100">
                    {filteredFormAcc.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-gray-400 text-center">Sin resultados</div>
                    ) : filteredFormAcc.map(a => (
                      <label
                        key={a.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${selectedIds.has(a.id) ? 'bg-indigo-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(a.id)}
                          onChange={() => setSelectedIds(prev => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n })}
                          className="rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{a.nombre}</div>
                          <div className="text-xs text-gray-400">
                            {a.acciones + a.hectareas} (acc + ha)
                            {a.numeros ? ` · N° ${a.numeros}` : a.numero ? ` · N° ${a.numero}` : ''}
                          </div>
                        </div>
                        {formTarifa > 0 && (
                          <span className="text-xs tabular-nums text-indigo-700 font-medium shrink-0">
                            {formatCLP(formTipoTarifa === 'fija' ? formTarifa : formTarifa * (a.acciones + a.hectareas))}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {selectedIds.size > 0 && formTarifa > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-md px-4 py-2.5 text-sm text-indigo-800">
                  <strong>{selectedIds.size}</strong> accionistas ·{' '}
                  {formTipoTarifa === 'fija'
                    ? <>Monto fijo: <strong>{formatCLP(formTarifa)}</strong></>
                    : <>Tarifa: <strong>{formatCLP(formTarifa)}</strong> / (acc + ha)</>
                  } ·{' '}
                  Total estimado: <strong>{formatCLP(previewTotal)}</strong>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => { setShowForm(false); resetForm() }}>
                Cancelar
              </button>
              <button
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={saving || !formNombre.trim() || formTarifa <= 0 || selectedIds.size === 0}
                onClick={handleCreate}
              >
                {saving ? 'Guardando…' : `Crear cargo (${selectedIds.size} accionistas)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
