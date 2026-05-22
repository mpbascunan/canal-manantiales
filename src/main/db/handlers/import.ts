import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { getDb } from '../connection'
import type { ImportResult } from '../../../shared/types'

export interface AccionistaPreviewRow {
  nombre: string
  numero: string | null
  tipo: string
  acciones: number
  hectareas: number
}

export interface AccionistasPreview {
  new_accionistas: AccionistaPreviewRow[]
  new_propiedades: AccionistaPreviewRow[]   // new property for existing customer
  duplicates: AccionistaPreviewRow[]        // already exists, would be skipped
}

export interface PagoPreviewRow {
  numero_ingreso: number
  fecha: string
  accionista_nombre: string
  total: number
}

export interface PagosPreview {
  new_pagos: PagoPreviewRow[]
  duplicates: PagoPreviewRow[]
  missing_accionistas: PagoPreviewRow[]
}

export function registerImportHandlers(): void {
  ipcMain.handle('import:select-file', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Read file bytes in main process and return as Buffer (serialized as Uint8Array over IPC)
  ipcMain.handle('import:read-file', (_e, filePath: string) => {
    return readFileSync(filePath)
  })

  // ── Dry-run preview ─────────────────────────────────────────────────────────

  ipcMain.handle('import:preview-accionistas', (_e, rows: any[]): AccionistasPreview => {
    const db = getDb()
    const findAccionista = db.prepare('SELECT id FROM accionistas WHERE LOWER(TRIM(nombre)) = ?')
    const findPropiedad  = db.prepare(
      `SELECT id FROM propiedades
       WHERE accionista_id = ?
         AND LOWER(TRIM(COALESCE(numero, ''))) = LOWER(TRIM(COALESCE(?, '')))
         AND tipo = ?`
    )

    const new_accionistas: AccionistaPreviewRow[] = []
    const new_propiedades: AccionistaPreviewRow[] = []
    const duplicates: AccionistaPreviewRow[] = []

    for (const row of rows) {
      const name = String(row.nombre ?? '').trim()
      if (!name) continue

      const entry: AccionistaPreviewRow = {
        nombre: name,
        numero: row.numero ?? null,
        tipo: row.tipo,
        acciones: Number(row.acciones ?? 0),
        hectareas: Number(row.hectareas ?? 0)
      }

      const existing = findAccionista.get(name.toLowerCase()) as { id: number } | undefined
      if (existing) {
        const dupProp = findPropiedad.get(existing.id, row.numero ?? '', row.tipo)
        if (dupProp) {
          duplicates.push(entry)
        } else {
          new_propiedades.push(entry)
        }
      } else {
        new_accionistas.push(entry)
      }
    }

    return { new_accionistas, new_propiedades, duplicates }
  })

  ipcMain.handle('import:preview-pagos', (_e, rows: any[], temporadaId: number): PagosPreview => {
    const db = getDb()
    const findAccionista = db.prepare('SELECT id FROM accionistas WHERE LOWER(TRIM(nombre)) = ? LIMIT 1')
    const existsPago = db.prepare('SELECT id FROM pagos WHERE numero_ingreso = ?')

    const new_pagos: PagoPreviewRow[] = []
    const duplicates: PagoPreviewRow[] = []
    const missing_accionistas: PagoPreviewRow[] = []

    for (const row of rows) {
      if (!row.numero_ingreso) continue
      const entry: PagoPreviewRow = {
        numero_ingreso: row.numero_ingreso,
        fecha: row.fecha,
        accionista_nombre: String(row.accionista_nombre ?? '').trim(),
        total: Number(row.total ?? 0)
      }
      if (existsPago.get(row.numero_ingreso)) {
        duplicates.push(entry)
      } else {
        const acc = findAccionista.get(String(row.accionista_nombre ?? '').toLowerCase().trim())
        if (!acc) {
          missing_accionistas.push(entry)
        } else {
          new_pagos.push(entry)
        }
      }
    }

    return { new_pagos, duplicates, missing_accionistas }
  })

  // ── Actual import ────────────────────────────────────────────────────────────

  ipcMain.handle('import:accionistas', (_e, rows: any[]): ImportResult => {
    const db = getDb()
    let imported = 0      // new accionistas
    let propImported = 0  // new propiedades for existing accionistas
    let skipped = 0
    const errors: string[] = []

    const findAccionista = db.prepare('SELECT id FROM accionistas WHERE LOWER(TRIM(nombre)) = ?')
    const findPropiedad  = db.prepare(
      `SELECT id FROM propiedades
       WHERE accionista_id = ?
         AND LOWER(TRIM(COALESCE(numero, ''))) = LOWER(TRIM(COALESCE(?, '')))
         AND tipo = ?`
    )
    const insertAccionista = db.prepare(
      `INSERT INTO accionistas (numero, nombre, tipo, activo)
       VALUES (@numero, @nombre, @tipo, 1)`
    )
    const insertPropiedad = db.prepare(
      `INSERT INTO propiedades (accionista_id, numero, tipo, acciones, hectareas)
       VALUES (?, ?, ?, ?, ?)`
    )

    db.transaction(() => {
      for (const row of rows) {
        try {
          const name = String(row.nombre ?? '').trim()
          if (!name) { skipped++; continue }

          const existing = findAccionista.get(name.toLowerCase()) as { id: number } | undefined

          if (existing) {
            // Accionista exists — add propiedad only if not already there
            const dupProp = findPropiedad.get(existing.id, row.numero ?? '', row.tipo)
            if (dupProp) { skipped++; continue }
            insertPropiedad.run(
              existing.id,
              row.numero ?? null,
              row.tipo,
              Number(row.acciones ?? 0),
              Number(row.hectareas ?? 0)
            )
            propImported++
          } else {
            // New accionista + first propiedad
            const r = insertAccionista.run({
              numero: row.numero ?? null,
              nombre: name,
              tipo: row.tipo
            })
            insertPropiedad.run(
              r.lastInsertRowid,
              row.numero ?? null,
              row.tipo,
              Number(row.acciones ?? 0),
              Number(row.hectareas ?? 0)
            )
            imported++
          }
        } catch (e: any) {
          errors.push(`${row.nombre}: ${e.message}`)
        }
      }
    })()

    return { imported: imported + propImported, skipped, errors }
  })

  ipcMain.handle('import:pagos', (_e, rows: any[], temporadaId: number): ImportResult => {
    const db = getDb()
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    const findAccionista = db.prepare(`SELECT id FROM accionistas WHERE LOWER(TRIM(nombre)) = ? LIMIT 1`)
    const existsPago = db.prepare('SELECT id FROM pagos WHERE numero_ingreso = ?')
    const insert = db.prepare(
      `INSERT INTO pagos
       (numero_ingreso, accionista_id, temporada_id, fecha, temporadas_pagadas,
        monto_acciones, multas, cuota_extraordinaria, otros_ingresos, total)
       VALUES
       (@numero_ingreso, @accionista_id, @temporada_id, @fecha, @temporadas_pagadas,
        @monto_acciones, @multas, @cuota_extraordinaria, @otros_ingresos, @total)`
    )

    db.transaction(() => {
      for (const row of rows) {
        try {
          if (!row.numero_ingreso) { skipped++; continue }
          if (existsPago.get(row.numero_ingreso)) { skipped++; continue }

          const accionista = findAccionista.get(
            String(row.accionista_nombre ?? '').toLowerCase().trim()
          ) as { id: number } | undefined

          if (!accionista) {
            errors.push(`Accionista no encontrado: "${row.accionista_nombre}" (N°${row.numero_ingreso})`)
            continue
          }

          insert.run({
            numero_ingreso: row.numero_ingreso,
            accionista_id: accionista.id,
            temporada_id: temporadaId,
            fecha: row.fecha,
            temporadas_pagadas: row.temporadas_pagadas ?? 1,
            monto_acciones: Number(row.monto_acciones ?? 0),
            multas: Number(row.multas ?? 0),
            cuota_extraordinaria: Number(row.cuota_extraordinaria ?? 0),
            otros_ingresos: Number(row.otros_ingresos ?? 0),
            total: Number(row.total ?? 0)
          })
          imported++
        } catch (e: any) {
          errors.push(`N°${row.numero_ingreso}: ${e.message}`)
        }
      }
    })()

    return { imported, skipped, errors }
  })
}
