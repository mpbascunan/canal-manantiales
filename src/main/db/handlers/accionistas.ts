import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { AccionistaInput } from '../../../shared/types'

// Reusable SQL fragment: aggregates each accionista's propiedades
const PROPS_AGG = `
  LEFT JOIN (
    SELECT accionista_id,
           SUM(acciones)  AS total_acciones,
           SUM(hectareas) AS total_hectareas,
           GROUP_CONCAT(
             CASE WHEN nombre IS NOT NULL AND TRIM(nombre) != '' THEN nombre ELSE NULL END,
             ', '
           ) AS nombres_propiedades
    FROM propiedades
    GROUP BY accionista_id
  ) pt ON pt.accionista_id = a.id
`

const ACCIONISTA_COLS = `
  a.id, a.nombre, a.apellido_paterno, a.apellido_materno, a.rut, a.numero_socio, a.activo, a.notas,
  COALESCE(pt.total_acciones, 0)   AS acciones,
  COALESCE(pt.total_hectareas, 0) AS hectareas,
  pt.nombres_propiedades           AS nombres_propiedades
`

const SELECT_BASE = `SELECT ${ACCIONISTA_COLS} FROM accionistas a ${PROPS_AGG}`

/**
 * Rejects a `numero_socio` already taken by someone else (D17).
 *
 * A UNIQUE index enforces this whatever happens, but a raw SQLite constraint
 * error tells the administrator nothing about *who* holds the number, and the
 * renderer would only be able to show them the English of it. `excluirId` is the
 * accionista being edited, so re-saving them is not a collision with themselves.
 */
function assertNumeroSocioLibre(
  db: ReturnType<typeof getDb>,
  numeroSocio: string | null | undefined,
  excluirId?: number
): void {
  const numero = numeroSocio?.trim()
  if (!numero) return

  const duenio = db
    .prepare(
      `SELECT id, nombre, apellido_paterno, apellido_materno FROM accionistas
       WHERE TRIM(COALESCE(numero_socio, '')) = ? AND id != ? LIMIT 1`
    )
    .get(numero, excluirId ?? -1) as
    | { nombre: string; apellido_paterno: string | null; apellido_materno: string | null }
    | undefined

  if (duenio) {
    const nombre = [duenio.nombre, duenio.apellido_paterno, duenio.apellido_materno]
      .filter(Boolean).join(' ')
    throw new Error(`El N° socio "${numero}" ya está asignado a ${nombre}`)
  }
}

export function registerAccionistaHandlers(): void {
  ipcMain.handle('accionistas:list', (_e, includeInactive = false) => {
    const where = includeInactive ? '' : 'WHERE a.activo = 1'
    return getDb()
      .prepare(`${SELECT_BASE} ${where} ORDER BY a.nombre`)
      .all()
  })

  ipcMain.handle('accionistas:get', (_e, id: number) => {
    return getDb()
      .prepare(`${SELECT_BASE} WHERE a.id = ?`)
      .get(id) ?? null
  })

  ipcMain.handle('accionistas:create', (_e, input: AccionistaInput) => {
    const db = getDb()
    const props = input.propiedades ?? []
    assertNumeroSocioLibre(db, input.numero_socio)

    const id = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO accionistas (nombre, apellido_paterno, apellido_materno, rut, numero_socio, activo, notas)
           VALUES (@nombre, @apellido_paterno, @apellido_materno, @rut, @numero_socio, @activo, @notas)`
        )
        .run({
          nombre: input.nombre,
          apellido_paterno: input.apellido_paterno ?? null,
          apellido_materno: input.apellido_materno ?? null,
          rut: input.rut ?? null,
          numero_socio: input.numero_socio ?? null,
          activo: input.activo ? 1 : 0,
          notas: input.notas ?? null
        })
      const newId = r.lastInsertRowid as number
      for (const p of props) {
        db.prepare(
          `INSERT INTO propiedades (accionista_id, nombre, tipo, acciones, hectareas, direccion, marco)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(newId, p.nombre ?? null, p.tipo, p.acciones, p.hectareas, p.direccion ?? null, p.marco ?? null)
      }
      return newId
    })()

    return db.prepare(`${SELECT_BASE} WHERE a.id = ?`).get(id)
  })

  ipcMain.handle('accionistas:update', (_e, input: AccionistaInput & { id: number }) => {
    const db = getDb()
    const props = input.propiedades ?? []
    assertNumeroSocioLibre(db, input.numero_socio, input.id)

    db.transaction(() => {
      db.prepare(
        `UPDATE accionistas SET nombre=@nombre, apellido_paterno=@apellido_paterno, apellido_materno=@apellido_materno,
         rut=@rut, numero_socio=@numero_socio, activo=@activo, notas=@notas
         WHERE id=@id`
      ).run({
        id: input.id,
        nombre: input.nombre,
        apellido_paterno: input.apellido_paterno ?? null,
        apellido_materno: input.apellido_materno ?? null,
        rut: input.rut ?? null,
        numero_socio: input.numero_socio ?? null,
        activo: input.activo ? 1 : 0,
        notas: input.notas ?? null
      })
      db.prepare('DELETE FROM propiedades WHERE accionista_id = ?').run(input.id)
      for (const p of props) {
        db.prepare(
          `INSERT INTO propiedades (accionista_id, nombre, tipo, acciones, hectareas, direccion, marco)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(input.id, p.nombre ?? null, p.tipo, p.acciones, p.hectareas, p.direccion ?? null, p.marco ?? null)
      }
    })()

    return db.prepare(`${SELECT_BASE} WHERE a.id = ?`).get(input.id)
  })

  ipcMain.handle('accionistas:with-pago-status', (_e, temporadaId: number) => {
    return getDb()
      .prepare(
        `SELECT ${ACCIONISTA_COLS},
                CASE WHEN EXISTS(
                  SELECT 1 FROM pagos p WHERE p.accionista_id = a.id AND p.temporada_id = ?
                ) THEN 1 ELSE 0 END AS pago_temporada_activa,
                COALESCE((
                  SELECT SUM(ab.total) FROM abonos ab
                  WHERE ab.accionista_id = a.id AND ab.temporada_id = ?
                ), 0) AS total_abonado,
                CASE WHEN EXISTS(
                  SELECT 1 FROM cargo_accionistas ca
                  JOIN cargos c ON c.id = ca.cargo_id
                  WHERE ca.accionista_id = a.id AND c.temporada_id = ? AND ca.pagado = 0
                ) THEN 1 ELSE 0 END AS has_unpaid_cargos
         FROM accionistas a
         ${PROPS_AGG}
         WHERE a.activo = 1 ORDER BY a.nombre`
      )
      .all(temporadaId, temporadaId, temporadaId)
  })
}
