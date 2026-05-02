import * as XLSX from 'xlsx'
import type { AccionistaType } from '../../../shared/types'

export interface RawAccionista {
  numero: string | null
  nombre: string
  tipo: AccionistaType
  acciones: number
  hectareas: number
}

export interface RawPago {
  fecha: string
  numero_ingreso: number
  accionista_nombre: string
  temporadas_pagadas: number
  monto_acciones: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total: number
}

function toIso(v: any): string {
  if (!v) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    // Excel date serial
    const d = XLSX.SSF.parse_date_code(v)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`
  }
  const s = String(v)
  // Try dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return s.slice(0, 10)
}

function toNum(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function cleanName(v: any): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ')
}

export function parseAccionistas(buffer: ArrayBuffer): RawAccionista[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const results: RawAccionista[] = []

  const sheetTypeMap: Record<string, AccionistaType> = {
    'PARCELAS': 'PARCELA',
    'SITIOS': 'SITIO',
    'PEQUEÑOS PROPIETARIOS': 'PEQUEÑO_PROPIETARIO'
  }

  for (const sheetName of wb.SheetNames) {
    const tipo = sheetTypeMap[sheetName.toUpperCase().trim()]
    if (!tipo) continue

    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: null
    })

    // Detect header row (has 'Propietario' or 'Accionista')
    let headerIdx = -1
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i]
      if (row.some(v => /propietario|accionista/i.test(String(v ?? '')))) {
        headerIdx = i
        break
      }
    }
    if (headerIdx < 0) continue

    const header = rows[headerIdx].map(v => String(v ?? '').toLowerCase().trim())
    const iNum = header.findIndex(h => /^n[°º]/.test(h) || h === 'n°' || h === 'numero')
    const iProp = header.findIndex(h => /propietario|accionista/.test(h))
    const iAcc = header.findIndex(h => h === 'acciones')
    const iHect = header.findIndex(h => h === 'hectareas' || h === 'hectáreas')

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i]
      const nombre = cleanName(row[iProp])
      if (!nombre || nombre.toUpperCase() === 'TOTALES') continue
      // Skip section repeated headers
      if (/^temporada|^valor acción/i.test(nombre)) continue

      const acciones = iAcc >= 0 ? toNum(row[iAcc]) : 0
      const hectareas = iHect >= 0 ? toNum(row[iHect]) : 0

      results.push({
        numero: iNum >= 0 ? String(row[iNum] ?? '').trim() || null : null,
        nombre,
        tipo,
        acciones,
        hectareas
      })
    }
  }

  return results
}

export function parsePagos(buffer: ArrayBuffer): RawPago[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

  const results: RawPago[] = []

  // Find header rows (FECHA, N° INGRESO, ACCIONISTA, ...)
  const headerPattern = /^fecha$/i
  let inSection = false
  let colFecha = -1, colIngreso = -1, colAcc = -1, colHect = -1,
      colTemps = -1, colMonto = -1, colMultas = -1, colCuota = -1,
      colOtros = -1, colTotal = -1

  for (const row of rows) {
    // Detect new header row
    if (row.some(v => headerPattern.test(String(v ?? '')))) {
      const h = row.map(v => String(v ?? '').toLowerCase().trim())
      colFecha   = h.findIndex(v => v === 'fecha')
      colIngreso = h.findIndex(v => /ingreso/.test(v))
      colAcc     = h.findIndex(v => /accionista/.test(v))
      colHect    = h.findIndex(v => /hectarea/.test(v))
      colTemps   = h.findIndex(v => /temporadas/.test(v) && !/monto/.test(v))
      colMonto   = h.findIndex(v => /monto/.test(v))
      colMultas  = h.findIndex(v => v === 'multas')
      colCuota   = h.findIndex(v => /cuota/.test(v))
      colOtros   = h.findIndex(v => /otros/.test(v))
      colTotal   = h.findIndex(v => v === 'total')
      inSection = true
      continue
    }

    if (!inSection) continue

    const fecha = row[colFecha]
    const numIngreso = row[colIngreso]
    const accionistaNombre = row[colAcc]

    // Skip deudores section
    if (String(accionistaNombre ?? '').toUpperCase().includes('DEUDOR')) break

    if (!fecha || !numIngreso || !accionistaNombre) continue
    if (String(accionistaNombre).toUpperCase() === 'TOTALES') continue

    const isoFecha = toIso(fecha)
    if (!isoFecha || isoFecha.length < 8) continue

    results.push({
      fecha: isoFecha,
      numero_ingreso: toNum(numIngreso),
      accionista_nombre: cleanName(accionistaNombre),
      temporadas_pagadas: toNum(row[colTemps]) || 1,
      monto_acciones: toNum(row[colMonto]),
      multas: toNum(row[colMultas]),
      cuota_extraordinaria: toNum(row[colCuota]),
      otros_ingresos: toNum(row[colOtros]),
      total: toNum(row[colTotal])
    })
  }

  return results
}
