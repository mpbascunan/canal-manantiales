/**
 * Runs the integration suite.
 *
 * Two things make this more than `node --test`:
 *
 * 1. The handlers `import … from 'electron'`, which only resolves inside a real
 *    Electron process. An esbuild plugin rewrites those imports to
 *    `tests/helpers/electron.ts`, which registers channels into a Map instead.
 * 2. `better-sqlite3` is a native module, and `postinstall` rebuilds it against
 *    Electron's ABI — plain `node` cannot load it. So the bundled suite runs on
 *    the Electron binary with `ELECTRON_RUN_AS_NODE=1`, which is Node with the
 *    matching ABI.
 *
 * Each run gets a fresh userData directory, so the schema is always created by
 * `getDb()` the way it is on a new install, never migrated from a stale file.
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronBinary from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronStub = join(root, 'tests/helpers/electron.ts')

// Inside node_modules so `require('better-sqlite3')` still resolves from the
// bundle, and so the output is ignored by git for free.
const outdir = join(root, 'node_modules/.canal-tests')

/** Rewrites every bare `electron` import to the in-process stub. */
const electronStubPlugin = {
  name: 'electron-stub',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }))
  }
}

const filter = process.argv[2]
const entryPoints = readdirSync(join(root, 'tests/flows'))
  .filter(f => f.endsWith('.test.ts'))
  .filter(f => !filter || f.includes(filter))
  .map(f => join(root, 'tests/flows', f))

if (entryPoints.length === 0) {
  console.error(filter ? `No test files match "${filter}".` : 'No test files found.')
  process.exit(1)
}

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

await build({
  entryPoints,
  outdir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  sourcemap: 'inline',
  // Native module: must be loaded by the runtime, not inlined.
  external: ['better-sqlite3'],
  plugins: [electronStubPlugin],
  logLevel: 'warning'
})

const userData = mkdtempSync(join(tmpdir(), 'canal-test-'))
const bundles = readdirSync(outdir)
  .filter(f => f.endsWith('.cjs'))
  .map(f => join(outdir, f))

// One file at a time: every test file talks to the same SQLite database, so
// the default parallel runner has them resetting each other's rows mid-test.
const child = spawn(electronBinary, ['--test', '--test-concurrency=1', ...bundles], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    CANAL_TEST_USERDATA: userData
  }
})

child.on('exit', code => {
  rmSync(userData, { recursive: true, force: true })
  process.exit(code ?? 1)
})
