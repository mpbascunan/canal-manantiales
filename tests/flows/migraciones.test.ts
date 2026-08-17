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
    CREATE TABLE deudores_config (
      accionista_id        INTEGER NOT NULL,
      temporada_id         INTEGER NOT NULL,
      temporadas_adeudadas INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (accionista_id, temporada_id)
    );
    CREATE TABLE pagos (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_ingreso     INTEGER NOT NULL,
      accionista_id      INTEGER NOT NULL,
      temporada_id       INTEGER NOT NULL,
      fecha              TEXT    NOT NULL,
      temporadas_pagadas INTEGER NOT NULL DEFAULT 1,
      monto_acciones     REAL    NOT NULL DEFAULT 0,
      multas             REAL    NOT NULL DEFAULT 0,
      total              REAL    NOT NULL,
      notas              TEXT,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)
  db.prepare("INSERT INTO accionistas (id, nombre, numero_socio) VALUES (1, 'Juan Pérez', '7')").run()
  // Duplicates of both kinds, so the v17 cleanup is actually exercised. The
  // client's own data has none — this is the path that must not crash if it does.
  db.prepare("INSERT INTO accionistas (id, nombre, numero_socio) VALUES (9, 'Otro Pérez', '7')").run()
  db.prepare("INSERT INTO deudores_config VALUES (1, 1, 3)").run()
  db.prepare(`
    INSERT INTO pagos (id, numero_ingreso, accionista_id, temporada_id, fecha, total)
    VALUES (1, 500, 1, 1, '2024-06-01', 40000),
           (2, 500, 9, 1, '2024-06-02', 20000),
           (3,   0, 1, 1, '2024-06-03', 10000),
           (4,   0, 9, 1, '2024-06-04', 10000)
  `).run()
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
    assert.equal(version, 17)
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

  it('drops deudores_config, rows and all (D19)', () => {
    const tabla = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deudores_config'")
      .get()

    assert.equal(tabla, undefined)
  })

  it('keeps every pago, and blanks only the duplicated receipt number (D16)', () => {
    const pagos = getDb()
      .prepare('SELECT id, numero_ingreso, total FROM pagos ORDER BY id')
      .all() as { id: number; numero_ingreso: number; total: number }[]

    // Nothing is deleted and no number is invented: the lowest id keeps 500,
    // the later one falls back to "not recorded" for re-entry from the talonario.
    assert.deepEqual(pagos.map(p => [p.id, p.numero_ingreso]), [[1, 500], [2, 0], [3, 0], [4, 0]])
    assert.equal(pagos.reduce((s, p) => s + p.total, 0), 80_000, 'no money went missing')
  })

  it('leaves the unnumbered pagos alone — 0 is a state, not an identity', () => {
    // Four rows, three of them at 0: a plain UNIQUE would have rejected this.
    assert.doesNotThrow(() => getDb().prepare(
      `INSERT INTO pagos (numero_ingreso, accionista_id, temporada_id, fecha, total)
       VALUES (0, 1, 1, '2024-07-01', 5000)`
    ).run())
  })

  it('refuses a receipt number that is already in use (D16)', () => {
    assert.throws(() => getDb().prepare(
      `INSERT INTO pagos (numero_ingreso, accionista_id, temporada_id, fecha, total)
       VALUES (500, 1, 1, '2024-07-02', 5000)`
    ).run(), /UNIQUE/)
  })

  it('keeps both accionistas, and clears only the duplicated N° socio (D17)', () => {
    const socios = getDb()
      .prepare('SELECT id, numero_socio FROM accionistas WHERE id IN (1, 9) ORDER BY id')
      .all() as { id: number; numero_socio: string | null }[]

    assert.deepEqual(socios, [{ id: 1, numero_socio: '7' }, { id: 9, numero_socio: null }])
  })

  it('refuses a N° socio that is already in use (D17)', () => {
    assert.throws(() => getDb().prepare(
      "INSERT INTO accionistas (nombre, numero_socio) VALUES ('Tercero', '7')"
    ).run(), /UNIQUE/)
  })
})
