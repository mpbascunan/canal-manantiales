import { ipcMain } from 'electron'
import { getDb } from '../connection'
import type { AccionistaInput } from '../../../shared/types'

// Reusable SQL fragment: joins propiedades to compute totals
const PROPS_AGG = `
  LEFT JOIN (
    SELECT accionista_id,
           SUM(acciones)  AS total_acciones,
           SUM(hectareas) AS total_hectareas,
           GROUP_CONCAT(
             CASE WHEN numero IS NOT NULL AND TRIM(numero) != '' THEN numero ELSE NULL END,
             ', '
           ) AS numeros
    FROM propiedades
    GROUP BY accionista_id
  ) pt ON pt.accionista_id = a.id
  LEFT JOIN propiedades pf ON pf.accionista_id = a.id
         AND pf.id = (SELECT MIN(id) FROM propiedades WHERE accionista_id = a.id)
`

const ACCIONISTA_COLS = `
  a.id, a.nombre, a.apellido_paterno, a.apellido_materno, a.numero_socio, a.activo, a.notas,
  COALESCE(pt.total_acciones, 0)   AS acciones,
  COALESCE(pt.total_hectareas, 0) AS hectareas,
  COALESCE(pf.tipo, a.tipo)                 AS tipo,
  COALESCE(pf.numero, a.numero)             AS numero,
  COALESCE(pt.numeros, a.numero)            AS numeros
`

const SELECT_BASE = `SELECT ${ACCIONISTA_COLS} FROM accionistas a ${PROPS_AGG}`

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
    const primary = props[0]

    const id = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO accionistas (nombre, apellido_paterno, apellido_materno, numero_socio, tipo, numero, activo, notas)
           VALUES (@nombre, @apellido_paterno, @apellido_materno, @numero_socio, @tipo, @numero, @activo, @notas)`
        )
        .run({
          nombre: input.nombre,
          apellido_paterno: input.apellido_paterno ?? null,
          apellido_materno: input.apellido_materno ?? null,
          numero_socio: input.numero_socio ?? null,
          tipo: primary?.tipo ?? 'PARCELA',
          numero: primary?.numero ?? null,
          activo: input.activo ? 1 : 0,
          notas: input.notas ?? null
        })
      const newId = r.lastInsertRowid as number
      for (const p of props) {
        db.prepare(
          `INSERT INTO propiedades (accionista_id, numero, tipo, acciones, hectareas, direccion, sector, comuna, marco)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(newId, p.numero ?? null, p.tipo, p.acciones, p.hectareas, p.direccion ?? null, p.sector ?? null, p.comuna ?? null, p.marco ?? null)
      }
      return newId
    })()

    return db.prepare(`${SELECT_BASE} WHERE a.id = ?`).get(id)
  })

  ipcMain.handle('accionistas:update', (_e, input: AccionistaInput & { id: number }) => {
    const db = getDb()
    const props = input.propiedades ?? []
    const primary = props[0]

    db.transaction(() => {
      db.prepare(
        `UPDATE accionistas SET nombre=@nombre, apellido_paterno=@apellido_paterno, apellido_materno=@apellido_materno,
         numero_socio=@numero_socio, tipo=@tipo, numero=@numero, activo=@activo, notas=@notas
         WHERE id=@id`
      ).run({
        id: input.id,
        nombre: input.nombre,
        apellido_paterno: input.apellido_paterno ?? null,
        apellido_materno: input.apellido_materno ?? null,
        numero_socio: input.numero_socio ?? null,
        tipo: primary?.tipo ?? 'PARCELA',
        numero: primary?.numero ?? null,
        activo: input.activo ? 1 : 0,
        notas: input.notas ?? null
      })
      db.prepare('DELETE FROM propiedades WHERE accionista_id = ?').run(input.id)
      for (const p of props) {
        db.prepare(
          `INSERT INTO propiedades (accionista_id, numero, tipo, acciones, hectareas, direccion, sector, comuna, marco)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(input.id, p.numero ?? null, p.tipo, p.acciones, p.hectareas, p.direccion ?? null, p.sector ?? null, p.comuna ?? null, p.marco ?? null)
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
                COALESCE(dc.temporadas_adeudadas, 1)  AS dc_temporadas_adeudadas,
                COALESCE(dc.cuota_extraordinaria, 0)  AS dc_cuota_extraordinaria,
                COALESCE(dc.otros_ingresos, 0)        AS dc_otros_ingresos
         FROM accionistas a
         ${PROPS_AGG}
         LEFT JOIN deudores_config dc ON dc.accionista_id = a.id AND dc.temporada_id = ?
         WHERE a.activo = 1 ORDER BY a.nombre`
      )
      .all(temporadaId, temporadaId, temporadaId)
  })
}
