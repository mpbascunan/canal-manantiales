import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS temporadas (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                 TEXT    NOT NULL UNIQUE,
  fecha_inicio           TEXT    NOT NULL,
  fecha_fin              TEXT    NOT NULL,
  valor_accion           REAL    NOT NULL,
  activa                 INTEGER NOT NULL DEFAULT 0,
  nota_aviso             TEXT,
  fecha_multa            DATE    NULL,
  monto_multa_por_accion REAL    NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS accionistas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  numero    TEXT,
  nombre    TEXT    NOT NULL,
  tipo      TEXT    NOT NULL CHECK(tipo IN ('PARCELA','SITIO','PEQUEÑO_PROPIETARIO')),
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
CREATE TABLE IF NOT EXISTS cargos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT    NOT NULL,
  temporada_id INTEGER NOT NULL REFERENCES temporadas(id),
  tarifa       REAL    NOT NULL DEFAULT 0,
  tipo_tarifa  TEXT    NOT NULL DEFAULT 'proporcional',
  fecha        TEXT    NOT NULL,
  notas        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cargos_temporada ON cargos(temporada_id);
CREATE TABLE IF NOT EXISTS cargo_accionistas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cargo_id      INTEGER NOT NULL REFERENCES cargos(id) ON DELETE CASCADE,
  accionista_id INTEGER NOT NULL REFERENCES accionistas(id),
  monto         REAL    NOT NULL DEFAULT 0,
  pagado        INTEGER NOT NULL DEFAULT 0,
  UNIQUE(cargo_id, accionista_id)
);
CREATE INDEX IF NOT EXISTS idx_cargo_accionistas_cargo      ON cargo_accionistas(cargo_id);
CREATE INDEX IF NOT EXISTS idx_cargo_accionistas_accionista ON cargo_accionistas(accionista_id);
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

  if (version < 4) {
    // v4: Replace flat cargos table with cargos (header) + cargo_accionistas (junction).
    // Amount per accionista is now tarifa × (acciones + hectareas).
    database.pragma('foreign_keys = OFF')
    database.transaction(() => {
      const cols = database.prepare("PRAGMA table_info(cargos)").all() as { name: string }[]
      const isOldSchema = cols.some(c => c.name === 'accionista_id')

      if (isOldSchema) {
        const oldRows = database.prepare('SELECT * FROM cargos').all() as any[]

        database.prepare('DROP TABLE IF EXISTS cargo_accionistas').run()
        database.prepare('DROP TABLE IF EXISTS cargos').run()

        database.exec(`
          CREATE TABLE cargos (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre       TEXT    NOT NULL,
            temporada_id INTEGER NOT NULL REFERENCES temporadas(id),
            tarifa       REAL    NOT NULL DEFAULT 0,
            fecha        TEXT    NOT NULL,
            notas        TEXT,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX idx_cargos_temporada ON cargos(temporada_id);
          CREATE TABLE cargo_accionistas (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            cargo_id      INTEGER NOT NULL REFERENCES cargos(id) ON DELETE CASCADE,
            accionista_id INTEGER NOT NULL REFERENCES accionistas(id),
            monto         REAL    NOT NULL DEFAULT 0,
            pagado        INTEGER NOT NULL DEFAULT 0,
            UNIQUE(cargo_id, accionista_id)
          );
          CREATE INDEX idx_cargo_accionistas_cargo      ON cargo_accionistas(cargo_id);
          CREATE INDEX idx_cargo_accionistas_accionista ON cargo_accionistas(accionista_id);
        `)

        const insertCargo = database.prepare(
          `INSERT INTO cargos (nombre, temporada_id, tarifa, fecha, notas, created_at)
           VALUES (@nombre, @temporada_id, @tarifa, @fecha, @notas, @created_at)`
        )
        const insertCA = database.prepare(
          `INSERT OR IGNORE INTO cargo_accionistas (cargo_id, accionista_id, monto, pagado)
           VALUES (@cargo_id, @accionista_id, @monto, @pagado)`
        )

        // Group old rows by (nombre, temporada_id, fecha) → one header; old monto becomes tarifa
        const headerMap = new Map<string, number>()
        for (const row of oldRows) {
          const key = `${row.nombre}||${row.temporada_id}||${row.fecha}`
          let cargoId = headerMap.get(key)
          if (cargoId === undefined) {
            const r = insertCargo.run({
              nombre: row.nombre,
              temporada_id: row.temporada_id,
              tarifa: row.monto ?? 0,
              fecha: row.fecha,
              notas: row.notas ?? null,
              created_at: row.created_at
            })
            cargoId = Number(r.lastInsertRowid)
            headerMap.set(key, cargoId)
          }
          insertCA.run({ cargo_id: cargoId, accionista_id: row.accionista_id, monto: row.monto ?? 0, pagado: row.pagado ?? 0 })
        }
      }
    })()
    database.pragma('foreign_keys = ON')
    database.pragma('user_version = 4')
  }

  if (version < 5) {
    // v5: Drop legacy acciones/hectareas from accionistas.
    // All values are now sourced exclusively from propiedades.
    database.transaction(() => {
      database.prepare('ALTER TABLE accionistas DROP COLUMN acciones').run()
      database.prepare('ALTER TABLE accionistas DROP COLUMN hectareas').run()
    })()
    database.pragma('user_version = 5')
  }

  if (version < 6) {
    // v6: Add per-season payment deadline and fine rate to temporadas.
    database.transaction(() => {
      database.prepare('ALTER TABLE temporadas ADD COLUMN fecha_multa DATE NULL').run()
      database.prepare('ALTER TABLE temporadas ADD COLUMN monto_multa_por_accion REAL NOT NULL DEFAULT 0').run()
    })()
    database.pragma('user_version = 6')
  }

  if (version < 7) {
    // v7: Split accionista name; add numero_socio; add property address fields; clear numero_ingreso data.
    database.transaction(() => {
      database.prepare('ALTER TABLE accionistas ADD COLUMN apellido_paterno TEXT').run()
      database.prepare('ALTER TABLE accionistas ADD COLUMN apellido_materno TEXT').run()
      database.prepare('ALTER TABLE accionistas ADD COLUMN numero_socio TEXT').run()
      database.prepare('ALTER TABLE propiedades ADD COLUMN direccion TEXT').run()
      database.prepare('ALTER TABLE propiedades ADD COLUMN sector TEXT').run()
      database.prepare('ALTER TABLE propiedades ADD COLUMN comuna TEXT').run()
      database.prepare('ALTER TABLE propiedades ADD COLUMN marco TEXT').run()
      database.prepare('UPDATE pagos SET numero_ingreso = 0').run()
      database.prepare('UPDATE abonos SET numero_ingreso = 0').run()
    })()
    database.pragma('user_version = 7')
  }

  if (version < 8) {
    // v8: Add tipo_tarifa to cargos — 'proporcional' (default) or 'fija'.
    database.transaction(() => {
      database.prepare("ALTER TABLE cargos ADD COLUMN tipo_tarifa TEXT NOT NULL DEFAULT 'proporcional'").run()
    })()
    database.pragma('user_version = 8')
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
