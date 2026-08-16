# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # electron-vite dev (hot reload for renderer, restart for main)
npm run build      # bundles to out/ — esbuild strips types WITHOUT checking them
npm run typecheck  # tsc over all three projects; run before finishing a change
npm test           # integration suite in tests/ (real SQLite, real IPC handlers)
npm run dist       # build + electron-builder → release/
```

`npm run typecheck` and `npm test` are the two automated gates. There is still **no UI or
e2e test** (item 29 in the README backlog asks for those) — verify screen behavior by
running the app.

`typecheck` runs `tsc --noEmit` against `tsconfig.node.json`, `tsconfig.web.json` and
`tsconfig.test.json` separately, because the root `tsconfig.json` is a solution file
(`"files": []`) — running
`tsc --noEmit` there follows no references and silently checks **nothing**, exiting 0 on a
tree full of errors. Do not "simplify" it back. Never use `tsc -b` either: these projects
are `composite` with no `outDir`, so build mode emits `.js`/`.d.ts` next to every source
file.

`postinstall` runs `electron-rebuild` for `better-sqlite3`; after changing Node or Electron
versions, rerun `npm install` or the app will fail to open the database.

`npm test` runs `tests/` through `scripts/run-tests.mjs`: esbuild bundles each
`tests/flows/*.test.ts` (rewriting `import … from 'electron'` to `tests/helpers/electron.ts`,
which collects `ipcMain.handle` registrations into a Map) and the bundles run on the Electron
binary under `ELECTRON_RUN_AS_NODE=1` — plain `node` cannot load the Electron-ABI build of
`better-sqlite3`. Tests call `invoke('<channel>', …)` exactly as the renderer does, against a
real SQLite file in a throwaway directory. `npm test <substring>` runs matching files only.

Test files run **one at a time** (`--test-concurrency=1`). They share that one SQLite file, so
under the default parallel runner they reset each other's rows mid-test — the symptom is a
scattering of failures that all pass when their file is run alone.

Windows installers are built by `.github/workflows/build-windows.yml`, which is
`workflow_dispatch` only and publishes a GitHub release tagged from `package.json` version.

## Language: English code, Spanish UI

**All code is written in English. All user-facing text is written in Spanish.**

The app is used by the Canal Rinconada de Manantiales administration in Chile, so everything
a person reads on screen is in Spanish — but the code that produces it is not.

English: identifiers, types, comments, JSDoc, commit messages.
Spanish: labels, placeholders, buttons, headings, validation/error messages, tooltips, and
all PDF/Excel export text.

```tsx
// Good — English identifier, Spanish label
const rutIsValid = value.rut.trim() === '' || isValidRut(value.rut)
{!rutIsValid && <p className="text-xs text-red-500">RUT inválido</p>}
```

**Exception — the domain vocabulary stays Spanish.** `accionista`, `temporada`, `propiedad`,
`pago`, `abono`, `cargo`, `multa`, `deudor` and `respaldo` are the names of the database
columns, the IPC channels, and the shared types. Do not translate them, and stay consistent
when adding related code (a new charges handler is `cargos:list`, never `charges:list`).
The English rule governs everything else: new helpers, logic, generic variables, comments.

## Architecture

Electron + React + SQLite desktop app, bundled by electron-vite. Three source trees, one
per Electron process, plus shared types:

- `src/main/` — main process. `db/connection.ts` owns the schema and migrations;
  `db/handlers/*.ts` each export a `register…Handlers()` that registers `ipcMain.handle`
  channels. All handlers are registered in `src/main/index.ts` on `app.whenReady()`.
- `src/preload/` — the entire IPC surface, as one nested `api` object of
  `ipcRenderer.invoke` wrappers, exposed via `contextBridge` (contextIsolation is on).
- `src/renderer/src/` — React 19 + React Router + Tailwind. `lib/ipc.ts` re-exports
  `window.api` typed as the preload's `ElectronAPI`.
- `src/shared/types.ts` — types used by both processes.

### Adding an IPC feature touches four files

1. `src/main/db/handlers/<entity>.ts` — `ipcMain.handle('<entity>:<action>', …)`
2. `src/main/index.ts` — call the register function (only if the handler file is new)
3. `src/preload/index.ts` — add the wrapper method under the matching key
4. `src/shared/types.ts` — the row/input types

Preload signatures are deliberately loose (`(a: any)`); real typing lives in
`src/shared/types.ts` and is applied at the call site in the renderer. Renderer code never
touches `ipcRenderer` directly — always `import { api } from '../lib/ipc'`.

Routing uses `HashRouter` because production loads the renderer over `file://`.

### Database

One SQLite file at `app.getPath('userData')/canal.db`, WAL mode, foreign keys on, accessed
synchronously through `better-sqlite3`. `getDb()` is a lazy singleton; it assigns the module
variable last so a failed setup retries instead of handing out a half-migrated connection.

Schema changes follow a fixed procedure:

1. Edit the `SCHEMA` template string in `src/main/db/connection.ts` — this is authoritative
   and must always describe the **final** shape.
2. Add an `if (version < N)` block in `runMigrations()`, guarding every `ALTER` with
   `hasColumn()` so re-runs are safe.
3. Bump `LATEST_VERSION` to `N`.

There is deliberately no second copy of the schema. A hand-maintained mirror drifted
silently for eleven migrations before being removed, because nothing loads it and so
nothing can catch it being wrong.

A brand-new database is stamped at `LATEST_VERSION` and skips migrations entirely — several
historical migrations would fail against the current schema. Existing databases get one
`.bak-v<version>` copy before migrating, since some migrations are destructive.

Data is user-owned and never leaves the machine; `respaldo:exportar` uses SQLite's online
backup API (not a file copy) so the WAL is included.

### Where the money logic lives

`src/renderer/src/lib/formulas.ts` is the reference implementation: `calcularMontoAcciones`,
`calcularMultas`, `calcularMultaVencimiento`, and `calcularDeuda` (which returns the full
`DeudaBreakdown` the debt cards render). Amounts are CLP, formatted with `formatCLP`.

Two rules are duplicated in SQL in `src/main/db/handlers/deudores.ts` and `cargos.ts`, and
must be changed in both places:

- **Charge amount**: `tipo_tarifa = 'fija'` → flat `tarifa`; otherwise `tarifa × (acciones + hectareas)`.
- **Shareholder totals**: `acciones`/`hectareas` no longer exist on `accionistas` — they are
  always `SUM`ed from `propiedades` through the `PROPS_AGG` join fragment (copied verbatim
  into both handlers), which also builds the `nombres_propiedades` list.

A shareholder counts as a debtor when they have no `pago` for the season **or** any unpaid
`cargo` — a late charge re-opens an otherwise settled account.

### Excel and PDF

Both are generated in the renderer, not the main process: `lib/export.ts` (`xlsx` for
spreadsheets, `jspdf` + `jspdf-autotable` for payment notices, receipts and reports),
`lib/importParser.ts` for reading uploaded workbooks. The main process only handles the
file dialog and raw file read (`import:*` channels), then previews/commits parsed rows.

## Reference documents

- `context.md` — **read this before changing any calculation.** Why the domain works the way
  it does: decided rules, the gaps where the code does not yet implement them, and the
  questions still open (notably which multa model governs the late fine). Where `context.md`
  and the code disagree, the code is the thing that is wrong.
- `DOCUMENTACION.md` — the detailed business-logic spec in Spanish (domain glossary, models,
  formulas, payment/abono flows, multas, resumen contable). Consult it before changing
  calculation behavior; keep it updated when the rules change.
- `README.md` — **not** documentation. It is the client's numbered feature backlog and bug
  list in Spanish, with `si`/`CORREGIDO` marking done items, plus the agreed dirección and
  marco option lists at the bottom.
