-- Canal Rinconada de Manantiales — SQLite schema (reference copy)
-- The authoritative CREATE TABLE calls live in connection.ts (SCHEMA constant).
-- This file mirrors that string exactly and is kept in sync manually.

CREATE TABLE IF NOT EXISTS temporadas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre       TEXT    NOT NULL UNIQUE,
  fecha_inicio TEXT    NOT NULL,
  fecha_fin    TEXT    NOT NULL,
  valor_accion REAL    NOT NULL,
  activa       INTEGER NOT NULL DEFAULT 0,
  nota_aviso   TEXT                        -- configurable footer text for PDF notices
);

CREATE TABLE IF NOT EXISTS accionistas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  numero    TEXT,                          -- legacy; use propiedades for current data
  nombre    TEXT    NOT NULL,
  tipo      TEXT    NOT NULL CHECK(tipo IN ('PARCELA','SITIO','PEQUEÑO_PROPIETARIO')),
  acciones  REAL    NOT NULL DEFAULT 0,    -- legacy; SUM from propiedades is the source of truth
  hectareas REAL    NOT NULL DEFAULT 0,    -- legacy; same
  activo    INTEGER NOT NULL DEFAULT 1,
  notas     TEXT
);

-- One row per property owned by an accionista.
-- An accionista can own multiple parcelas/sitios/pequeños propietarios.
-- Queries aggregate via LEFT JOIN … GROUP BY accionista_id to get totals.
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

-- Partial payments against a season's debt.
-- Remaining debt = total_owed (formula) – SUM(abonos.total) for that season.
-- temporadas_cubiertas is kept for schema compatibility; always stored as 0.
CREATE TABLE IF NOT EXISTS abonos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_ingreso       INTEGER NOT NULL,
  accionista_id        INTEGER NOT NULL REFERENCES accionistas(id),
  temporada_id         INTEGER NOT NULL REFERENCES temporadas(id),
  fecha                TEXT    NOT NULL,
  temporadas_cubiertas INTEGER NOT NULL DEFAULT 0,
  monto                REAL    NOT NULL DEFAULT 0,   -- cuota acciones portion
  multas               REAL    NOT NULL DEFAULT 0,
  cuota_extraordinaria REAL    NOT NULL DEFAULT 0,
  otros_ingresos       REAL    NOT NULL DEFAULT 0,
  total                REAL    NOT NULL,
  notas                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_abonos_accionista ON abonos(accionista_id);
CREATE INDEX IF NOT EXISTS idx_abonos_temporada  ON abonos(temporada_id);

-- User-configurable debt parameters per accionista per season.
-- temporadas_adeudadas drives how many seasons the debt formula applies.
CREATE TABLE IF NOT EXISTS deudores_config (
  accionista_id        INTEGER NOT NULL REFERENCES accionistas(id),
  temporada_id         INTEGER NOT NULL REFERENCES temporadas(id),
  temporadas_adeudadas INTEGER NOT NULL DEFAULT 1,
  cuota_extraordinaria REAL    NOT NULL DEFAULT 0,
  otros_ingresos       REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (accionista_id, temporada_id)
);

-- ── Applied migrations ─────────────────────────────────────────────────────
-- v1: seed propiedades from accionistas (one-time, runs if propiedades is empty)
-- v2: deduplicate propiedades by (accionista_id, LOWER(TRIM(numero)), tipo)
-- v3: merge duplicate accionistas (same nombre) into a single canonical record
