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
this is a change to the domain model, not a tweak — but there is now one place to change it:
`calcularDeudaPorTemporada` and `calcularMontoCargo` in `src/shared/deuda.ts`.

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
main process uses the same function instead of a second copy in SQL (cf. G6).

Consequence: `calcularDeuda` in the renderer still subtracts `SUM(abonos.total)` from the
season subtotal as a single lump with no ordering, and is still what the UI renders — see G1.

### D4 — `temporadas_adeudadas` is a manual override, on purpose · ~~*decided*~~ **superseded by D19**

*Kept for the record; do not build on it.* The intent was derived-by-default from missing pagos,
with the administrator able to adjust or forgive seasons for a particular accionista — deals get
made, and the system must not overrule the person running it.

What actually happened is that the derivation was never built, so the field was only ever what a
human typed, and every formula priced it at the active season's rate. D19 removes the column:
pre-app debt is transcribed as `deuda_inicial` (D14) and everything after it derives from real
`temporadas` rows (D13), which leaves the override with nothing to override. Forgiving a season
is a `deuda_inicial` adjustment now.

### D5 — Cargos are the single extension point for money beyond the cuota — except multas · *decided*

Migration v10 deleted `cuota_extraordinaria` and `otros_ingresos` from `pagos`, `abonos` and
`deudores_config` and moved them to user-created cargos.

Consequence: **never add another money column** to `pagos` or `abonos`. A new kind of charge
is a cargo. Multas stay first-class in the formulas because they are computed automatically
from the temporada's rules rather than issued by hand to named people.

### D6 — The multa por atraso is proportional, frozen at the deadline, and summed per temporada · *decided, implemented*

The fine is proportional to the share of a temporada's cuota still unpaid — not a flat charge.
It is computed **once per unpaid temporada**, using that temporada's own
`monto_multa_por_accion`, and the per-temporada results are summed:

```text
multa = Σ over temporadas t where t.fecha_multa is set and past:
          fracción_pendiente(t) × unidades × t.monto_multa_por_accion

fracción_pendiente(t) = 1 − (abonado toward t by abonos dated ≤ t.fecha_multa) ÷ cuota(t)
```

Five rules, each decided separately:

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
5. **"Passed" means passed by the date being registered, not by the clock.** The engine takes
   the reference date as a parameter, and the pago/abono form passes **the fecha typed on the
   form** — not `new Date()`. A payment received inside the plazo and transcribed weeks later
   is still a payment made inside the plazo, and must not be fined for the administration's
   delay in typing up the receipt. The date drives the *maturity* test only: an older
   temporada whose `fecha_multa` the typed date is already past is still fined at its own
   rate, so back-dating a receipt cannot wipe out a real backlog.

   Reading the clock is nonetheless the right default everywhere else — the debt cards, the
   deudores listing and the avisos de cobro all ask "what is owed **now**", and pass nothing.

Implemented by `calcularDeudaPorTemporada` in `src/shared/deuda.ts`, and there only. Note the
reference date gates the multa and nothing else: abonos are counted whatever their date, so
`deudores:get-deuda` with a past date answers "the debt as of then, knowing everything paid
since" — it is not a historical snapshot.

The two formulas this replaced are deleted (G7). `calcularMultas` was flat, at
`× (temporadas_adeudadas − 1)` — the `− 1` approximated rule 4 before there was a per-season
deadline to test. `calcularMultaVencimiento` had the right shape but the wrong scope: applied
once, to the active temporada only, at today's rate, against the live balance. `calcularDeuda`
**added both**, so a late shareholder with a backlog was charged twice.

Consequence: the fine cannot be derived from `temporadas_adeudadas`. That was a scalar count
priced entirely at the active season's rate; this formula needs per-temporada debt carrying
each season's own rate, which is why D19 removed the column outright.

Consequence: `fracción_pendiente` needs to know how much of each abono landed on which
temporada, so the abono allocation (D3/G1) is now a prerequisite for the multa, not an
independent piece of work.

### D7 — A propiedad is an enduring thing with its own identity · *decided, violated by the code*

Parcelas are transferred between owners and subdivided. They are not a snapshot of a
shareholder's current holdings.

Consequence: `accionistas:update` deletes every propiedad and re-inserts them, so ids change
on every save — see G3. "Cambiar accionista de propiedad" (README 33) and "subdivisión de
propiedades" (README 35) cannot be built on that save path. Fix identity first.

### D8 — Money is rounded to whole pesos when written to the database · *decided, implemented*

CLP has no minor unit. Rounding at write time is the only way stored totals and displayed
totals can never disagree.

`roundPesos` in `src/shared/deuda.ts` is applied on every money insert: pagos, abonos, the
cargo tarifa and each derived monto, deuda_inicial lines, and a temporada's `valor_accion`
and `monto_multa_por_accion`. The columns are still `REAL`; what changed is that nothing
fractional reaches them. Acciones and hectáreas keep their 4 decimals — this rule is about
money only.

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

### D13 — Debt is derived per temporada, not counted · *decided, implemented*

A shareholder owes temporada *t* when no `pago` exists for *t*. The set of owed seasons is
derived from real `temporadas` rows, and each contributes its **own** `valor_accion`,
`fecha_multa` and `monto_multa_por_accion`.

This replaced the scalar model: `deudores_config.temporadas_adeudadas` was a count, and every
formula multiplied it by the *active* season's rate, so an old season was silently repriced at
today's cuota and today's fine. D6 cannot be computed that way — it reads a different multa
amount per season. The column, its table and its handlers were removed in migration v16 (D19).

Consequence: this settles README item 23 by construction — an old temporada is charged at its
own `valor_accion`, because that is the row the calculation reads.

Consequence: the derivation only ever looks at seasons the app itself managed. Nothing is
backfilled and nothing is reconstructed — see D19.

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

`temporadas_adeudadas` (migration v18) records how many seasons a line covers, since a single
`CUOTA` line is usually several years rolled into one figure and there was nowhere else to put
that. It is **descriptive only** and read by nothing that computes: the monto is the fact. This
is deliberately not D19 coming back — that count was multiplied by the *active* season's cuota
to produce an amount, which is the mispricing D13 exists to prevent. Anything that is not a
whole count of at least one season is stored as `NULL`, and every row predating v18 is `NULL`,
because reconstructing a count would mean dividing a transcribed monto by a rate the app never
saw. The Excel import reads it from any header that names a count of temporadas, and in the
column-per-tipo layout the row's count goes to every line the row produces — three seasons
behind means three seasons of cuota and three of multa. `normalizarTemporadasAdeudadas` in
`shared/deuda.ts` is the single copy of what counts as a valid one.

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

### D16 — `numero_ingreso` is unique · *decided, implemented*

One receipt from the physical talonario, one number, never reused. Enforced by
`idx_pagos_numero_ingreso`, a **partial** unique index over `pagos` `WHERE numero_ingreso > 0`.
Partial because 0 is not a receipt number: it is what migration v7 left behind and what the
pago form still defaults to when nobody types one, and several payments can legitimately be in
that state. Abonos are deliberately left out — a receipt spanning both tables is not
expressible as one index, and the decision below is about the payment record.

The constraint can be added without a cleanup, and both sources agree it is the right rule: the
live database holds 301 pagos, every one numbered, 301 distinct numbers, and in the
administration's `Ingresos Temp.` file — the sheet payments are actually read from — a receipt is
one row, with one payer and one total.

Worth knowing when reading the other spreadsheet: in `LISTADO DE ACCIONISTAS` the same number is
written across **every property row the payment covers**, so it repeats there by design (63 of
304 numbers appear more than once) and sometimes spans rows belonging to different, related
people. That is a listing artefact, not a second payment — receipt 5450 is written on the three
SOTO AVILA parcelas 13-A/B/C but was paid once, by "Sucesión Juan Soto Poblete", for $226.808.
Uniqueness holds on the payment; it does not hold on that sheet's rows.

Consequence: a receipt can settle propiedades belonging to more than one accionista while being
booked to a single payer — a sucesión paying for its members' parcelas, say. The app has no way
to express that today, so those receipts are the ones the import leaves for the administration to
enter by hand, listed in the "no importadas" report (see §4).

### D17 — `numero_socio` is unique, enforced in the database, the form and the importer · *decided, implemented*

It is the association's own identifier for a member, and it identifies exactly one.

Three places, because each fails differently:

- **The database** — `idx_accionistas_numero_socio`, a partial unique index
  `WHERE TRIM(COALESCE(numero_socio, '')) != ''`, so the invariant cannot be violated at all.
  Partial because "no number on file" is a real state that many records share.
- **The form** — `AccionistaModal` refuses to save a number another accionista holds, and
  `accionistas:create`/`:update` reject it again server-side with the *name of the holder*,
  which "ya está en uso" alone would not tell an administrator with 396 members.
- **The importer** — a `N° Socio` the sheet gives to two different people is reported as a
  `conflicto` and imported nowhere. The hard part is that the same socio is legitimately typed
  several ways across their rows ("ARTEMIO CORNEJO" / "ARTEMIO CORNEJO MORAGA"), so a
  difference in spelling is not a collision; what separates the two is *containment* — a
  shortened name uses a subset of the fuller one's words, two different people share none.

There are no duplicates to correct: all 396 accionistas carry a number, and none repeats — also
under a normalising comparison that strips leading zeros, case and whitespace.

Consequence, and the thing that matters more than the constraint: **the numbers currently stored
are not the association's numbers.** They are a sequence assigned during import — 1…454 with 58
holes, running in the order accionistas first appear in the PARCELAS sheet. The `N° Socio` column
in the revision spreadsheet is present but entirely blank, all 591 rows. README items 1 and 9 say
the real numbers "ya existen" and must be associated; until that list arrives, a `UNIQUE`
constraint protects a local surrogate. Adding the constraint is still right — it costs nothing
now and it is what makes the eventual re-map safe — but it does not make the numbers correct.

### D18 — RUT is descriptive; uniqueness is not enforced · *decided*

RUT is there to identify a person on paper, not to key anything in the system. D12 already makes
it optional and validates the check digit; that is as far as it goes. No `UNIQUE` constraint, no
duplicate check in the form, no import validation.

Consequence: `numero_socio` (D17) is the identity column. Nothing should ever be matched, joined
or deduplicated on RUT.

### D19 — The app computes debt only for seasons it managed; everything older is `deuda_inicial` · *decided, implemented*

There are exactly two sources of debt, and the boundary between them is the day the app started
keeping the books:

- **Before it** — one or more `deuda_inicial` lines per accionista, transcribed from the
  administration's records and never recalculated (D14).
- **From it onwards** — derived from real `temporadas` rows, each priced at its own
  `valor_accion` and fined at its own `fecha_multa` / `monto_multa_por_accion` (D13, D6).

This closes the question D13 left open. Historical `temporadas` are **not** backfilled: the
association's paper figures are authoritative, and reconstructing an old season from rates the
app never saw would only ever be a guess dressed as a calculation. A season the app did not
manage has no row, therefore contributes no cuota and generates no multa.

Consequence: `deudores_config.temporadas_adeudadas` is **removed** — column, migration, IPC
payloads, and the editor on the Deudores screen. It was the last piece of the scalar model: a
count of seasons priced entirely at the active season's rate, which is exactly the mispricing
D13 exists to prevent. With pre-app debt transcribed and later debt derived, nothing is left for
it to answer. This retires D4, and it is what closed G4.

Consequence: `deudores_config` is left holding only its primary key. Whether the table survives
at all is an implementation detail — if nothing else lands in it, it goes.

Consequence: forgiving a season, or striking a deal, is now an edit to that accionista's
`deuda_inicial` lines rather than a decrement of a counter. That is a better record anyway: it
carries a concepto saying what was forgiven.

---

## 4. Known gaps — code does not implement a decided rule

| | Gap | Rule violated |
|---|---|---|
| **G2** | *Closed — see below.* The pago form no longer takes an amount at all. | D2 |
| **G3** | `accionistas:update` deletes and re-inserts all propiedades, destroying their ids on every save. | D7 |
| **G4** | *Closed — see below.* | D13, D19 |
| **G5** | *Closed — see below.* | D8 |
| **G6** | *Closed — see below.* | — |
| **G7** | *Closed — see below.* | D6 |

G3 is the only one left open, and it is deferred by decision rather than by oversight.

**Deferred by decision, not by oversight.** *G3* — propiedad identity is left as it is for this
version; it will be taken up together with README 33 and 35, which are the features that need it.
Until then, treat propiedad ids as unstable and do not key anything on them.

**G2 is closed, and by a better route than the one D2 asked for.** D2 wanted the form to refuse
or warn when the typed amount did not match the computed total. Instead the pago form stopped
taking an amount: its only editable fields are temporada, fecha, `numero_ingreso` and notas, and
every figure it saves is seeded from `deudores:get-deuda` — `monto_acciones` from the pending
cuotas, `multas` from the pending multas, `total` from `total_pendiente`. There is no typed
amount left to disagree with anything, so the rule holds by construction rather than by
validation. The editable-multa field and the "Auto-calcular" button this gap was written against
are both gone.

One residual, narrow but real: the save button is disabled only on `!!existingPago`, not on
whether the debt has finished loading, and `totalCompleto` is `0` while `deuda` is still `null`.
Confirming a pago inside that window would settle a temporada for $0. It needs the guard.

**Rows the import could not place are the operator's to finish, and that is not a gap.** A pago
whose payer matches no accionista is not written. The importer says so: the preview counts the
rows it left out and offers "Descargar Excel de filas no importadas", whose `sin_accionista`
sheet lists each one with its receipt, date, name and amount. From there the administration
enters them by hand or creates the missing accionista and imports again.

That is a deliberate division of labour, not a silent failure. The spreadsheets are the
administration's own records, complete only they can judge, and an importer that guessed at an
unmatched payer would be inventing accounting. Loading the data fully is the operator's
responsibility; the app's job is to say exactly what it could not place, which it does.

Worth knowing concretely, because it is the shape this takes in practice: in the 2025-2026
import two receipts stayed out — 5450 ($226.808, `Susecion Juan Soto Poblete`) and 5521
($707.332, `Hector Osvaldo Cáceres Lizana`). Neither payer exists in `accionistas`: the first is
a sucesión whose parcelas the listing records under its three members, the second owns Sitio 26
but was never created as an accionista. Both were reported at import time and are waiting in the
"no importadas" report. Until someone enters them, the accionistas those receipts covered show
as deudores.

**Closed.** *G1* — abonos are now allocated explicitly by `calcularDeudaPorTemporada`
(D3), and `deudores:get-deuda` / `deudores:list-deuda` are what the debt cards, the deudores
listing and the pago form render. A related bug went with it: `abonos:create` used to flip
every pending cargo to `pagado` once the total abonado reached their sum, so the same money
paid the cargos *and* counted in full against the cuota. Coverage is derived now; `pagado`
means settled by a pago or by hand.
*G8* — the aviso de cobranza now renders `deudores:get-deuda` directly (D15) and takes no
`multaVencimiento` figure of its own. The deudores Excel export was already reduced from the
same breakdown by the Deudores page.

*G4* — `temporadas_adeudadas` is gone: migration v16 drops `deudores_config`, and
`deudores:list`, `:get-config` and `:upsert-config` went with it. The last screen reading it
was the Accionistas listing, whose "Cubierto" badge now comes from `total_pendiente`.

*G7* — `calcularDeuda`, `calcularMultas`, `calcularMultaVencimiento` and
`tieneMultaVencimiento` are deleted, along with `DeudaParams` and `DeudaBreakdown`.
`src/renderer/src/lib/formulas.ts` is formatting plus `calcularMontoAcciones` and
`calcularTotal`, which the pago form uses to seed a field before the real breakdown arrives and
which no longer answer any question about debt.

*G6* — `calcularMontoCargo` in `src/shared/deuda.ts` is the only implementation of the cargo
amount. The SQL `CASE` copies in `deudores.ts` and `cargos.ts` are gone; `cargos:list-by-accionista`
selects the tarifa and resolves it in TypeScript, as `computeDeuda` already did.

*G5* — `roundPesos` is applied on every money insert (D8), so the stored figure and the
displayed one are the same number rather than two roundings of it.

---

## 5. Open questions

1. **Do collected `deuda_inicial` MULTA lines count as multa income in the resumen contable?**
   (D14) — they are real fines, but they were not computed by D6 and belong to seasons the app
   never managed.

   *Provisional answer: yes, reported on their own line — "Multa temporadas pasadas" — so that
   fines the app computed under D6 stay separately legible from fines it merely inherited.
   Awaiting confirmation from the association before anything is built; do not implement it on
   the strength of this note.*

**Answered and moved into §3.** *Is `numero_ingreso` unique?* → D16, yes.
*Is `numero_socio` unique?* → D17, yes, and enforced in three places.
*Does RUT uniqueness matter?* → D18, no.

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

`tests/flows/migraciones.test.ts` builds a v14 database by hand, with duplicate receipt numbers
and duplicate socio numbers in it, and opens it the way the app does — the one path that only
ever runs on the machine with real data.

What it does **not** cover: the rest of the renderer. The debt cards, the pago form and the
remaining PDF/Excel exports are still checked only by a person comparing the screen against
paper. There is still no UI or e2e test (README item 29).

Treat that as the main risk when changing anything in §3 or §4.
