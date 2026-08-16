# context.md

Why this system is built the way it is. Definitions, decided rules, known gaps between the
rules and the code, and the questions still open.

Written for an agent reading it cold before changing behavior.

**Precedence.** `CLAUDE.md` = how to work in the repo (commands, architecture, conventions).
`DOCUMENTACION.md` = what the implemented behavior is, in Spanish, in detail. **This file =
what the rules are supposed to be and why.** Where this file and the code disagree, the code
is wrong and it is listed under Known gaps below — do not "fix" the doc to match the code.
Where this file says *open*, do not guess: ask.

Domain nouns stay Spanish everywhere (`accionista`, `temporada`, `pago`, `abono`, `cargo`,
`multa`, `deudor`); prose and identifiers are English. See CLAUDE.md.

---

## 1. Definitions

**Canal Rinconada de Manantiales** — an irrigation canal association in Chile. Members hold
water rights and pay a seasonal cuota to fund the canal. This app is its accounting system,
run by the administration on one machine.

| Term | Definition |
|---|---|
| **accionista** | A member. Holds one or more propiedades. Identity: name (+ apellidos), optional `numero_socio`, optional `rut`. |
| **propiedad** | A parcela, sitio or pequeño propietario belonging to an accionista, carrying `acciones` and `hectareas`. The only place those quantities exist. |
| **unidades** | Not a column — the derived quantity `acciones + hectareas`. Every money formula in the system is priced per unidad. |
| **temporada** | An agricultural season (roughly March→February) with its own `valor_accion`, its own `fecha_multa` deadline, and its own fine rate. Exactly one is `activa`. |
| **cuota** | What an accionista owes for a temporada: `valor_accion × unidades`. |
| **pago** | Full settlement of a temporada. Carries `numero_ingreso`, the number of a physical paper receipt entered by hand at the counter. |
| **abono** | A partial payment against a temporada's debt. |
| **cargo** | A charge issued to specific accionistas beyond the cuota — cuota extraordinaria, limpia de acequia, multa por inasistencia. `tipo_tarifa` is `fija` (flat) or `proporcional` (`tarifa × unidades`). |
| **multa por atraso** | The fine for paying a temporada late. Computed automatically from the temporada's `fecha_multa` and `monto_multa_por_accion` — never issued by hand. See D6. |
| **multa (por inasistencia)** | A fine for missing a reunión or a votación. Despite the name it is a **cargo**, issued by hand to named accionistas, and follows cargo rules — not D6. |
| **deudor** | An accionista with no `pago` for the temporada, **or** with any unpaid `cargo`. |
| **respaldo** | A user-initiated backup of the database file. |

---

## 2. Shape of the system

Single-user Electron desktop app. One SQLite file in `userData`, no server, no network, no
auth. The administration owns its data outright; nothing leaves the machine. This is why
`respaldo` exists as a first-class feature and why backups are taken before every migration —
there is no other copy of this data anywhere.

Consequence for any proposal: features that assume a server, multi-user concurrency, or
cloud sync are out of scope by construction.

---

## 3. Decisions

### D1 — An hectárea is priced exactly as an acción · *decided*

Every formula uses `valor_accion × (acciones + hectareas)`. Not a coincidence and not a
simplification: the canal charges the same per hectárea as per acción. They are two ways of
holding the same water right.

Consequence: `unidades = acciones + hectareas` is a domain invariant. It is also the base for
proportional cargos and for both multas. If the board ever sets a separate hectárea rate,
this is a change to the domain model, not a tweak — every formula and both SQL copies change.

### D2 — A pago means the temporada is settled; amount is a record, not a condition · *decided, guard missing*

That is exactly what distinguishes a pago from an abono. The debtor query tests
`EXISTS(SELECT 1 FROM pagos …)` and never compares amounts, deliberately. Partial money must
be entered as an abono.

Consequence: the payment form must refuse or warn when the entered amount does not match the
computed total, or a typo silently marks someone paid. **Not implemented** — see G2.

### D3 — Abonos consume the oldest unpaid temporada first, and within a temporada pay the deuda before the multas · *decided, engine built, not wired*

A temporada is settled **completely** — cuota, then its multa — before any money reaches the
next one. Note this is per-temporada interleaving, not "every cuota, then every multa": with
two seasons owed and an abono that covers the first cuota with change to spare, the change pays
the *first* season's multa rather than the second season's cuota. The totals are identical
either way; only the per-row breakdown on the aviso differs.

Implemented as `calcularDeudaPorTemporada` in `src/shared/deuda.ts`, with scenarios in
`tests/flows/deuda.test.ts`. It lives in `src/shared/` rather than in the renderer so the
main process can use the same function instead of a second copy in SQL (cf. G6).

Consequence: `calcularDeuda` in the renderer still subtracts `SUM(abonos.total)` from the
season subtotal as a single lump with no ordering, and is still what the UI renders — see G1.

### D4 — `temporadas_adeudadas` is a manual override, on purpose · *decided*

Intent is derived-by-default from missing pagos, with the administrator able to adjust or
forgive seasons for a particular accionista. Deals get made; the system must not overrule the
person running it.

Consequence: today there is no derivation at all — the field defaults to 1 and is only ever
what a human typed. The override is correct; the missing default is a gap (G4). Historical
debt from before the app existed can only enter this way.

### D5 — Cargos are the single extension point for money beyond the cuota — except multas · *decided*

Migration v10 deleted `cuota_extraordinaria` and `otros_ingresos` from `pagos`, `abonos` and
`deudores_config` and moved them to user-created cargos.

Consequence: **never add another money column** to `pagos` or `abonos`. A new kind of charge
is a cargo. Multas stay first-class in the formulas because they are computed automatically
from the temporada's rules rather than issued by hand to named people.

### D6 — The multa por atraso is proportional, frozen at the deadline, and summed per temporada · *decided, not implemented*

The fine is proportional to the share of a temporada's cuota still unpaid — not a flat charge.
It is computed **once per unpaid temporada**, using that temporada's own
`monto_multa_por_accion`, and the per-temporada results are summed:

```text
multa = Σ over temporadas t where t.fecha_multa is set and past:
          fracción_pendiente(t) × unidades × t.monto_multa_por_accion

fracción_pendiente(t) = 1 − (abonado toward t by abonos dated ≤ t.fecha_multa) ÷ cuota(t)
```

Four rules, each decided separately:

1. **Proportional, not flat.** This **overrides README item 6** ("Multa no es proporcial, es
   5.000 por accion o por hectarea"), which was the client's earlier understanding. Do not
   restore the flat model from that line; the README is a backlog, not a spec.
2. **Measured at the deadline, not live.** `fracción_pendiente` counts only abonos dated on or
   before that temporada's `fecha_multa`. Abonos paid afterwards do not shrink the fine.
   This is the rule that makes the fine collectable at all: because abonos cover the deuda
   before the multas (D3), a fine measured against the *current* balance falls to zero the
   moment the cuota is settled, so nobody would ever pay one. Frozen-at-deadline keeps the
   fine a pure function of stored data — no crystallised rows, no scheduled job, which matters
   on an app that only runs when someone opens it.
3. **The denominator is the cuota alone** — `valor_accion × unidades`. That temporada's cargos
   are excluded: they carry their own `pagado` flag, and a multa por atraso computed on top of
   an unpaid multa por inasistencia would be a fine on a fine.
4. **Gated on the date.** A temporada generates a fine only when `fecha_multa` is set and has
   passed. `fecha_multa IS NULL` means no fine for that season, ever. The current temporada
   therefore stops being a special case.

Consequence: `calcularMultas` (flat, `× (temporadas_adeudadas − 1)`) is wrong and goes away —
the `− 1` was approximating rule 4 before there was a per-season deadline to test.
`calcularMultaVencimiento` has the right shape but the wrong scope: applied once, to the active
temporada only, at today's rate, against the live balance. Today `calcularDeuda` **adds both**,
so a late shareholder with a backlog is charged twice.

Consequence: the fine can no longer be derived from `temporadas_adeudadas`. That is a scalar
count priced entirely at the active season's rate; this formula needs per-temporada debt
carrying each season's own rate. See D13 and G4.

Consequence: `fracción_pendiente` needs to know how much of each abono landed on which
temporada, so the abono allocation (D3/G1) is now a prerequisite for the multa, not an
independent piece of work.

### D7 — A propiedad is an enduring thing with its own identity · *decided, violated by the code*

Parcelas are transferred between owners and subdivided. They are not a snapshot of a
shareholder's current holdings.

Consequence: `accionistas:update` deletes every propiedad and re-inserts them, so ids change
on every save — see G3. "Cambiar accionista de propiedad" (README 33) and "subdivisión de
propiedades" (README 35) cannot be built on that save path. Fix identity first.

### D8 — Money is rounded to whole pesos when written to the database · *decided, not implemented*

CLP has no minor unit. Rounding at write time is the only way stored totals and displayed
totals can never disagree.

Consequence: today rounding happens only at display, in `formatCLP`, over `REAL` columns —
so a column of displayed rows can fail to sum to the displayed total (G5). Acciones and
hectáreas keep their 4 decimals; this rule is about money only.

### D9 — Totals always derive from propiedades, never from accionistas · *decided*

Migration v5 dropped `acciones`/`hectareas` from `accionistas`; v9 dropped `numero`/`tipo`.
The `PROPS_AGG` join is the single source of a shareholder's totals.

Consequence: never denormalize a total back onto `accionistas`, however convenient.

### D10 — One authoritative schema, no mirror · *decided*

`SCHEMA` in `src/main/db/connection.ts` is the only copy. A hand-maintained `schema.sql`
mirror existed, drifted silently across eleven migrations, and was deleted — nothing loads
it, so nothing could catch it being wrong.

### D11 — A late cargo re-opens a settled account · *decided*

Adding a cargo to someone who had paid in full makes them a deudor again for the unpaid
amount. Deliberate: the alternative is charges that are invisible until next season.

### D12 — RUT is optional, but a stored RUT is always valid · *decided*

Free-text entry, validated with the módulo 11 check digit in
`src/renderer/src/lib/rut.ts`; the form blocks saving an invalid one. Empty is allowed
because many historical records have no RUT on file.

Consequence: no uniqueness constraint yet, and the Excel importer does not validate. If
duplicates matter for identity, that is a new decision.

### D13 — Debt is derived per temporada, not counted · *decided, not implemented*

A shareholder owes temporada *t* when no `pago` exists for *t*. The set of owed seasons is
derived from real `temporadas` rows, and each contributes its **own** `valor_accion`,
`fecha_multa` and `monto_multa_por_accion`.

This replaces the scalar model: `deudores_config.temporadas_adeudadas` is a count, and every
formula multiplies it by the *active* season's rate, so an old season is silently repriced at
today's cuota and today's fine. D6 cannot be computed that way — it reads a different multa
amount per season.

Consequence: seasons people currently owe must exist as `temporadas` rows with their real
historical values. Backfilling them is a prerequisite for D6, and the data has to come from the
administration — see open question 1.

Consequence: `temporadas_adeudadas` survives only in its D4 role — a manual override for debt
predating the app, or for a deal the administrator has struck. It stops being the primary
source of the season count.

Consequence: this settles README item 23 by construction — an old temporada is charged at its
own `valor_accion`, because that is the row the calculation reads.

### D14 — Debt predating the app is transcribed, not reconstructed · *decided; stored and imported, not yet shown*

Pre-app debt enters as `deuda_inicial` rows (migration v13): one or more lines per accionista,
each a `concepto`, a `tipo` of `CUOTA`, `OTRO` or `MULTA`, and a `monto` taken from the
administration's own records. It is never recalculated — the figure *is* the fact.

`OTRO` (migration v15) is anything that is neither the season's fee nor a fine — a share of
works, an agreed settlement. Abonos consume the three in the order `CUOTA`, `OTRO`, `MULTA`,
mirroring the way a temporada charges its cuota, then its cargos, then its multa (D3). The
tipo is shown next to the concepto everywhere the debt is listed, because the concepto is
free text and may not say what the amount is for.

This replaces backfilling historical temporadas as the way old debt enters, and it is the
better answer: the administration's paper figures are authoritative, where a reconstruction
from rates the app never saw would only ever be a guess. Backfilling temporada rows remains
worth doing for reporting, but it is no longer a prerequisite for anything.

Lines rather than one total per accionista, so a per-temporada breakdown and a single lump both
fit without a schema change either way.

No `pagado` column, unlike `cargo_accionistas`. `deuda_inicial` is the oldest debt there is, so
it sits first in the D3 allocation and what remains owed is derived from the abonos like
everything else — which is also what makes partial payment work.

Consequence: it is deliberately **not** a cargo, despite D5 making cargos the extension point
for money beyond the cuota. A cargo is levied on a temporada at a `tarifa` and its per-person
amount is recomputed from that tarifa (`deudores.ts` ignores the stored `cargo_accionistas.monto`),
so a cargo cannot carry a figure that differs per accionista. An opening balance is not a charge.

Consequence: `deuda_inicial` MULTA lines are excluded from `total_multas`, which counts only
multas por atraso computed by D6. Whether the resumen contable reports them as multa income when
collected is still open.

### D15 — The aviso de cobranza demands the whole outstanding balance · *decided, implemented*

The aviso is the sheet a shareholder is handed and pays against at the counter, so it charges
everything they owe on the day it is printed: the pre-app debt first (D14), then every
temporada with anything still pending, oldest first — each net of the abonos already allocated
to it (D3) and priced at its own season's rates (D13). It is **not** a bill for the active
season's cuota; a shareholder two seasons behind receives one sheet listing all of it.

Consequence: the aviso reads `deudores:get-deuda`, the same breakdown the debt card and the
deudores listing render, and computes no figure of its own. A printed sheet and the screen
cannot disagree — that is what closes G8.

Consequence: what is shown and what is charged are distinguished explicitly.
`construirLineasAviso` in `lib/export.ts` returns typed lines with a `cobrable` flag; season
headings, the per-property split of a cuota and already-settled cargos are shown but not
charged, and the charged lines sum to `total_pendiente` exactly. `tests/flows/avisos.test.ts`
holds that as an invariant across every scenario, and reads the text back out of the generated
PDF.

Consequence: the per-property split of a cuota is printed only while nothing has been abonado
against that season — splitting a partial remainder across parcelas would invent an allocation
nobody decided. The whole-season line, with what has been abonado noted beside it, is the
honest form once money has landed.

Consequence: an accionista who owes nothing still gets a sheet when the administration prints
for everyone, stating exactly that; money abonado beyond every debt is printed as excedente a
favor rather than silently dropped. `deudores:list-deuda` therefore takes `incluirSinDeuda`,
since the deudores listing wants those rows gone and the bulk print wants them kept.

---

## 4. Known gaps — code does not implement a decided rule

| | Gap | Rule violated |
|---|---|---|
| **G2** | The payment form accepts any amount and still marks the temporada settled. | D2 |
| **G3** | `accionistas:update` deletes and re-inserts all propiedades, destroying their ids on every save. | D7 |
| **G4** | Debt is the scalar `temporadas_adeudadas`, priced entirely at the *active* season's `valor_accion` and `monto_multa_por_accion`. There is no per-season derivation, and no default — it is 1 until a human changes it. | D13, D4 |
| **G7** | `calcularDeuda`, `calcularMultas`, `calcularMultaVencimiento` and `tieneMultaVencimiento` still exist in `src/renderer/src/lib/formulas.ts` and still implement the old flat + double-charged multa. Only `calcularMultas` is still called, by the Accionistas listing; the rest are dead code waiting to be picked up by mistake. | D6 |
| **G5** | Money is stored unrounded as `REAL`; rounding happens only at display. | D8 |
| **G6** | The cargo amount formula (`fija` vs `proporcional`) is written twice — once in TypeScript, once in SQL inside `deudores.ts` and `cargos.ts`. Changing one silently diverges from the other. | — |

None of these are safe to fix casually: G2 and G5 both move numbers that the
administration reconciles by hand against paper receipts.

**Closed.** *G1* — abonos are now allocated explicitly by `calcularDeudaPorTemporada`
(D3), and `deudores:get-deuda` / `deudores:list-deuda` are what the debt cards, the deudores
listing and the pago form render. *G6* for the cargo formula — the SQL copy in `deudores.ts`
now only resolves `fija` vs `proporcional` into a figure; the rules live in `src/shared/deuda.ts`.
A related bug went with it: `abonos:create` used to flip every pending cargo to `pagado` once
the total abonado reached their sum, so the same money paid the cargos *and* counted in full
against the cuota. Coverage is derived now; `pagado` means settled by a pago or by hand.
*G8* — the aviso de cobranza now renders `deudores:get-deuda` directly (D15) and takes no
`multaVencimiento` figure of its own. The deudores Excel export was already reduced from the
same breakdown by the Deudores page.

---

## 5. Open questions

1. **Do collected `deuda_inicial` MULTA lines count as multa income in the resumen contable?**
   (D14) — they are real fines, but they were not computed by D6 and belong to seasons the app
   never managed.
2. **Is `numero_ingreso` unique?** It is the number of a physical receipt book, entered by
   hand, and nothing enforces uniqueness. Migration v7 zeroed all existing values.
3. **Does RUT uniqueness matter?** (D12)

---

## 6. Verification reality

There is now an integration suite: `npm test` bundles `tests/flows/*.test.ts` with esbuild,
swaps `electron` for an in-process stub, and runs the real IPC handlers against a real SQLite
file on the Electron binary. It covers the handlers and, in `tests/flows/deuda.test.ts`, the
D3/D6 money rules as worked scenarios.

The aviso de cobranza is covered end to end in `tests/flows/avisos.test.ts`: real rows →
`deudores:get-deuda` → the lines the sheet charges → the PDF, whose text is read back out of
the generated document (`tests/helpers/pdf.ts`) rather than trusted. That is the only export
verified this way, and it is the one that leaves the building on paper.

What it does **not** cover: the rest of the renderer. `calcularDeuda` in
`src/renderer/src/lib/formulas.ts`, the debt cards, the pago form and the remaining PDF/Excel
exports are still checked only by a person comparing the screen against paper. There is still
no UI or e2e test (README item 29).

Treat that as the main risk when changing anything in §3 or §4.
