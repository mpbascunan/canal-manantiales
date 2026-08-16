import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { getDb } from '../../src/main/db/connection'

/**
 * Migrations against a database that already has rows in it.
 *
 * The rest of the suite never exercises them: `resetDb` works on a brand-new
 * file, which is stamped at `LATEST_VERSION` and skips every migration by
 * design. That leaves the one code path that only ever runs on a machine with
 * real data — the client's — as the one nothing checks. This file closes that
 * gap by building the previous version's database by hand and opening it the
 * way the app does.
 */

const DB_PATH = join(app.getPath('userData'), 'canal.db')

/** The v14 shape of the tables this migration touches, with a row in each. */
function crearBaseV14(): void {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE accionistas (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre           TEXT    NOT NULL,
      apellido_paterno TEXT,
      apellido_materno TEXT,
      rut              TEXT,
      numero_socio     TEXT,
      activo           INTEGER NOT NULL DEFAULT 1,
      notas            TEXT
    );
    CREATE TABLE deuda_inicial (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      accionista_id INTEGER NOT NULL REFERENCES accionistas(id) ON DELETE CASCADE,
      concepto      TEXT    NOT NULL,
      tipo          TEXT    NOT NULL CHECK(tipo IN ('CUOTA','MULTA')),
      monto         REAL    NOT NULL DEFAULT 0,
      notas         TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)
  db.prepare("INSERT INTO accionistas (id, nombre, numero_socio) VALUES (1, 'Juan Pérez', '7')").run()
  db.prepare(`
    INSERT INTO deuda_inicial (id, accionista_id, concepto, tipo, monto, notas, created_at)
    VALUES (5, 1, 'Cuota impaga 2023-2024', 'CUOTA', 480000, 'transcrita', '2025-01-02 10:00:00')
  `).run()
  db.pragma('user_version = 14')
  db.close()
}

describe('migraciones sobre una base con datos', () => {
  before(crearBaseV14)

  it('brings a v14 database up to the latest version', () => {
    const version = getDb().pragma('user_version', { simple: true }) as number
    assert.equal(version, 15)
  })

  it('backs the database up before touching it', () => {
    getDb()
    assert.equal(existsSync(`${DB_PATH}.bak-v14`), true)
  })

  it('carries every deuda_inicial row across the rebuild, ids and all', () => {
    const linea = getDb()
      .prepare('SELECT * FROM deuda_inicial WHERE id = 5')
      .get() as Record<string, unknown>

    assert.equal(linea.accionista_id, 1)
    assert.equal(linea.concepto, 'Cuota impaga 2023-2024')
    assert.equal(linea.tipo, 'CUOTA')
    assert.equal(linea.monto, 480_000)
    // notas and created_at are transcription metadata — losing them would lose
    // the record of where the figure came from.
    assert.equal(linea.notas, 'transcrita')
    assert.equal(linea.created_at, '2025-01-02 10:00:00')
  })

  it('accepts OTRO afterwards, which is the point of the rebuild', () => {
    getDb().prepare(
      "INSERT INTO deuda_inicial (accionista_id, concepto, tipo, monto) VALUES (1, 'Aporte obras', 'OTRO', 95000)"
    ).run()

    const { n } = getDb()
      .prepare("SELECT COUNT(*) AS n FROM deuda_inicial WHERE tipo = 'OTRO'")
      .get() as { n: number }
    assert.equal(n, 1)
  })

  it('still refuses a tipo it does not know', () => {
    assert.throws(() => getDb().prepare(
      "INSERT INTO deuda_inicial (accionista_id, concepto, tipo, monto) VALUES (1, 'X', 'CARGO', 1)"
    ).run())
  })

  it('keeps the cascade to accionistas after the table was recreated', () => {
    // The rebuild has to carry the foreign key over, or deleting an accionista
    // would leave their debt orphaned instead of removing it.
    const db = getDb()
    db.prepare("INSERT INTO accionistas (id, nombre) VALUES (2, 'Ana Soto')").run()
    db.prepare(
      "INSERT INTO deuda_inicial (accionista_id, concepto, tipo, monto) VALUES (2, 'Multa', 'MULTA', 1000)"
    ).run()

    db.prepare('DELETE FROM accionistas WHERE id = 2').run()

    const { n } = db
      .prepare('SELECT COUNT(*) AS n FROM deuda_inicial WHERE accionista_id = 2')
      .get() as { n: number }
    assert.equal(n, 0)
  })

  it('keeps the index the queries order by', () => {
    const indexes = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'deuda_inicial'")
      .all() as { name: string }[]

    assert.equal(indexes.some(i => i.name === 'idx_deuda_inicial_accionista'), true)
  })
})
