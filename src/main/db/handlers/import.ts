import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { getDb } from '../connection'
import type { ImportResult } from '../../../shared/types'

/** One property line of the listado, as it will be written. */
export interface PropiedadPreviewRow {
  nombre: string | null
  tipo: string
  acciones: number
  hectareas: number
  hoja: string
  fila: number
}

/** Every property of one `N° Socio`, gathered from across the three sheets. */
export interface AccionistaPreviewGroup {
  numero_socio: string
  /** Owner name as the sheet types it (first row wins when spellings differ). */
  nombre: string
  /** Matched accionista, or null when this socio is not in the database yet. */
  accionista_id: number | null
  /** Name already stored, shown only when it differs from the sheet's. */
  nombre_actual: string | null
  /** How many properties the accionista has today — all of them are replaced. */
  propiedades_actuales: number
  propiedades: PropiedadPreviewRow[]
  total_acciones: number
  total_hectareas: number
}

/** A row that carries no `N° Socio`, and so cannot be attributed to anyone. */
export interface PropiedadSinSocio {
  nombre: string
  hoja: string
  fila: number
}

export interface AccionistasPreview {
  /** Socio not in the database — accionista and properties both created. */
  nuevos: AccionistaPreviewGroup[]
  /** Socio already present — its properties are replaced by the sheet's. */
  actualizados: AccionistaPreviewGroup[]
  /** Skipped on import: nothing identifies who they belong to. */
  sin_socio: PropiedadSinSocio[]
}

export interface PagoPreviewRow {
  numero_ingreso: number
  fecha: string
  accionista_nombre: string
  total: number
  /** Row in the sheet, so a warning can be traced back to the spreadsheet. */
  fila: number
  /** Amount sitting in columns the system does not record. */
  otros: number
  numero_socio: string | null
  /** How this row found its accionista, when it did. */
  matched_by?: 'numero_socio' | 'nombre' | 'manual'
}

/** A candidate accionista for a name the sheet spells differently. */
export interface Sugerencia {
  accionista_id: number
  nombre: string
  numero_socio: string | null
  /** 0-100. Only ever shown to the user; nothing is matched on it. */
  score: number
}

/**
 * One spreadsheet name that matched nobody, with everything needed to decide who
 * it is. Grouped by name rather than listed per payment: the same person pays
 * several times, and the decision is about the person, not the receipt.
 */
export interface NombreSinCoincidencia {
  nombre: string
  pagos: PagoPreviewRow[]
  total: number
  sugerencias: Sugerencia[]
}

export interface PagosPreview {
  new_pagos: PagoPreviewRow[]
  /** That N° Ingreso is already in the database — the row is skipped. */
  duplicates: PagoPreviewRow[]
  /** Two rows of the *same file* share a N° Ingreso; only the first is kept. */
  duplicados_en_archivo: PagoPreviewRow[]
  missing_accionistas: PagoPreviewRow[]
  /** The same rows as `missing_accionistas`, grouped by name with suggestions. */
  sin_coincidencia: NombreSinCoincidencia[]
  /**
   * Rows carrying money in `Cuota extraordinaria` or `Otros ingresos` — columns
   * the system has nowhere to record. They are **not** imported: bringing in a
   * total whose breakdown cannot be reproduced would put a figure in the resumen
   * contable that no screen can explain. They are listed so they can be entered
   * by hand, which is also the only way to decide what each amount really is.
   */
  con_otros_ingresos: PagoPreviewRow[]
  /** What the whole file adds up to, against what is actually importable. */
  total_archivo: number
  total_importable: number
}

export interface DeudaInicialPreviewRow {
  numero_socio: string | null
  accionista_nombre: string
  concepto: string
  tipo: 'CUOTA' | 'MULTA'
  monto: number
  fila: number
  /** How the row was matched, so the preview can show why it is where it is. */
  matched_by?: 'numero_socio' | 'nombre'
}

export interface DeudaInicialPreview {
  /** Matched to an accionista who has no lines yet. */
  new_lineas: DeudaInicialPreviewRow[]
  /** Matched, but that accionista already has lines — importing replaces them. */
  reemplaza: DeudaInicialPreviewRow[]
  /** No accionista matched; these are skipped on import. */
  missing_accionistas: DeudaInicialPreviewRow[]
}

/**
 * The key two names are compared by.
 *
 * Done here rather than in SQL because SQLite's `LOWER()` only touches A–Z:
 * against the association's listado, which is typed in capitals, that left every
 * name containing É, Í or Ñ permanently unmatchable — 53 of 410 accionistas.
 * Accents are folded for the same reason, since the same person is written
 * "GONZALEZ" on one sheet and "González" on the other.
 */
export function claveNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

interface AccionistaConocido {
  id: number
  nombre_completo: string
  numero_socio: string | null
  tokens: Set<string>
}

/** A word worth comparing — "de", "y", "del" say nothing about who someone is. */
const RUIDO = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el'])

function tokens(nombre: string): Set<string> {
  return new Set(claveNombre(nombre).split(' ').filter(t => t.length > 1 && !RUIDO.has(t)))
}

/**
 * The accionistas a spreadsheet can be matched against, indexed every way the
 * import needs: by socio number, by normalised name, and by tokens for
 * suggesting a match when neither lands.
 */
export function buildDirectorio(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(
    `SELECT id, nombre, apellido_paterno, apellido_materno, numero_socio FROM accionistas`
  ).all() as {
    id: number; nombre: string; apellido_paterno: string | null
    apellido_materno: string | null; numero_socio: string | null
  }[]

  const porNombre = new Map<string, number>()
  const porSocio = new Map<string, number>()
  const todos: AccionistaConocido[] = []

  for (const r of rows) {
    const completo = [r.nombre, r.apellido_paterno, r.apellido_materno].filter(Boolean).join(' ')
    // First writer wins, so a later duplicate never silently steals the name.
    for (const clave of new Set([claveNombre(completo), claveNombre(r.nombre)])) {
      if (clave && !porNombre.has(clave)) porNombre.set(clave, r.id)
    }
    const socio = r.numero_socio?.trim()
    if (socio && !porSocio.has(socio)) porSocio.set(socio, r.id)
    todos.push({ id: r.id, nombre_completo: completo, numero_socio: r.numero_socio, tokens: tokens(completo) })
  }

  /** Socio number first, then name — never a guess. */
  const buscar = (socio: string | null, nombre: string): { id: number; by: 'numero_socio' | 'nombre' } | null => {
    const s = socio?.trim()
    if (s) {
      const id = porSocio.get(s)
      if (id !== undefined) return { id, by: 'numero_socio' }
    }
    const id = porNombre.get(claveNombre(nombre))
    return id === undefined ? null : { id, by: 'nombre' }
  }

  /**
   * Closest accionistas to a name that matched nothing, best first.
   *
   * Scored by how much of the spreadsheet's name is accounted for, which is what
   * makes "María Patricia Figueroa C." land on "MARIA PATRICIA FIGUEROA
   * CUBILLOS": every word of the former appears in the latter. Suggestions are
   * only ever offered to the user — nothing is matched on a score.
   */
  const sugerir = (nombre: string, limite = 6): Sugerencia[] => {
    const buscados = tokens(nombre)
    if (buscados.size === 0) return []
    return todos
      .map(a => {
        let comunes = 0
        for (const t of buscados) if (a.tokens.has(t)) comunes++
        // Penalise a candidate carrying many words the sheet never mentioned.
        const cobertura = comunes / buscados.size
        const precision = comunes / Math.max(a.tokens.size, 1)
        return {
          accionista_id: a.id,
          nombre: a.nombre_completo,
          numero_socio: a.numero_socio,
          score: Math.round((cobertura * 0.75 + precision * 0.25) * 100)
        }
      })
      .filter(s => s.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, limite)
  }

  return { buscar, sugerir, porNombre }
}

/**
 * Finds the accionista a spreadsheet row refers to.
 *
 * `numero_socio` is tried first: the association assigns it, so it identifies a
 * person outright, where names are typed inconsistently and repeat across
 * families. Falls back to the full name, matched the way the pagos import does.
 */
function buildAccionistaMatcher(db: ReturnType<typeof getDb>) {
  return buildDirectorio(db).buscar
}

/**
 * Collapses the listado's property rows into one entry per `N° Socio`.
 *
 * The socio number is the only key used: it is assigned by the association, so
 * it identifies a person outright, where the same socio is typed four different
 * ways across their four rows ("ARTEMIO CORNEJO" / "ARTEMIO CORNEJO MORAGA").
 * The first row's spelling names the group, and rows with no socio number are
 * handed back separately rather than guessed at.
 */
function groupBySocio(rows: any[]): {
  grupos: Map<string, AccionistaPreviewGroup>
  sin_socio: PropiedadSinSocio[]
} {
  const grupos = new Map<string, AccionistaPreviewGroup>()
  const sin_socio: PropiedadSinSocio[] = []

  for (const row of rows) {
    const socio = String(row.numero_socio ?? '').trim()
    const nombre = String(row.nombre ?? '').trim()
    const hoja = String(row.hoja ?? '')
    const fila = Number(row.fila ?? 0)

    if (!socio || !nombre) {
      sin_socio.push({ nombre, hoja, fila })
      continue
    }

    let grupo = grupos.get(socio)
    if (!grupo) {
      grupo = {
        numero_socio: socio,
        nombre,
        accionista_id: null,
        nombre_actual: null,
        propiedades_actuales: 0,
        propiedades: [],
        total_acciones: 0,
        total_hectareas: 0
      }
      grupos.set(socio, grupo)
    }

    const acciones = Number(row.acciones ?? 0)
    const hectareas = Number(row.hectareas ?? 0)

    grupo.propiedades.push({
      nombre: (row.nombre_propiedad ?? null) || null,
      tipo: row.tipo,
      acciones,
      hectareas,
      hoja,
      fila
    })
    grupo.total_acciones += acciones
    grupo.total_hectareas += hectareas
  }

  return { grupos, sin_socio }
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
    const findSocio = db.prepare(
      `SELECT a.id, a.nombre, a.apellido_paterno, a.apellido_materno,
              (SELECT COUNT(*) FROM propiedades p WHERE p.accionista_id = a.id) AS props
       FROM accionistas a
       WHERE a.numero_socio IS NOT NULL AND TRIM(a.numero_socio) = ?
       LIMIT 1`
    )

    const { grupos, sin_socio } = groupBySocio(rows)
    const nuevos: AccionistaPreviewGroup[] = []
    const actualizados: AccionistaPreviewGroup[] = []

    for (const grupo of grupos.values()) {
      const existing = findSocio.get(grupo.numero_socio) as
        | { id: number; nombre: string; apellido_paterno: string | null; apellido_materno: string | null; props: number }
        | undefined

      if (!existing) {
        nuevos.push(grupo)
        continue
      }

      const actual = [existing.nombre, existing.apellido_paterno, existing.apellido_materno]
        .filter(Boolean).join(' ')
      grupo.accionista_id = existing.id
      grupo.propiedades_actuales = existing.props
      // Only worth showing when it disagrees with the sheet — the stored name is
      // kept, since it may have been split into apellidos or corrected by hand.
      grupo.nombre_actual = actual.toLowerCase() === grupo.nombre.toLowerCase() ? null : actual
      actualizados.push(grupo)
    }

    return { nuevos, actualizados, sin_socio }
  })

  // temporadaId is part of the channel signature but unused: duplicates are
  // detected by numero_ingreso, which is unique across seasons.
  ipcMain.handle('import:preview-pagos', (_e, rows: any[], _temporadaId: number): PagosPreview => {
    const db = getDb()
    const { buscar, sugerir } = buildDirectorio(db)
    const existsPago = db.prepare('SELECT id FROM pagos WHERE numero_ingreso = ?')

    const new_pagos: PagoPreviewRow[] = []
    const duplicates: PagoPreviewRow[] = []
    const duplicados_en_archivo: PagoPreviewRow[] = []
    const missing_accionistas: PagoPreviewRow[] = []
    const con_otros_ingresos: PagoPreviewRow[] = []

    // The import keys on numero_ingreso, so a number reused inside the file
    // means the second row is dropped without a word. Caught here instead.
    const vistos = new Set<number>()
    let total_archivo = 0

    for (const row of rows) {
      const entry: PagoPreviewRow = {
        numero_ingreso: Number(row.numero_ingreso ?? 0),
        fecha: row.fecha,
        accionista_nombre: String(row.accionista_nombre ?? '').trim(),
        total: Number(row.total ?? 0),
        fila: Number(row.fila ?? 0),
        otros: Number(row.otros ?? 0),
        numero_socio: row.numero_socio ?? null
      }
      total_archivo += entry.total
      if (!entry.numero_ingreso) continue

      // Excluded outright, before anything else claims the receipt number: the
      // system cannot represent what these rows are, so they are for the user to
      // enter by hand rather than to guess at here.
      if (entry.otros !== 0) {
        con_otros_ingresos.push(entry)
        continue
      }

      if (vistos.has(entry.numero_ingreso)) {
        duplicados_en_archivo.push(entry)
        continue
      }
      vistos.add(entry.numero_ingreso)

      if (existsPago.get(entry.numero_ingreso)) {
        duplicates.push(entry)
        continue
      }

      const hit = buscar(entry.numero_socio, entry.accionista_nombre)
      if (hit) {
        entry.matched_by = hit.by
        new_pagos.push(entry)
      } else {
        missing_accionistas.push(entry)
      }
    }

    // One decision per person, not per receipt: the same misspelling shows up on
    // every payment they made, and suggestions are expensive enough to be worth
    // computing once per distinct name.
    const porNombreSinMatch = new Map<string, PagoPreviewRow[]>()
    for (const p of missing_accionistas) {
      const lista = porNombreSinMatch.get(p.accionista_nombre) ?? []
      lista.push(p)
      porNombreSinMatch.set(p.accionista_nombre, lista)
    }
    const sin_coincidencia: NombreSinCoincidencia[] = [...porNombreSinMatch]
      .map(([nombre, pagos]) => ({
        nombre,
        pagos,
        total: pagos.reduce((s, p) => s + p.total, 0),
        sugerencias: sugerir(nombre)
      }))
      .sort((a, b) => b.total - a.total)

    return {
      new_pagos, duplicates, duplicados_en_archivo, missing_accionistas,
      sin_coincidencia, con_otros_ingresos,
      total_archivo,
      total_importable: new_pagos.reduce((s, p) => s + p.total, 0)
    }
  })

  // ── Actual import ────────────────────────────────────────────────────────────

  /**
   * Loads the listado. The file is authoritative about who owns what, so for
   * every socio it names, the stored properties are dropped and rewritten —
   * otherwise a corrected accionaje or a subdivision would never take effect.
   * Accionistas absent from the file are left untouched, as is the name of the
   * ones present, which may have been split into apellidos or fixed by hand.
   */
  ipcMain.handle('import:accionistas', (_e, rows: any[]): ImportResult => {
    const db = getDb()
    let imported = 0   // propiedades written
    let skipped = 0    // rows that could not be attributed to a socio
    const errors: string[] = []

    const findSocio = db.prepare(
      `SELECT id FROM accionistas
       WHERE numero_socio IS NOT NULL AND TRIM(numero_socio) = ? LIMIT 1`
    )
    const insertAccionista = db.prepare(
      'INSERT INTO accionistas (nombre, numero_socio, activo) VALUES (?, ?, 1)'
    )
    const wipePropiedades = db.prepare('DELETE FROM propiedades WHERE accionista_id = ?')
    const insertPropiedad = db.prepare(
      `INSERT INTO propiedades (accionista_id, nombre, tipo, acciones, hectareas)
       VALUES (?, ?, ?, ?, ?)`
    )

    const { grupos, sin_socio } = groupBySocio(rows)
    skipped = sin_socio.length
    for (const row of sin_socio) {
      errors.push(`${row.hoja} fila ${row.fila}: sin N° Socio${row.nombre ? ` ("${row.nombre}")` : ''}`)
    }

    db.transaction(() => {
      for (const grupo of grupos.values()) {
        try {
          const existing = findSocio.get(grupo.numero_socio) as { id: number } | undefined
          const accionistaId = existing
            ? existing.id
            : (insertAccionista.run(grupo.nombre, grupo.numero_socio).lastInsertRowid as number)

          wipePropiedades.run(accionistaId)
          for (const p of grupo.propiedades) {
            insertPropiedad.run(accionistaId, p.nombre, p.tipo, p.acciones, p.hectareas)
            imported++
          }
        } catch (e: any) {
          errors.push(`N° Socio ${grupo.numero_socio} (${grupo.nombre}): ${e.message}`)
        }
      }
    })()

    return { imported, skipped, errors }
  })

  /**
   * `asignaciones` maps a spreadsheet name to the accionista the user picked for
   * it in the preview, for the names no key could resolve. It is consulted only
   * after N° Socio and the name itself have both failed, so a confirmed choice
   * can never override a real match.
   */
  ipcMain.handle('import:pagos', (
    _e, rows: any[], temporadaId: number, asignaciones: Record<string, number> = {}
  ): ImportResult => {
    const db = getDb()
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    const { buscar } = buildDirectorio(db)
    const manual = new Map<string, number>(
      Object.entries(asignaciones ?? {}).map(([nombre, id]) => [claveNombre(nombre), Number(id)])
    )
    const existsPago = db.prepare('SELECT id FROM pagos WHERE numero_ingreso = ?')
    const insert = db.prepare(
      `INSERT INTO pagos
       (numero_ingreso, accionista_id, temporada_id, fecha, temporadas_pagadas,
        monto_acciones, multas, total)
       VALUES
       (@numero_ingreso, @accionista_id, @temporada_id, @fecha, @temporadas_pagadas,
        @monto_acciones, @multas, @total)`
    )

    db.transaction(() => {
      for (const row of rows) {
        try {
          if (!row.numero_ingreso) { skipped++; continue }
          if (existsPago.get(row.numero_ingreso)) { skipped++; continue }

          // Cuota extraordinaria / otros ingresos: no column holds them, so the
          // row is left for the user rather than imported with a total that its
          // own breakdown cannot account for.
          if (Number(row.otros ?? 0) !== 0) {
            skipped++
            errors.push(
              `N°${row.numero_ingreso} "${row.accionista_nombre}": tiene cuota extraordinaria u otros ingresos, regístralo manualmente`
            )
            continue
          }

          const nombre = String(row.accionista_nombre ?? '')
          const accionistaId =
            buscar(row.numero_socio ?? null, nombre)?.id ?? manual.get(claveNombre(nombre))

          if (accionistaId === undefined) {
            errors.push(`Accionista no encontrado: "${row.accionista_nombre}" (N°${row.numero_ingreso})`)
            continue
          }

          insert.run({
            numero_ingreso: row.numero_ingreso,
            accionista_id: accionistaId,
            temporada_id: temporadaId,
            fecha: row.fecha,
            temporadas_pagadas: row.temporadas_pagadas ?? 1,
            monto_acciones: Number(row.monto_acciones ?? 0),
            multas: Number(row.multas ?? 0),
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

  registerDeudaInicialImport()
}

/**
 * Opening balances (context.md D14). Registered separately from the handlers
 * above only to keep this file navigable — `registerImportHandlers` calls it.
 */
function registerDeudaInicialImport(): void {
  ipcMain.handle('import:preview-deuda-inicial', (_e, rows: any[]): DeudaInicialPreview => {
    const db = getDb()
    const match = buildAccionistaMatcher(db)
    const hasLineas = db.prepare('SELECT 1 FROM deuda_inicial WHERE accionista_id = ? LIMIT 1')

    const new_lineas: DeudaInicialPreviewRow[] = []
    const reemplaza: DeudaInicialPreviewRow[] = []
    const missing_accionistas: DeudaInicialPreviewRow[] = []

    for (const row of rows) {
      const entry: DeudaInicialPreviewRow = {
        numero_socio: row.numero_socio ?? null,
        accionista_nombre: String(row.accionista_nombre ?? '').trim(),
        concepto: String(row.concepto ?? '').trim(),
        tipo: row.tipo === 'CUOTA' ? 'CUOTA' : 'MULTA',
        monto: Math.round(Number(row.monto ?? 0)),
        fila: Number(row.fila ?? 0)
      }

      const hit = match(entry.numero_socio, entry.accionista_nombre)
      if (!hit) {
        missing_accionistas.push(entry)
        continue
      }
      entry.matched_by = hit.by
      if (hasLineas.get(hit.id)) reemplaza.push(entry)
      else new_lineas.push(entry)
    }

    return { new_lineas, reemplaza, missing_accionistas }
  })

  ipcMain.handle('import:deuda-inicial', (_e, rows: any[]): ImportResult => {
    const db = getDb()
    const match = buildAccionistaMatcher(db)
    let imported = 0
    let skipped = 0
    const errors: string[] = []

    db.transaction(() => {
      // Group by accionista first: importing is a *replace* per person, so the
      // whole set of their lines has to be known before anything is deleted.
      const porAccionista = new Map<number, any[]>()

      for (const row of rows) {
        const nombre = String(row.accionista_nombre ?? '').trim()
        const hit = match(row.numero_socio ?? null, nombre)
        if (!hit) {
          skipped++
          errors.push(`Fila ${row.fila}: no se encontró el accionista "${nombre}"`)
          continue
        }
        const lista = porAccionista.get(hit.id) ?? []
        lista.push(row)
        porAccionista.set(hit.id, lista)
      }

      const wipe = db.prepare('DELETE FROM deuda_inicial WHERE accionista_id = ?')
      const insert = db.prepare(
        `INSERT INTO deuda_inicial (accionista_id, concepto, tipo, monto, notas)
         VALUES (@accionista_id, @concepto, @tipo, @monto, @notas)`
      )

      for (const [accionistaId, lineas] of porAccionista) {
        wipe.run(accionistaId)
        for (const linea of lineas) {
          insert.run({
            accionista_id: accionistaId,
            concepto: String(linea.concepto ?? '').trim() || 'Deuda temporadas anteriores',
            tipo: linea.tipo === 'CUOTA' ? 'CUOTA' : 'MULTA',
            monto: Math.round(Number(linea.monto ?? 0)),
            notas: `Importado desde Excel, fila ${linea.fila}`
          })
          imported++
        }
      }
    })()

    return { imported, skipped, errors }
  })
}
