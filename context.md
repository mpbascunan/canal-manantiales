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
| **multa** | An automatically computed fine. Two kinds exist — see §3 D6, which is **open**. |
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

### D3 — Abonos consume the oldest unpaid temporada first, and within a temporada pay the deuda before the multas · *decided, not implemented*

Consequence: `calcularDeuda` currently subtracts `SUM(abonos.total)` from the season subtotal
as a single lump with no ordering — see G1. Allocation must become explicit before anything
else is built on abono behavior.

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

### D6 — Which multa model governs the late fine · **OPEN — do not implement around this**

Two formulas exist and disagree:

- `calcularMultas` — `monto_multa_por_accion × unidades × (temporadas_adeudadas − 1)`, flat.
- `calcularMultaVencimiento` — same, scaled by the fraction still unpaid, so an accionista who
  has abonado half owes half the fine.

README item 6 says the fine is **not** proportional: 5.000 per acción or hectárea. The user is
checking with the administration. Until that answer arrives, do not "correct" either formula
and do not build reporting that assumes one of them.

Related and equally open: when an abono covers an old temporada, is it charged at that
season's `valor_accion` or today's? (README item 23 — the user does not remember.)

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

---

## 4. Known gaps — code does not implement a decided rule

| | Gap | Rule violated |
|---|---|---|
| **G1** | Abonos are applied as an undifferentiated lump against the season subtotal; no oldest-first ordering, no deuda-before-multas ordering. `abonos.temporadas_cubiertas` is vestigial. | D3 |
| **G2** | The payment form accepts any amount and still marks the temporada settled. Likely behind README items 7 and 15 ("cuadrito amarillo" showing wrong debt). | D2 |
| **G3** | `accionistas:update` deletes and re-inserts all propiedades, destroying their ids on every save. | D7 |
| **G4** | `temporadas_adeudadas` has no derived default; it is 1 until a human changes it. | D4 |
| **G5** | Money is stored unrounded as `REAL`; rounding happens only at display. | D8 |
| **G6** | The cargo amount formula (`fija` vs `proporcional`) is written twice — once in TypeScript, once in SQL inside `deudores.ts` and `cargos.ts`. Changing one silently diverges from the other. | — |

None of these are safe to fix casually: G1, G2 and G5 all move numbers that the
administration reconciles by hand against paper receipts.

---

## 5. Open questions

1. **Flat or proportional late multa?** (D6) — user is asking the administration. Blocks any
   multa work.
2. **Old temporada at old or current `valor_accion`?** (D6) — blocks G1.
3. **Is `numero_ingreso` unique?** It is the number of a physical receipt book, entered by
   hand, and nothing enforces uniqueness. Migration v7 zeroed all existing values.
4. **Does RUT uniqueness matter?** (D12)

---

## 6. Verification reality

There are no tests — no unit, no e2e (README item 29 asks for them). `npm run typecheck` is
the only automated gate. Every money rule above is therefore unverified by machine: the only
check on `calcularDeuda`, the abono allocation and the multa formulas is a person comparing
the screen against paper.

Treat that as the main risk when changing anything in §3 or §4.
