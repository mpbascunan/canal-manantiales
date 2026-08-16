import { readFileSync } from 'fs'
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../../src/main/db/connection'
import { registeredChannels } from '../helpers/electron'
import { registerAllHandlers } from '../helpers/harness'

describe('base de datos y superficie IPC', () => {
  before(registerAllHandlers)

  it('stamps a brand-new database at the latest version so migrations are skipped', () => {
    const db = getDb()
    const version = db.pragma('user_version', { simple: true }) as number

    // Same number as LATEST_VERSION in src/main/db/connection.ts — a new database
    // is created from SCHEMA, which already describes the final shape.
    assert.equal(version, 15)
  })

  it('creates every table the handlers query', () => {
    const tables = (getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map(t => t.name).sort()

    assert.deepEqual(tables, [
      'abonos', 'accionistas', 'cargo_accionistas', 'cargos',
      'deuda_inicial', 'deudores_config', 'pagos', 'propiedades', 'temporadas'
    ])
  })

  it('enforces foreign keys', () => {
    assert.equal(getDb().pragma('foreign_keys', { simple: true }), 1)
  })

  it('registers a handler for every channel the preload exposes', () => {
    const preload = readFileSync('src/preload/index.ts', 'utf8')
    const used = [...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map(m => m[1])
    const registered = new Set(registeredChannels())

    assert.ok(used.length > 0, 'no channels found in the preload')
    const missing = [...new Set(used)].filter(channel => !registered.has(channel))
    assert.deepEqual(missing, [], `preload channels without a main-process handler: ${missing.join(', ')}`)
  })
})
