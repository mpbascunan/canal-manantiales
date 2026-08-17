import Database from 'better-sqlite3'
import { app } from 'electron'
import { copyFileSync, existsSync } from 'fs'
import { join } from 'path'

let db: Database.Database

// Must match the highest version handled in runMigrations(). A database created
// from SCHEMA below is already at this version and must skip all migrations.
const LATEST_VERSION = 17

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
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre           TEXT    NOT NULL,
  apellido_paterno TEXT,
  apellido_materno TEXT,
  rut              TEXT,
  -- The association's own identifier for a member: it identifies exactly one
  -- (D17). RUT is deliberately *not* unique (D18) — this is the identity column.
  numero_socio     TEXT,
  activo           INTEGER NOT NULL DEFAULT 1,
  notas            TEXT
);
-- Partial, because "no number on file" is a real state and many records share
-- it. Blank and NULL are both excluded; every actual number is unique (D17).
CREATE UNIQUE INDEX IF NOT EXISTS idx_accionistas_numero_socio
  ON accionistas(numero_socio)
  WHERE TRIM(COALESCE(numero_socio, '')) != '';
CREATE TABLE IF NOT EXISTS propiedades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  accionista_id INTEGER NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
  -- How the administration names the property on its own listing, e.g.
  -- "Parcela N°8 Lote A-2". Replaces the old bare numero column: the listing
  -- identifies a property by this name, and it is what the aviso prints.
  nombre        TEXT,
  tipo          TEXT    NOT NULL CHECK(tipo IN ('PARCELA','SITIO','PEQUEÑO_PROPIETARIO')),
  acciones      REAL    NOT NULL DEFAULT 0,
  hectareas     REAL    NOT NULL DEFAULT 0,
  direccion     TEXT,
  marco         TEXT
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
  total                REAL    NOT NULL,
  notas                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pagos_accionista ON pagos(accionista_id);
CREATE INDEX IF NOT EXISTS idx_pagos_temporada  ON pagos(temporada_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha      ON pagos(fecha);
-- One receipt from the physical talonario, one number, never reused (D16).
-- Partial because 0 is the "no receipt number recorded" sentinel the form
-- defaults to and migration v7 left behind: those rows are payments all the
-- same, so they must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_numero_ingreso
  ON pagos(numero_ingreso)
  WHERE numero_ingreso > 0;
CREATE TABLE IF NOT EXISTS abonos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_ingreso       INTEGER NOT NULL,
  accionista_id        INTEGER NOT NULL REFERENCES accionistas(id),
  temporada_id         INTEGER NOT NULL REFERENCES temporadas(id),
  fecha                TEXT    NOT NULL,
  temporadas_cubiertas INTEGER NOT NULL DEFAULT 1,
  monto                REAL    NOT NULL DEFAULT 0,
  multas               REAL    NOT NULL DEFAULT 0,
  total                REAL    NOT NULL,
  notas                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_abonos_accionista ON abonos(accionista_id);
CREATE INDEX IF NOT EXISTS idx_abonos_temporada  ON abonos(temporada_id);
-- There is no deudores_config. It held temporadas_adeudadas, a count of owed
-- seasons that every formula priced at the *active* season's rate, repricing an
-- old season at today's cuota. Migration v16 dropped it: debt from before the
-- app is transcribed as deuda_inicial (D14), debt after it is derived from real
-- temporadas rows at their own rates (D13, D19), and nothing was left to count.
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

-- Debt an accionista carried into the system from before the app existed, typed
-- in from the administration's own records. Not a cargo: a cargo is levied on a
-- temporada at a tarifa, this is an opening balance with a figure already known.
-- One row per line so a per-temporada breakdown and a single lump both fit.
-- No "pagado" column: it is the oldest debt in the abono allocation, so what is
-- still owed is derived, and partial payment works like everything else.
CREATE TABLE IF NOT EXISTS deuda_inicial (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  accionista_id INTEGER NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
  concepto      TEXT    NOT NULL,
  -- OTRO is anything that is neither the season's fee nor a fine: a share of
  -- works, an agreed settlement. It is charged after CUOTA and before MULTA,
  -- the same position a cargo holds inside a temporada.
  tipo          TEXT    NOT NULL CHECK(tipo IN ('CUOTA','MULTA','OTRO')),
  monto         REAL    NOT NULL DEFAULT 0,
  notas         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deuda_inicial_accionista ON deuda_inicial(accionista_id);
`

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return cols.some(c => c.name === column)
}

// Copy the database before touching it. Several migrations are destructive
// (v3 merges accionistas, v7 clears numero_ingreso), so a bad migration on a
// client machine would otherwise be unrecoverable. One backup per source
// version — enough to roll back an update, without growing without bound.
function backupBeforeMigrating(database: Database.Database, dbPath: string, version: number): void {
  const target = `${dbPath}.bak-v${version}`
  if (existsSync(target)) return
  // Fold the WAL into the main file so the plain copy is complete.
  database.pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(dbPath, target)
}

/**
 * Makes an older database satisfy the constraints SCHEMA is about to declare.
 *
 * Runs **before** `exec(SCHEMA)`, not as a migration step, because a
 * `CREATE UNIQUE INDEX` in SCHEMA is applied to existing databases too: a
 * duplicate would throw there, and the migration that would have cleaned it up
 * never gets to run. The result is an app that cannot open its own database, on
 * the one machine that has real data in it.
 *
 * Nothing here deletes a row or invents a number. A losing duplicate is reset to
 * the "not recorded" value — 0 for a receipt, NULL for a socio — which keeps the
 * payment and the member, and leaves the collision visible for the
 * administration to re-enter from the talonario (D16, D17).
 */
function resolverColisionesDeUnicidad(database: Database.Database, version: number): void {
  if (version >= 17) return

  const hasTable = (name: string): boolean =>
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined

  database.transaction(() => {
    // Lowest id keeps the number, being the first the association issued it to.
    if (hasTable('pagos')) {
      database.prepare(
        `UPDATE pagos SET numero_ingreso = 0
         WHERE numero_ingreso > 0
           AND id NOT IN (SELECT MIN(id) FROM pagos WHERE numero_ingreso > 0 GROUP BY numero_ingreso)`
      ).run()
    }

    if (hasTable('accionistas')) {
      database.prepare(
        `UPDATE accionistas SET numero_socio = NULL
         WHERE TRIM(COALESCE(numero_socio, '')) != ''
           AND id NOT IN (
             SELECT MIN(id) FROM accionistas
             WHERE TRIM(COALESCE(numero_socio, '')) != ''
             GROUP BY TRIM(numero_socio)
           )`
      ).run()
    }
  })()
}

function runMigrations(database: Database.Database, version: number): void {
  if (version >= LATEST_VERSION) return

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
      const isOldSchema = hasColumn(database, 'cargos', 'accionista_id')

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
      if (hasColumn(database, 'accionistas', 'acciones'))  database.prepare('ALTER TABLE accionistas DROP COLUMN acciones').run()
      if (hasColumn(database, 'accionistas', 'hectareas')) database.prepare('ALTER TABLE accionistas DROP COLUMN hectareas').run()
    })()
    database.pragma('user_version = 5')
  }

  if (version < 6) {
    // v6: Add per-season payment deadline and fine rate to temporadas.
    database.transaction(() => {
      if (!hasColumn(database, 'temporadas', 'fecha_multa'))            database.prepare('ALTER TABLE temporadas ADD COLUMN fecha_multa DATE NULL').run()
      if (!hasColumn(database, 'temporadas', 'monto_multa_por_accion')) database.prepare('ALTER TABLE temporadas ADD COLUMN monto_multa_por_accion REAL NOT NULL DEFAULT 0').run()
    })()
    database.pragma('user_version = 6')
  }

  if (version < 7) {
    // v7: Split accionista name; add numero_socio; add property address fields; clear numero_ingreso data.
    database.transaction(() => {
      if (!hasColumn(database, 'accionistas', 'apellido_paterno')) database.prepare('ALTER TABLE accionistas ADD COLUMN apellido_paterno TEXT').run()
      if (!hasColumn(database, 'accionistas', 'apellido_materno')) database.prepare('ALTER TABLE accionistas ADD COLUMN apellido_materno TEXT').run()
      if (!hasColumn(database, 'accionistas', 'numero_socio'))     database.prepare('ALTER TABLE accionistas ADD COLUMN numero_socio TEXT').run()
      if (!hasColumn(database, 'propiedades', 'direccion'))        database.prepare('ALTER TABLE propiedades ADD COLUMN direccion TEXT').run()
      if (!hasColumn(database, 'propiedades', 'sector'))           database.prepare('ALTER TABLE propiedades ADD COLUMN sector TEXT').run()
      if (!hasColumn(database, 'propiedades', 'comuna'))           database.prepare('ALTER TABLE propiedades ADD COLUMN comuna TEXT').run()
      if (!hasColumn(database, 'propiedades', 'marco'))            database.prepare('ALTER TABLE propiedades ADD COLUMN marco TEXT').run()
      database.prepare('UPDATE pagos SET numero_ingreso = 0').run()
      database.prepare('UPDATE abonos SET numero_ingreso = 0').run()
    })()
    database.pragma('user_version = 7')
  }

  if (version < 8) {
    // v8: Add tipo_tarifa to cargos — 'proporcional' (default) or 'fija'.
    database.transaction(() => {
      if (!hasColumn(database, 'cargos', 'tipo_tarifa')) {
        database.prepare("ALTER TABLE cargos ADD COLUMN tipo_tarifa TEXT NOT NULL DEFAULT 'proporcional'").run()
      }
    })()
    database.pragma('user_version = 8')
  }

  if (version < 9) {
    // v9: Drop legacy numero/tipo from accionistas — all data lives in propiedades.
    database.transaction(() => {
      if (hasColumn(database, 'accionistas', 'numero')) database.prepare('ALTER TABLE accionistas DROP COLUMN numero').run()
      if (hasColumn(database, 'accionistas', 'tipo'))   database.prepare('ALTER TABLE accionistas DROP COLUMN tipo').run()
    })()
    database.pragma('user_version = 9')
  }

  if (version < 10) {
    // v10: Drop cuota_extraordinaria and otros_ingresos from pagos, abonos, deudores_config.
    // These are now represented exclusively as user-created cargos.
    database.transaction(() => {
      for (const table of ['pagos', 'abonos', 'deudores_config']) {
        for (const col of ['cuota_extraordinaria', 'otros_ingresos']) {
          if (hasColumn(database, table, col)) database.prepare(`ALTER TABLE ${table} DROP COLUMN ${col}`).run()
        }
      }
    })()
    database.pragma('user_version = 10')
  }

  if (version < 11) {
    // v11: Drop sector/comuna from propiedades — no longer used.
    database.transaction(() => {
      if (hasColumn(database, 'propiedades', 'sector')) database.prepare('ALTER TABLE propiedades DROP COLUMN sector').run()
      if (hasColumn(database, 'propiedades', 'comuna')) database.prepare('ALTER TABLE propiedades DROP COLUMN comuna').run()
    })()
    database.pragma('user_version = 11')
  }

  if (version < 12) {
    // v12: Add rut to accionistas.
    database.transaction(() => {
      if (!hasColumn(database, 'accionistas', 'rut')) database.prepare('ALTER TABLE accionistas ADD COLUMN rut TEXT').run()
    })()
    database.pragma('user_version = 12')
  }

  if (version < 13) {
    // v13: Opening balances for debt predating the app. Purely additive — no
    // existing row is read or rewritten, and `temporadas_adeudadas` is left
    // exactly as it is until someone transcribes the real figures.
    database.transaction(() => {
      database.prepare(`
        CREATE TABLE IF NOT EXISTS deuda_inicial (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          accionista_id INTEGER NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
          concepto      TEXT    NOT NULL,
          tipo          TEXT    NOT NULL CHECK(tipo IN ('CUOTA','MULTA')),
          monto         REAL    NOT NULL DEFAULT 0,
          notas         TEXT,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `).run()
      database.prepare(
        'CREATE INDEX IF NOT EXISTS idx_deuda_inicial_accionista ON deuda_inicial(accionista_id)'
      ).run()
    })()
    database.pragma('user_version = 13')
  }

  if (version < 14) {
    // v14: propiedades.numero → propiedades.nombre. The administration's listing
    // identifies a property by its name ("Parcela N°8 Lote A-2"), not by a bare
    // number, so that is what is stored and what the aviso prints. The old
    // numbers are dropped rather than converted: the listing is re-imported in
    // full, and it carries the real names.
    database.transaction(() => {
      if (!hasColumn(database, 'propiedades', 'nombre')) {
        database.prepare('ALTER TABLE propiedades ADD COLUMN nombre TEXT').run()
      }
      if (hasColumn(database, 'propiedades', 'numero')) {
        database.prepare('ALTER TABLE propiedades DROP COLUMN numero').run()
      }
    })()
    database.pragma('user_version = 14')
  }

  if (version < 15) {
    // v15: deuda_inicial gains the OTRO tipo. The constraint is part of the
    // table definition and SQLite cannot alter one in place, so the table is
    // rebuilt and its rows carried across unchanged.
    database.transaction(() => {
      database.prepare(`
        CREATE TABLE deuda_inicial_v15 (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          accionista_id INTEGER NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
          concepto      TEXT    NOT NULL,
          tipo          TEXT    NOT NULL CHECK(tipo IN ('CUOTA','MULTA','OTRO')),
          monto         REAL    NOT NULL DEFAULT 0,
          notas         TEXT,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `).run()
      database.prepare(`
        INSERT INTO deuda_inicial_v15 (id, accionista_id, concepto, tipo, monto, notas, created_at)
        SELECT id, accionista_id, concepto, tipo, monto, notas, created_at FROM deuda_inicial
      `).run()
      database.prepare('DROP TABLE deuda_inicial').run()
      database.prepare('ALTER TABLE deuda_inicial_v15 RENAME TO deuda_inicial').run()
      database.prepare(
        'CREATE INDEX IF NOT EXISTS idx_deuda_inicial_accionista ON deuda_inicial(accionista_id)'
      ).run()
    })()
    database.pragma('user_version = 15')
  }

  if (version < 16) {
    // v16: Drop deudores_config (D19). Its only column was
    // `temporadas_adeudadas`, a season count charged entirely at the active
    // season's rate — the mispricing D13 exists to prevent. Nothing replaces it:
    // pre-app debt is transcribed as deuda_inicial and later debt is derived, so
    // the table is left with only its primary key and goes.
    //
    // The rows are dropped rather than converted. The count was never a figure —
    // it says how many seasons someone was behind, not what they owed, and any
    // amount reconstructed from it would be priced at today's cuota, which is
    // exactly the number the administration's paper records disagree with.
    database.transaction(() => {
      database.prepare('DROP TABLE IF EXISTS deudores_config').run()
    })()
    database.pragma('user_version = 16')
  }

  if (version < 17) {
    // v17: numero_ingreso and numero_socio become unique (D16, D17).
    //
    // The indexes themselves are declared in SCHEMA and were already created by
    // the time this runs, as was the cleanup that made them possible — see
    // `resolverColisionesDeUnicidad`, which has to happen before SCHEMA is
    // applied rather than here. This block only records that the database has
    // been through it.
    database.pragma('user_version = 17')
  }
}

export function getDbPath(): string {
  return join(app.getPath('userData'), 'canal.db')
}

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = getDbPath()
    const database = new Database(dbPath)
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')

    const isNew =
      (database
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .get() as { n: number }).n === 0

    if (isNew) {
      // SCHEMA already describes the latest shape, so the historical migrations
      // have nothing to do here — and several would fail against it.
      database.exec(SCHEMA)
      database.pragma(`user_version = ${LATEST_VERSION}`)
    } else {
      const version = database.pragma('user_version', { simple: true }) as number
      if (version < LATEST_VERSION) backupBeforeMigrating(database, dbPath, version)
      // Before SCHEMA, not after: it declares constraints an older database can
      // still be violating, and they are applied to it as well as to a new one.
      resolverColisionesDeUnicidad(database, version)
      database.exec(SCHEMA)
      runMigrations(database, version)
    }

    // Assigned last: if setup throws, the next call retries from scratch instead
    // of handing out a half-migrated connection.
    db = database
  }
  return db
}
