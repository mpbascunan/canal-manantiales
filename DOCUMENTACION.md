# Documentación del Sistema Canal Rinconada de Manantiales

Este documento describe en detalle la lógica de negocio, los modelos de base de datos, las relaciones entre entidades y las fórmulas de cálculo utilizadas en la aplicación. Está pensado para quien no tiene conocimiento previo del código fuente.

> **Cómo leer este documento.** Aquí se describe **lo que el sistema hace hoy**. Las reglas de negocio y el porqué de cada decisión están en `context.md`, que es el documento que manda: si `context.md` y este archivo se contradicen, `context.md` tiene la razón y esto está desactualizado. Las secciones marcadas con **⚠ Pendiente** describen una regla ya decidida que el código todavía no implementa.

---

## Índice

1. [Propósito de la Aplicación](#1-propósito-de-la-aplicación)
2. [Conceptos Clave del Dominio](#2-conceptos-clave-del-dominio)
3. [Modelos de Base de Datos](#3-modelos-de-base-de-datos)
4. [Relaciones entre Entidades](#4-relaciones-entre-entidades)
5. [Fórmulas y Cálculos](#5-fórmulas-y-cálculos)
6. [Flujo de Pagos](#6-flujo-de-pagos)
7. [Abonos: qué son y cómo se reparten](#7-abonos-qué-son-y-cómo-se-reparten)
8. [Deuda Inicial (deuda anterior al sistema)](#8-deuda-inicial-deuda-anterior-al-sistema)
9. [Deudores](#9-deudores)
10. [Cargos](#10-cargos)
11. [Multas](#11-multas)
12. [Número de Ingreso](#12-número-de-ingreso)
13. [Temporadas](#13-temporadas)
14. [Resumen Contable](#14-resumen-contable)
15. [Avisos de Cobranza](#15-avisos-de-cobranza)

---

## 1. Propósito de la Aplicación

La aplicación gestiona la **contabilidad de cobros de agua** de la Sociedad de Canal Rinconada de Manantiales. Cada temporada agrícola (por ejemplo, "Temporada 2025-2026") los accionistas deben pagar una cuota proporcional a su participación en el canal, medida en **acciones** y **hectáreas**.

La aplicación permite:

- Registrar y consultar los pagos de cada temporada.
- Hacer seguimiento de quiénes adeudan (deudores), incluyendo temporadas anteriores.
- Registrar pagos parciales (abonos) y cobros adicionales (cargos).
- Calcular automáticamente la multa por atraso de cada temporada.
- Registrar la deuda que venía de antes de que existiera el sistema.
- Imprimir avisos de cobranza y comprobantes, y exportar resúmenes contables en Excel y PDF.

Es una aplicación de escritorio de **un solo usuario**, sin servidor y sin red. Los datos viven en un único archivo SQLite en el computador de la administración y no salen de ahí; por eso el respaldo es una función de primera clase.

---

## 2. Conceptos Clave del Dominio

| Término | Significado |
|---------|-------------|
| **Accionista** | Persona o entidad propietaria de derechos de agua en el canal. Tiene una o más propiedades asociadas. Se identifica por su **N° de socio**. |
| **Propiedad** | Una parcela, sitio o terreno de pequeño propietario, con su cantidad de acciones y hectáreas. Un accionista puede tener varias. |
| **Acciones** | Unidad de medida de derechos de agua. |
| **Hectáreas** | Segunda unidad de medida. **Se cobra exactamente igual que una acción.** |
| **Unidades** | No es un campo: es la cantidad derivada `acciones + hectáreas`. Todas las fórmulas de dinero se calculan por unidad. |
| **Temporada** | Período agrícola (ej. "2025-2026", de marzo a fines de febrero). Cada temporada tiene su propio `valor_accion`, su propia fecha límite de pago y su propio valor de multa. Solo una está activa. |
| **Cuota** | Lo que un accionista debe por una temporada: `valor_accion × unidades`. |
| **Pago** | Cancelación **completa** de una temporada. Un accionista tiene como máximo un pago por temporada. |
| **Abono** | Pago parcial. No cierra la temporada; se reparte automáticamente sobre lo que se debe. |
| **Cargo** | Cobro extra con nombre libre (limpia de acequia, cuota extraordinaria, multa por inasistencia…), dirigido a accionistas específicos de una temporada. |
| **Multa por atraso** | Penalización por pagar una temporada fuera de plazo. Se calcula sola a partir de la fecha límite de la temporada; nunca se emite a mano. |
| **Multa por inasistencia** | Pese al nombre, **es un cargo**: se emite a mano a accionistas determinados por faltar a una reunión o votación. No sigue las reglas de la multa por atraso. |
| **Deuda inicial** | Deuda anterior al sistema, transcrita desde los registros en papel de la administración. No se recalcula nunca. |
| **Deudor** | Accionista activo que no tiene pago para la temporada, **o** que tiene cualquier cargo impago. Un cargo nuevo reabre una cuenta que ya estaba saldada. |
| **N° Ingreso** | Número del talonario físico de recibos, escrito a mano al momento de pagar. Identifica un pago; es único. |
| **Respaldo** | Copia de seguridad de la base de datos hecha por el usuario. |

---

## 3. Modelos de Base de Datos

El esquema autoritativo es la constante `SCHEMA` en `src/main/db/connection.ts`. No existe ninguna otra copia: un espejo `schema.sql` existió, se desincronizó en silencio durante once migraciones, y se eliminó.

### 3.1 Tabla `temporadas`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `nombre` | TEXT UNIQUE | Nombre de la temporada (ej. "2025-2026") |
| `fecha_inicio` | TEXT | Fecha de inicio (ISO `YYYY-MM-DD`) |
| `fecha_fin` | TEXT | Fecha de término |
| `valor_accion` | REAL | Precio por unidad (acción u hectárea) **de esta temporada** |
| `activa` | INTEGER (0/1) | Solo una temporada puede estar activa a la vez |
| `nota_aviso` | TEXT | Mensaje opcional que se imprime en el aviso de cobranza |
| `fecha_multa` | DATE NULL | Fecha límite de pago. Si es `NULL`, esta temporada **nunca** genera multa |
| `monto_multa_por_accion` | REAL | Valor de la multa por unidad **de esta temporada** |

> Cada temporada guarda sus propios valores. Una temporada antigua se cobra al precio que tenía entonces, no al de hoy.

### 3.2 Tabla `accionistas`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `nombre` | TEXT NOT NULL | Nombres |
| `apellido_paterno` | TEXT | Apellido paterno |
| `apellido_materno` | TEXT | Apellido materno |
| `rut` | TEXT | RUT. Opcional, pero si se ingresa se valida con módulo 11. Es dato descriptivo: no identifica ni se usa para cruzar datos |
| `numero_socio` | TEXT | N° de socio de la asociación. Es **el** identificador del accionista y con él se cruzan las importaciones. **Único**: lo garantiza el índice parcial `idx_accionistas_numero_socio`, que ignora los registros sin número. El formulario y el importador también lo revisan (`context.md` D17) |
| `activo` | INTEGER (0/1) | Si está inactivo no aparece en deudores ni en formularios |
| `notas` | TEXT | Observaciones libres |

> **Nota:** `accionistas` no guarda acciones ni hectáreas. Los totales siempre se suman desde `propiedades`.

### 3.3 Tabla `propiedades`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `accionista_id` | INTEGER FK | Accionista dueño (borrado en cascada) |
| `nombre` | TEXT | Nombre tal como aparece en el listado de la administración (ej. "Parcela N°8 Lote A-2") |
| `tipo` | TEXT | `PARCELA`, `SITIO` o `PEQUEÑO_PROPIETARIO` |
| `acciones` | REAL | Acciones de esta propiedad |
| `hectareas` | REAL | Hectáreas de esta propiedad |
| `direccion` | TEXT | Rinconada de Manantiales, La Tuna, Las Canchillas |
| `marco` | TEXT | Canal principal, El Cerrillo, Cerro al Peñón, El Durazno, La Luquita, Los Ortices, Plaza Manantiales, Ramal 1 |

La propiedad se identifica por su **nombre**, no por un número: el listado de la administración la nombra así y así se imprime en el aviso.

### 3.4 Tabla `pagos`

Cada fila es un pago que **cancela por completo** una temporada para un accionista.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `numero_ingreso` | INTEGER | N° del talonario físico. **Único**: lo garantiza el índice parcial `idx_pagos_numero_ingreso`, que solo cubre los valores mayores que 0. El 0 significa "sin número registrado" y puede repetirse (`context.md` D16) |
| `accionista_id` | INTEGER FK | Accionista que paga |
| `temporada_id` | INTEGER FK | Temporada que se cancela |
| `fecha` | TEXT | Fecha del pago |
| `temporadas_pagadas` | INTEGER | Cuántas temporadas cubre el pago |
| `monto_acciones` | REAL | Monto cobrado por acciones y hectáreas |
| `multas` | REAL | Multas incluidas en el pago |
| `total` | REAL | Total efectivamente cobrado en este pago |
| `notas` | TEXT | Observaciones |
| `created_at` | TEXT | Marca de tiempo |

> **Restricción:** solo puede existir **un pago por accionista y temporada**.

> **Lo que significa un pago.** Existir es lo que cuenta: si hay un pago, la temporada está saldada, sin comparar montos. Un pago parcial debe registrarse como abono. Los campos de monto son el registro de lo cobrado, no la condición.

> **No agregar columnas de dinero aquí.** Cualquier cobro nuevo distinto de la cuota es un **cargo**. La migración v10 eliminó `cuota_extraordinaria` y `otros_ingresos` de `pagos`, `abonos` y `deudores_config` justamente por esto.

### 3.5 Tabla `abonos`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `numero_ingreso` | INTEGER | N° del talonario físico |
| `accionista_id` | INTEGER FK | Accionista que abona |
| `temporada_id` | INTEGER FK | Temporada en que se registra el abono |
| `fecha` | TEXT | Fecha del abono. **Determina qué multas alcanza a reducir** |
| `temporadas_cubiertas` | INTEGER | Heredado; un abono no cierra temporadas |
| `monto` | REAL | Monto abonado a cuota |
| `multas` | REAL | Parte del abono imputada a multas |
| `total` | REAL | Total del abono. Es la cifra que se reparte |
| `notas` | TEXT | Observaciones |
| `created_at` | TEXT | Marca de tiempo |

### 3.6 Tabla `deudores_config` — eliminada

Guardaba `temporadas_adeudadas`, un contador de temporadas impagas que se cobraba entero al precio de la temporada **activa**, repreciando una temporada antigua al valor de hoy. La migración v16 elimina la tabla: la deuda anterior al sistema entra como `deuda_inicial` y la posterior se deriva de las temporadas reales, cada una con su propio precio. Con eso el contador no responde ninguna pregunta. Ver `context.md` D19.

Las filas se eliminan sin convertirse en montos: el contador nunca fue una cifra — dice cuántas temporadas debía alguien, no cuánto — y cualquier monto reconstruido a partir de él quedaría al precio de hoy.

### 3.7 Tabla `cargos`

Define el cargo: su nombre, la temporada a la que pertenece y **la tarifa**, no el monto por persona.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `nombre` | TEXT | Nombre del cargo (ej. "Limpia de acequia") |
| `temporada_id` | INTEGER FK | Temporada a la que pertenece |
| `tarifa` | REAL | Valor base del cargo |
| `tipo_tarifa` | TEXT | `fija` o `proporcional` |
| `fecha` | TEXT | Fecha del cargo |
| `notas` | TEXT | Observaciones |
| `created_at` | TEXT | Marca de tiempo |

### 3.8 Tabla `cargo_accionistas`

A quiénes se les cobra el cargo.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `cargo_id` | INTEGER FK | Cargo (borrado en cascada) |
| `accionista_id` | INTEGER FK | Accionista al que se cobra |
| `monto` | REAL | Monto guardado. **El cálculo lo ignora**: el monto se recalcula desde la tarifa |
| `pagado` | INTEGER (0/1) | Saldado por un pago o marcado a mano |

Es única la combinación `(cargo_id, accionista_id)`: un accionista no puede aparecer dos veces en el mismo cargo.

### 3.9 Tabla `deuda_inicial`

Deuda anterior al sistema, transcrita desde los registros de la administración.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `accionista_id` | INTEGER FK | Accionista (borrado en cascada) |
| `concepto` | TEXT | Texto libre, ej. "Multa temporada 2024-2025". Se imprime en el aviso |
| `tipo` | TEXT | `CUOTA`, `OTRO` o `MULTA` — también es el orden en que se cobran |
| `monto` | REAL | El monto tal como lo tiene la administración |
| `notas` | TEXT | Observaciones |
| `created_at` | TEXT | Marca de tiempo |

Se guarda **por líneas** y no como un total único, para que quepa tanto un desglose por temporada como una cifra global. No tiene columna `pagado`: es la deuda más antigua que existe, así que los abonos la consumen primero y lo que queda debiendo se deriva, igual que todo lo demás. Eso es lo que permite pagarla por partes.

---

## 4. Relaciones entre Entidades

```
temporadas
    │
    ├──< pagos >────────── accionistas ──< propiedades
    ├──< abonos >─────────┤
    │                     ├──< deuda_inicial
    └──< cargos >──< cargo_accionistas >──┘
```

- Un **accionista** tiene una o más **propiedades** (1:N). Sus acciones y hectáreas son siempre la suma de ellas.
- Un **accionista** puede tener múltiples **abonos** por temporada (1:N).
- Un **accionista** tiene como máximo **un pago** por temporada.
- Un **cargo** pertenece a una temporada y se cobra a varios accionistas mediante `cargo_accionistas` (N:M).
- Un **accionista** puede tener varias líneas de **deuda inicial**, que no dependen de ninguna temporada.

---

## 5. Fórmulas y Cálculos

Todo el cálculo de deuda vive en un solo lugar: `calcularDeudaPorTemporada`, en `src/shared/deuda.ts`. Está en `src/shared/` para que el proceso principal y la interfaz ejecuten **el mismo código** y no dos copias que se desincronicen.

### 5.1 Unidades

```
unidades = acciones + hectareas
```

Una hectárea se cobra exactamente igual que una acción. No es una simplificación: el canal cobra lo mismo por una que por otra. Las acciones y hectáreas de un accionista son siempre la **suma de todas sus propiedades**.

### 5.2 Cuota de una temporada

```
cuota(t) = t.valor_accion × unidades
```

Cada temporada usa **su propio** `valor_accion`. Una temporada de hace tres años se cobra al precio que tenía entonces.

**Ejemplo:** temporada con `valor_accion = $41.000`, accionista con `2 acciones` y `3 hectáreas`:

```
cuota = 41.000 × (2 + 3) = $205.000
```

### 5.3 Monto de un cargo

```
si tipo_tarifa = 'fija'          →  monto = tarifa
si tipo_tarifa = 'proporcional'  →  monto = tarifa × unidades
```

### 5.4 Multa por atraso

La multa **no es un monto fijo**: es proporcional a la parte de la cuota que seguía impaga **en la fecha límite**. Se calcula una vez por cada temporada adeudada, con los valores de esa temporada, y se suman:

```
multa = Σ  para cada temporada t con fecha_multa definida y ya vencida:
             fracción_pendiente(t) × unidades × t.monto_multa_por_accion

fracción_pendiente(t) = 1 − (abonado a t con fecha ≤ t.fecha_multa) ÷ cuota(t)
```

Cuatro reglas, cada una decidida por separado:

1. **Es proporcional, no fija.** Un accionista que debía el 20% de su cuota al vencer el plazo paga el 20% de la multa.
2. **Se mide en la fecha límite, no hoy.** Solo cuentan los abonos con fecha **anterior o igual** a `fecha_multa`; los posteriores no reducen la multa. Es lo que hace que la multa sea cobrable: como los abonos pagan primero la deuda y al final las multas, medirla contra el saldo actual la dejaría en cero apenas se salda la cuota, y nadie pagaría una multa nunca.
3. **El denominador es solo la cuota**, sin los cargos de esa temporada. Los cargos tienen su propio estado de pago, y cobrar multa por atraso sobre una multa por inasistencia impaga sería una multa sobre una multa.
4. **Depende de la fecha.** Una temporada genera multa solo si `fecha_multa` está definida y ya pasó. Si es `NULL`, esa temporada no genera multa nunca.

**Ejemplo:** accionista con `5 unidades`, cuota de `$205.000`, `monto_multa_por_accion = $5.000`, que al vencer el plazo había abonado `$41.000`:

```
fracción_pendiente = 1 − 41.000 / 205.000 = 0,8
multa              = 0,8 × 5 × 5.000 = $20.000
```

### 5.5 Total pendiente

```
total_pendiente = deuda inicial pendiente
                + Σ por temporada (cuota pendiente + cargos pendientes + multa pendiente)
```

Donde "pendiente" es el monto menos lo que le tocó de los abonos según el reparto de la sección 7.

### 5.6 Redondeo

Los pesos chilenos no tienen decimales. Cada monto se redondea a peso entero con `roundPesos`, **al escribirlo** en la base de datos: pagos, abonos, la tarifa de un cargo y cada monto derivado de ella, las líneas de deuda inicial, y el `valor_accion` y `monto_multa_por_accion` de una temporada.

Antes el redondeo ocurría solo al mostrar, sobre columnas `REAL` sin redondear, y por eso una columna de montos en pantalla podía no sumar exactamente el total que se mostraba abajo. Ahora la cifra guardada y la mostrada son el mismo número. Ver `context.md` D8. Las acciones y hectáreas conservan sus 4 decimales: esta regla es solo para dinero.

---

## 6. Flujo de Pagos

### Registro de un pago completo

1. El usuario selecciona el accionista en el formulario "Nuevo Pago".
2. El sistema carga su deuda completa desde `deudores:get-deuda`: deuda inicial, cada temporada con saldo, sus cargos y su multa.
3. Se muestra el total pendiente, lo ya abonado y lo que queda por cobrar.
4. El sistema verifica que no exista ya un pago para ese accionista y temporada.
5. Al confirmar se crea el registro en `pagos` y el accionista deja de figurar como deudor — salvo que le quede algún cargo impago, que lo reabre.

> **El monto no se escribe a mano.** En el pago completo los únicos campos editables son la temporada, la fecha, el N° de ingreso y las notas. Todas las cifras salen del cálculo de deuda: el monto por acciones es la suma de las cuotas pendientes, las multas la suma de las multas pendientes, y el total es el pendiente completo. Como no hay monto escrito a mano, no puede haber un error de tipeo que dé por pagado a alguien que no pagó.

El único monto que se escribe a mano es el del **abono**, y un abono nunca cierra una temporada.

### Registro de un abono

1. El usuario entra desde "Nuevo Pago" (pestaña "Abono") o desde "Deudores".
2. El sistema muestra la deuda total, lo abonado y lo pendiente.
3. El usuario ingresa el monto (viene pre-rellenado con el pendiente).
4. Se crea el registro en `abonos`. El accionista sigue como deudor.
5. Opcionalmente se genera un comprobante PDF con el saldo restante.

---

## 7. Abonos: qué son y cómo se reparten

Un **abono** es un pago parcial. A diferencia del pago completo, no cierra la temporada y se pueden registrar varios.

### El orden del reparto

Los abonos se toman como un fondo común, en orden de fecha, y se consumen **de la deuda más antigua a la más nueva**:

1. **Deuda inicial** (lo anterior al sistema), y dentro de ella: `CUOTA`, luego `OTRO`, luego `MULTA`.
2. **Cada temporada, de la más antigua a la más nueva**, y dentro de cada una:
   1. la **cuota**,
   2. los **cargos**,
   3. la **multa por atraso**.

Una temporada se salda **por completo** — cuota, cargos y multa — antes de que el dinero llegue a la siguiente. Es decir: si quedan dos temporadas debiendo y el abono cubre la primera cuota y sobra, lo que sobra paga la **multa de esa primera temporada**, no la cuota de la segunda.

Lo que sobra una vez cubierto todo se informa como **excedente a favor**; no se pierde ni se descarta en silencio.

### Por qué importa la fecha del abono

El total no cambia según el orden, pero la **fecha** sí importa para las multas: solo el dinero que llegó antes de la fecha límite de una temporada reduce la multa de esa temporada (sección 5.4).

---

## 8. Deuda Inicial (deuda anterior al sistema)

Cuando la administración empezó a usar el sistema, muchos accionistas ya arrastraban deuda. Esa deuda **se transcribe, no se reconstruye**: se ingresa la cifra que tiene la administración en sus registros, y no se recalcula nunca. La cifra *es* el hecho.

Se ingresa en líneas, cada una con su concepto, su tipo (`CUOTA`, `OTRO` o `MULTA`) y su monto. Se puede cargar a mano en la ficha del accionista o importarla desde Excel.

**No es un cargo**, aunque los cargos sean la vía normal para cobrar algo distinto de la cuota. Un cargo se define por una tarifa y su monto por persona se recalcula desde ella, así que un cargo no puede llevar una cifra distinta para cada accionista. Un saldo inicial no es un cobro nuevo: es el punto de partida.

Las líneas de tipo `MULTA` **no** se cuentan en el total de multas del sistema, que solo incluye las multas por atraso calculadas por la aplicación.

> **⚠ Abierto.** Falta decidir si esas multas heredadas, cuando se cobran, aparecen como ingreso por multa en el resumen contable. La propuesta es mostrarlas en una línea propia, "Multa temporadas pasadas", pero está pendiente de confirmación con la asociación.

---

## 9. Deudores

La pantalla "Deudores" muestra los accionistas activos con deuda pendiente.

**Un accionista es deudor si** no tiene pago para la temporada **o** tiene cualquier cargo impago. Un cargo agregado después reabre una cuenta que ya estaba saldada — es deliberado: la alternativa sería que los cobros quedaran invisibles hasta la temporada siguiente.

### Qué muestra cada fila

| Columna | Cálculo |
|---------|---------|
| **Cuotas** | Suma de las cuotas pendientes de todas las temporadas adeudadas, cada una a su propio `valor_accion` |
| **Cargos** | Suma de los cargos impagos |
| **Multas** | Suma de las multas por atraso, calculadas según la sección 5.4 |
| **Abonado** | Total de abonos del accionista |
| **Pendiente** | Lo que queda por cobrar una vez repartidos los abonos |

Tanto esta pantalla como la ficha del accionista, el formulario de pago y el aviso de cobranza leen **el mismo cálculo** (`deudores:get-deuda`), de modo que no pueden mostrar cifras distintas entre sí.

---

## 10. Cargos

Los cargos son cobros adicionales con **nombre libre**, dirigidos a uno o varios accionistas de una temporada. Son la única vía para cobrar algo distinto de la cuota.

**Ejemplos de uso:** limpia de acequia, cuota extraordinaria, multa por inasistencia a reunión, multa por inasistencia a votación. Estas cuatro deben aparecer siempre como opción, y además se pueden crear cargos nuevos.

### Tarifa fija o proporcional

Un cargo no siempre se reparte según las acciones:

| `tipo_tarifa` | Monto por accionista |
|---------------|----------------------|
| `fija` | `tarifa` — el mismo monto para todos |
| `proporcional` | `tarifa × unidades` — a más acciones y hectáreas, más paga |

### Creación en lote

Al crear un cargo el usuario puede seleccionar varios accionistas a la vez. Se crea un cargo y una fila en `cargo_accionistas` por cada accionista seleccionado.

### Estado del cargo

Cada cargo tiene estado **pendiente** o **pagado**. `pagado` significa saldado por un pago o marcado a mano. La cobertura por abonos **no** lo cambia: eso se deriva del reparto de abonos, no se guarda.

### Los cargos se cobran en la temporada siguiente

Un cargo emitido durante una temporada se cobra junto con ella y aparece en el aviso de cobranza dentro del bloque de esa temporada.

---

## 11. Multas

Hay **dos cosas distintas que se llaman multa**, y no se calculan igual:

| | Multa por atraso | Multa por inasistencia |
|---|---|---|
| Qué es | Penalización por pagar fuera de plazo | Penalización por faltar a una reunión o votación |
| Cómo se crea | Automática, calculada por el sistema | A mano, como **cargo**, a accionistas determinados |
| Dónde se guarda | No se guarda: se calcula al momento | En `cargos` / `cargo_accionistas` |
| Fórmula | Sección 5.4 | La del cargo: fija o proporcional |

La **multa por atraso** no se almacena en ninguna tabla. Se recalcula cada vez a partir de la fecha límite de cada temporada, su valor de multa y los abonos con su fecha. Se decidió así a propósito: no hay filas que "cristalizar" ni proceso que deba correr a medianoche, cosa importante en una aplicación que solo existe cuando alguien la abre.

La fecha límite de pago se puede mover: es un campo de la temporada (`fecha_multa`). Si se corre hacia adelante, las multas de esa temporada se recalculan solas.

---

## 12. Número de Ingreso

El **N° Ingreso** es el número del **talonario físico de recibos** que se entrega al accionista. Se escribe a mano al momento de pagar; no lo genera el sistema.

El sistema sugiere el siguiente número disponible al abrir un formulario de pago o abono, y el usuario puede cambiarlo:

```
próximo_número = MAX(numero_ingreso en pagos, numero_ingreso en abonos) + 1
```

**Es único:** un recibo, un número, y no se reutiliza. Lo garantiza `idx_pagos_numero_ingreso`, un índice único **parcial** sobre `pagos` que solo cubre los valores mayores que 0: el 0 no es un número de recibo sino "sin número registrado" — es lo que dejó la migración v7 y lo que queda si nadie escribe uno — y varios pagos pueden estar legítimamente en ese estado. Ver `context.md` D16.

Los abonos quedan deliberadamente fuera del índice: un recibo que abarcara las dos tablas no se puede expresar con un solo índice.

> **Ojo al leer el Excel de la administración.** En el listado de accionistas el mismo número de ingreso aparece repetido en **cada fila de propiedad** que cubre ese pago, y a veces en filas de personas distintas de una misma familia o sucesión. Eso no son pagos distintos: es un solo pago escrito en varias filas. En el archivo de *Ingresos*, que es de donde se leen los pagos, cada recibo es una sola fila con un solo pagador y un solo total.

---

## 13. Temporadas

Cada temporada define el contexto económico de su período:

- Va aproximadamente de **marzo a fines de febrero** del año siguiente.
- **Solo una temporada está activa a la vez.** Al activar una, las demás quedan inactivas.
- Cada temporada guarda **su propio** `valor_accion`, `fecha_multa` y `monto_multa_por_accion`. Una temporada antigua se cobra con sus valores, no con los de la temporada activa.
- Los pagos y abonos siempre se asocian a una temporada.

**El sistema solo calcula deuda de las temporadas que él mismo administró.** No se cargan temporadas históricas ni se reconstruyen sus valores: lo anterior al sistema entra como deuda inicial (sección 8), con las cifras del papel, que son las que valen.

---

## 14. Resumen Contable

La pantalla "Resumen Contable" muestra lo recaudado en una temporada: **pagos + abonos**.

### Totales generales

Suma de `monto_acciones`, `multas` y `total` de los pagos y abonos de la temporada, más lo recaudado por cargos.

Los cargos cuyo nombre contiene "multa" se cuentan como **ingreso por multas**; el resto aparece en su propia línea. De esta forma el ingreso por multas incluye los dos tipos de multa.

### Desglose mensual

Los mismos totales agrupados por mes, para informes de caja y rendición de cuentas.

### Exportar los ingresos de una temporada

La pantalla "Pagos por Mes" tiene un selector **Por mes / Por temporada**. En modo temporada lista todos los ingresos de la temporada elegida y el botón "Exportar Excel" genera una planilla con pagos y abonos juntos, ordenados por fecha, con un subtotal por mes y el total general. Los abonos van incluidos porque la recaudación de una temporada no son solo sus pagos completos; la columna `Tipo` los distingue.

> **Importante:** el `total` de un pago con abonos previos ya descuenta lo abonado. Por eso, para saber lo realmente recaudado en la temporada hay que sumar abonos **y** pagos; sumar solo los pagos dejaría fuera dinero que sí entró.

---

## 15. Avisos de Cobranza

El **aviso de cobranza** es la hoja que se imprime y se entrega al accionista, y contra la cual paga en la oficina. Por eso **cobra toda la deuda vigente al día en que se imprime**, no solamente la cuota de la temporada activa.

### Qué incluye, en este orden

1. **Temporadas anteriores** — las líneas de deuda inicial que aún tengan saldo, con su tipo (Cuota / Multa / Otro) y su concepto.
2. **Cada temporada con saldo pendiente, de la más antigua a la más nueva**, y dentro de cada una:
   - **Cuota por acciones** — lo que queda por pagar de esa temporada, ya descontados los abonos aplicados a ella. Si hubo abonos, la línea lo indica: *"Cuota por acciones · abonado $100.000"*.
   - **Cargos pendientes** de esa temporada (limpia de acequia, cuota extraordinaria, multa por inasistencia, etc.).
   - **Cargos ya pagados**, en gris y sin cobrar, solo como constancia.
   - **Multa por atraso** de esa temporada, calculada con las reglas de la temporada correspondiente.
3. **TOTAL A PAGAR** — la suma de todas las líneas cobradas, idéntica al total pendiente que muestra la ficha del accionista y la pantalla de Deudores.
4. **Excedente a favor**, si el accionista abonó más de lo que debía.
5. La **nota de la temporada** (`nota_aviso`), si está configurada.

Cuando el aviso incluye una sola temporada y no hay deuda anterior, se omiten los títulos por temporada: la hoja se lee como una cuenta simple.

### Desglose por propiedad

Si el accionista tiene **más de una propiedad** y **no ha abonado nada** contra la cuota de esa temporada, la cuota se desglosa propiedad por propiedad (*"Parcela N°8 (8 acc)"*), cerrando con un subtotal. Ese desglose es informativo: lo que se cobra es el subtotal.

Si ya abonó parte de la cuota, el desglose no se imprime — repartir el saldo entre las propiedades supondría una asignación que nadie decidió. En su lugar se imprime la cuota completa de la temporada con lo abonado indicado al lado.

### Dónde se genera

| Pantalla | Botón | Qué imprime |
|----------|-------|-------------|
| Ficha del accionista | "Imprimir aviso" | Un aviso, con vista previa antes de descargar. Incluye el listado de propiedades del accionista. |
| Inicio | "PDF Deudores" | Un aviso por cada accionista con deuda pendiente. |
| Inicio | "PDF Todos los accionistas" | Un aviso por cada accionista activo. A quien no debe nada se le imprime igual, con la línea "Sin deuda pendiente" y total $0. |

En todos los casos el aviso se arma con el mismo cálculo de deuda que usa la aplicación en pantalla (`deudores:get-deuda`), de modo que el papel y la pantalla nunca pueden mostrar cifras distintas.

---

## Tecnología

| Componente | Tecnología |
|------------|-----------|
| Framework escritorio | Electron |
| Frontend | React 19 + TypeScript |
| Base de datos | SQLite (better-sqlite3) |
| Estilos | Tailwind CSS |
| Exportación | XLSX (Excel), jsPDF (PDF) |
| Build | Vite + electron-vite |
