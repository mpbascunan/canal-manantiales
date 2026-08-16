/**
 * Shared setup for the integration suite: registers the real IPC handlers
 * against a real SQLite file, and gives every test a clean database.
 */
import { getDb } from '../../src/main/db/connection'
import { invokeHandler } from './electron'
import { registerTemporadaHandlers } from '../../src/main/db/handlers/temporadas'
import { registerAccionistaHandlers } from '../../src/main/db/handlers/accionistas'
import { registerPagoHandlers } from '../../src/main/db/handlers/pagos'
import { registerDeudorHandlers } from '../../src/main/db/handlers/deudores'
import { registerImportHandlers } from '../../src/main/db/handlers/import'
import { registerPropiedadHandlers } from '../../src/main/db/handlers/propiedades'
import { registerAbonoHandlers } from '../../src/main/db/handlers/abonos'
import { registerCargoHandlers } from '../../src/main/db/handlers/cargos'
import { registerRespaldoHandlers } from '../../src/main/db/handlers/respaldo'
import { registerDeudaInicialHandlers } from '../../src/main/db/handlers/deudaInicial'
import type {
  Accionista, AccionistaInput, PropiedadInput, Temporada
} from '../../src/shared/types'

let registered = false

/** Mirrors what `src/main/index.ts` does on `app.whenReady()`. */
export function registerAllHandlers(): void {
  if (registered) return
  registerTemporadaHandlers()
  registerAccionistaHandlers()
  registerPagoHandlers()
  registerDeudorHandlers()
  registerImportHandlers()
  registerPropiedadHandlers()
  registerAbonoHandlers()
  registerCargoHandlers()
  registerRespaldoHandlers()
  registerDeudaInicialHandlers()
  registered = true
}

/** Calls an IPC channel exactly as `window.api` does from the renderer. */
export function invoke<T = any>(channel: string, ...args: any[]): Promise<T> {
  return invokeHandler(channel, ...args) as Promise<T>
}

// Children first: foreign keys are on.
const TABLES = [
  'cargo_accionistas',
  'cargos',
  'deuda_inicial',
  'deudores_config',
  'abonos',
  'pagos',
  'propiedades',
  'accionistas',
  'temporadas'
]

/**
 * Empties every table and restarts the AUTOINCREMENT counters, so ids are
 * predictable per test. The schema itself is created once, by the first
 * `getDb()` — the same code path the app uses on a brand-new install.
 */
export function resetDb(): void {
  const db = getDb()
  db.transaction(() => {
    for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run()
    db.prepare('DELETE FROM sqlite_sequence').run()
  })()
}

/** Raw access, for asserting on rows no handler exposes. */
export function query<T = any>(sql: string, ...params: any[]): T[] {
  return getDb().prepare(sql).all(...params) as T[]
}

const TEMPORADA_DEFAULTS: Omit<Temporada, 'id'> = {
  nombre: 'Temporada 2024-2025',
  fecha_inicio: '2024-05-01',
  fecha_fin: '2025-04-30',
  valor_accion: 10_000,
  activa: true,
  nota_aviso: null,
  fecha_multa: null,
  monto_multa_por_accion: 0
}

export function seedTemporada(overrides: Partial<Omit<Temporada, 'id'>> = {}): Promise<Temporada> {
  return invoke<Temporada>('temporadas:create', { ...TEMPORADA_DEFAULTS, ...overrides })
}

export function seedAccionista(
  nombre: string,
  propiedades: PropiedadInput[] = [{ nombre: '1', tipo: 'PARCELA', acciones: 1, hectareas: 0 }],
  overrides: Partial<AccionistaInput> = {}
): Promise<Accionista> {
  return invoke<Accionista>('accionistas:create', {
    nombre,
    activo: true,
    propiedades,
    ...overrides
  })
}
