import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS temporadas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT    NOT NULL UNIQUE,
  fecha_inicio TEXT    NOT NULL,
  fecha_fin    TEXT    NOT NULL,
  valor_accion REAL    NOT NULL,
  activa       INTEGER NOT NULL DEFAULT 0,
  nota_aviso   TEXT
);
CREATE TABLE IF NOT EXISTS accionistas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  numero    TEXT,
  nombre    TEXT    NOT NULL,
  tipo      TEXT    NOT NULL CHECK(tipo IN ('PARCELA','SITIO','PEQUEÑO_PROPIETARIO')),
  acciones  REAL    NOT NULL DEFAULT 0,
  hectareas REAL    NOT NULL DEFAULT 0,
  activo    INTEGER NOT NULL DEFAULT 1,
  notas     TEXT
);
CREATE TABLE IF NOT EXISTS propiedades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  accionista_id INTEGER NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
  numero        TEXT,
  tipo          TEXT    NOT NULL CHECK(tipo IN ('PARCELA','SITIO','PEQUEÑO_PROPIETARIO')),
  acciones      REAL    NOT NULL DEFAULT 0,
  hectareas     REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_propiedades_accionista ON propiedades(accionista_id);
CREATE TABLE IF NOT EXISTS pagos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_ingreso       INTEGER NOT NULL,
  accionista_id        INTEGER NOT NULL REFERENCES accionistas(id),
  temporada_id         INTEGER NOT NULL REFERENCES temporadas(id),
  fecha                TEXT    NOT NULL,
  temporadas_pagadas   INTEGER NOT NULL DEFAULT 1,
  monto_acciones       REAL    NOT NULL DEFAULT 0,
  multas               REAL    NOT NULL DEFAULT 0,
  cuota_extraordinaria REAL    NOT NULL DEFAULT 0,
  otros_ingresos       REAL    NOT NULL DEFAULT 0,
  total                REAL    NOT NULL,
  notas                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pagos_accionista ON pagos(accionista_id);
CREATE INDEX IF NOT EXISTS idx_pagos_temporada  ON pagos(temporada_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha      ON pagos(fecha);
CREATE TABLE IF NOT EXISTS abonos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_ingreso       INTEGER NOT NULL,
  accionista_id        INTEGER NOT NULL REFERENCES accionistas(id),
  temporada_id         INTEGER NOT NULL REFERENCES temporadas(id),
  fecha                TEXT    NOT NULL,
  temporadas_cubiertas INTEGER NOT NULL DEFAULT 1,
  monto                REAL    NOT NULL DEFAULT 0,
  multas               REAL    NOT NULL DEFAULT 0,
  cuota_extraordinaria REAL    NOT NULL DEFAULT 0,
  otros_ingresos       REAL    NOT NULL DEFAULT 0,
  total                REAL    NOT NULL,
  notas                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_abonos_accionista ON abonos(accionista_id);
CREATE INDEX IF NOT EXISTS idx_abonos_temporada  ON abonos(temporada_id);
CREATE TABLE IF NOT EXISTS deudores_config (
  accionista_id        INTEGER NOT NULL REFERENCES accionistas(id),
  temporada_id         INTEGER NOT NULL REFERENCES temporadas(id),
  temporadas_adeudadas INTEGER NOT NULL DEFAULT 1,
  cuota_extraordinaria REAL    NOT NULL DEFAULT 0,
  otros_ingresos       REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (accionista_id, temporada_id)
);
`

function runMigrations(database: Database.Database): void {
  const version = database.pragma('user_version', { simple: true }) as number

  if (version < 1) {
    // v1: Seed propiedades from existing accionistas data (one-time migration)
    database.transaction(() => {
      const count = (database.prepare('SELECT COUNT(*) AS n FROM propiedades').get() as any).n
      if (count === 0) {
        const hasRows = (database.prepare('SELECT COUNT(*) AS n FROM accionistas').get() as any).n
        if (hasRows > 0) {
          database
            .prepare(
              `INSERT INTO propiedades (accionista_id, numero, tipo, acciones, hectareas)
               SELECT id, numero, tipo, acciones, hectareas FROM accionistas
               WHERE nombre IS NOT NULL AND nombre != ''`
            )
            .run()
        }
      }
    })()
    database.pragma('user_version = 1')
  }

  if (version < 2) {
    // v2: Remove duplicate propiedades — keep the MAX(id) per (accionista_id, numero, tipo)
    database.transaction(() => {
      database
        .prepare(
          `DELETE FROM propiedades
           WHERE id NOT IN (
             SELECT max_id FROM (
               SELECT MAX(id) AS max_id
               FROM propiedades
               GROUP BY accionista_id,
                        LOWER(TRIM(COALESCE(numero, ''))),
                        tipo
             )
           )`
        )
        .run()
    })()
    database.pragma('user_version = 2')
  }

  if (version < 3) {
    // v3: Merge duplicate accionistas (same name) into a single canonical record.
    // The original import created one accionista row per Excel row, so anyone with
    // multiple properties ended up with multiple accionista entries.
    // Strategy: keep MIN(id) as canonical, reassign all FK references, delete duplicates.
    database.pragma('foreign_keys = OFF')
    database.transaction(() => {
      // Find all non-canonical duplicate ids
      const dupes = database
        .prepare(
          `SELECT id, nombre FROM accionistas
           WHERE id NOT IN (
             SELECT MIN(id) FROM accionistas GROUP BY LOWER(TRIM(nombre))
           )`
        )
        .all() as { id: number; nombre: string }[]

      const getCanonical = database.prepare(
        `SELECT MIN(id) AS canon_id FROM accionistas WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))`
      )
      const movePropiedades   = database.prepare('UPDATE propiedades    SET accionista_id = ? WHERE accionista_id = ?')
      const movePagos         = database.prepare('UPDATE pagos           SET accionista_id = ? WHERE accionista_id = ?')
      const moveAbonos        = database.prepare('UPDATE abonos          SET accionista_id = ? WHERE accionista_id = ?')
      const delConflictConfig = database.prepare(
        `DELETE FROM deudores_config
         WHERE accionista_id = ?
           AND temporada_id IN (SELECT temporada_id FROM deudores_config WHERE accionista_id = ?)`
      )
      const moveConfig    = database.prepare('UPDATE deudores_config SET accionista_id = ? WHERE accionista_id = ?')
      const deleteDup     = database.prepare('DELETE FROM accionistas WHERE id = ?')

      for (const dup of dupes) {
        const row = getCanonical.get(dup.nombre) as { canon_id: number }
        const canonId = row.canon_id
        const dupId   = dup.id

        movePropiedades.run(canonId, dupId)
        movePagos.run(canonId, dupId)
        moveAbonos.run(canonId, dupId)
        // Drop config rows that would conflict with canonical's existing config, then move rest
        delConflictConfig.run(dupId, canonId)
        moveConfig.run(canonId, dupId)
        deleteDup.run(dupId)
      }

      // After merging, some propiedades may now share the same (accionista_id, numero, tipo)
      database
        .prepare(
          `DELETE FROM propiedades
           WHERE id NOT IN (
             SELECT MAX(id) FROM propiedades
             GROUP BY accionista_id, LOWER(TRIM(COALESCE(numero, ''))), tipo
           )`
        )
        .run()
    })()
    database.pragma('foreign_keys = ON')
    database.pragma('user_version = 3')
  }
}

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'canal.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(SCHEMA)
    runMigrations(db)
  }
  return db
}
