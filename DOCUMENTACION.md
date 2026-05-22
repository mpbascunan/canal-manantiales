# Documentación del Sistema Canal Rinconada de Manantiales

Este documento describe en detalle la lógica de negocio, los modelos de base de datos, las relaciones entre entidades y las fórmulas de cálculo utilizadas en la aplicación. Está pensado para quien no tiene conocimiento previo del código fuente.

---

## Índice

1. [Propósito de la Aplicación](#1-propósito-de-la-aplicación)
2. [Conceptos Clave del Dominio](#2-conceptos-clave-del-dominio)
3. [Modelos de Base de Datos](#3-modelos-de-base-de-datos)
4. [Relaciones entre Entidades](#4-relaciones-entre-entidades)
5. [Fórmulas y Cálculos](#5-fórmulas-y-cálculos)
6. [Flujo de Pagos](#6-flujo-de-pagos)
7. [Abonos: qué son y cómo funcionan](#7-abonos-qué-son-y-cómo-funcionan)
8. [Deudores y Configuración de Deuda](#8-deudores-y-configuración-de-deuda)
9. [Cargos](#9-cargos)
10. [Multas](#10-multas)
11. [Número de Ingreso](#11-número-de-ingreso)
12. [Temporadas](#12-temporadas)
13. [Resumen Contable](#13-resumen-contable)

---

## 1. Propósito de la Aplicación

La aplicación gestiona la **contabilidad de cobros de agua** de la Sociedad de Canal Rinconada de Manantiales. Cada temporada agrícola (por ejemplo, "Temporada 2024-2025") los accionistas deben pagar una cuota proporcional a su participación en el canal, medida en **acciones** y **hectáreas**.

La aplicación permite:
- Registrar y consultar los pagos de cada temporada.
- Hacer seguimiento de quiénes adeudan (deudores).
- Registrar pagos parciales (abonos) y cobros adicionales (cargos).
- Calcular multas por temporadas adeudadas.
- Exportar resúmenes contables e informes en Excel y PDF.

---

## 2. Conceptos Clave del Dominio

| Término | Significado |
|---------|-------------|
| **Accionista** | Persona o entidad propietaria de derechos de agua en el canal. Tiene una o más propiedades asociadas. |
| **Propiedad** | Una parcela, sitio o terreno con una cantidad específica de acciones y hectáreas. Un accionista puede tener varias propiedades. |
| **Acciones** | Unidad de medida de derechos de agua. Junto con las hectáreas, determinan el monto a pagar. |
| **Hectáreas** | Segunda unidad de medida que complementa las acciones para calcular el pago. |
| **Temporada** | Período agrícola (ej. "2024-2025"). Cada temporada tiene un `valor_accion` que determina el precio base del cobro. |
| **Pago** | Cancelación completa de la deuda de un accionista para una temporada. Un accionista solo puede tener un pago por temporada. |
| **Abono** | Pago parcial que reduce la deuda pero no la cancela por completo. Se pueden registrar múltiples abonos por accionista y temporada. |
| **Multa** | Penalización por temporadas adeudadas (no pagadas a tiempo). Se calcula automáticamente. |
| **Cuota Extraordinaria** | Cobro adicional puntual, distinto a la cuota base y a los cargos. Se define por deudor en la configuración de deuda. |
| **Cargo** | Cobro extra con nombre libre (ej. "Limpieza", "Mantención canal") asociado a uno o más accionistas para una temporada. |
| **Deudor** | Accionista activo que no ha realizado el pago completo de la temporada activa. |
| **N° Ingreso** | Número de comprobante único y secuencial para cada pago o abono registrado. |

---

## 3. Modelos de Base de Datos

### 3.1 Tabla `temporadas`

Representa cada período agrícola.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `nombre` | TEXT UNIQUE | Nombre de la temporada (ej. "2024-2025") |
| `fecha_inicio` | TEXT | Fecha de inicio (formato ISO: YYYY-MM-DD) |
| `fecha_fin` | TEXT | Fecha de término |
| `valor_accion` | REAL | Precio base por unidad (acción o hectárea). Se usa en todas las fórmulas de cobro. |
| `activa` | INTEGER (0/1) | Solo una temporada puede estar activa a la vez. Es la que aparece por defecto en formularios. |
| `nota_aviso` | TEXT | Mensaje opcional que aparece como advertencia al registrar pagos. |

### 3.2 Tabla `accionistas`

Representa a cada titular de derechos de agua.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `numero` | TEXT | Número de propiedad principal (campo legado, usar `propiedades`) |
| `nombre` | TEXT NOT NULL | Nombre del accionista (debe ser único) |
| `tipo` | TEXT | Tipo principal: `PARCELA`, `SITIO`, o `PEQUEÑO_PROPIETARIO` |
| `acciones` | REAL | Acciones totales (campo legado; el sistema suma desde `propiedades`) |
| `hectareas` | REAL | Hectáreas totales (campo legado; ídem) |
| `activo` | INTEGER (0/1) | Si está inactivo, no aparece en la lista de deudores ni en formularios |
| `notas` | TEXT | Observaciones libres |

> **Nota:** Los campos `acciones`, `hectareas` y `numero` en `accionistas` son datos legados. El sistema usa la tabla `propiedades` para calcular los totales reales. Siempre se muestran los valores agregados desde `propiedades`.

### 3.3 Tabla `propiedades`

Cada fila es una propiedad individual de un accionista. Un accionista puede tener varias propiedades con distintos tipos y cantidades.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `accionista_id` | INTEGER FK | Referencia al accionista dueño |
| `numero` | TEXT | Número de la propiedad (ej. "84", "14", "47-A") |
| `tipo` | TEXT | `PARCELA`, `SITIO`, o `PEQUEÑO_PROPIETARIO` |
| `acciones` | REAL | Acciones de esta propiedad específica |
| `hectareas` | REAL | Hectáreas de esta propiedad específica |

El sistema suma automáticamente las acciones y hectáreas de todas las propiedades del accionista para aplicar las fórmulas de cobro.

### 3.4 Tabla `pagos`

Cada fila representa un pago completo que cancela la deuda de un accionista para una temporada.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `numero_ingreso` | INTEGER | N° de comprobante (secuencia compartida con abonos) |
| `accionista_id` | INTEGER FK | Accionista que paga |
| `temporada_id` | INTEGER FK | Temporada a la que corresponde el pago |
| `fecha` | TEXT | Fecha del pago |
| `temporadas_pagadas` | INTEGER | Cuántas temporadas cubre este pago (puede ser más de una si hay deuda acumulada) |
| `monto_acciones` | REAL | Monto calculado por acciones y hectáreas |
| `multas` | REAL | Multas incluidas en este pago |
| `cuota_extraordinaria` | REAL | Cobro adicional particular |
| `otros_ingresos` | REAL | Otros montos cobrados |
| `total` | REAL | Suma de todos los campos anteriores, descontando abonos ya realizados |
| `notas` | TEXT | Observaciones opcionales |
| `created_at` | TEXT | Marca de tiempo de creación |

> **Restricción de negocio:** Solo puede existir **un pago por accionista por temporada**. El sistema bloquea el registro si ya existe un pago para esa combinación.

> **Abonos y total:** Cuando un accionista ha realizado abonos previos, el campo `total` del pago guarda solo el monto efectivamente cobrado en ese pago final (es decir, la diferencia entre el monto total adeudado y lo ya abonado).

### 3.5 Tabla `abonos`

Pagos parciales que reducen la deuda sin cancelarla por completo.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `numero_ingreso` | INTEGER | N° de comprobante (misma secuencia que pagos) |
| `accionista_id` | INTEGER FK | Accionista que abona |
| `temporada_id` | INTEGER FK | Temporada a la que corresponde |
| `fecha` | TEXT | Fecha del abono |
| `temporadas_cubiertas` | INTEGER | Siempre 0 en abonos (no cierra la deuda) |
| `monto` | REAL | Monto del abono aplicado a acciones/hectáreas |
| `multas` | REAL | Parte de multas incluidas en el abono |
| `cuota_extraordinaria` | REAL | Parte de cuota extraordinaria |
| `otros_ingresos` | REAL | Otros importes |
| `total` | REAL | Suma de todos los campos del abono |
| `notas` | TEXT | Observaciones opcionales |
| `created_at` | TEXT | Marca de tiempo de creación |

### 3.6 Tabla `deudores_config`

Configuración específica por accionista y temporada para el cálculo de la deuda. Esta tabla permite personalizar cuántas temporadas adeuda un accionista y si tiene cobros adicionales particulares.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `accionista_id` | INTEGER PK | Accionista (clave compuesta con temporada_id) |
| `temporada_id` | INTEGER PK | Temporada |
| `temporadas_adeudadas` | INTEGER | Número de temporadas sin pagar (mínimo 1) |
| `cuota_extraordinaria` | REAL | Cobro adicional específico para este deudor |
| `otros_ingresos` | REAL | Otros importes específicos para este deudor |

### 3.7 Tabla `cargos`

Cobros extras con nombre libre asociados a accionistas específicos.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | INTEGER PK | Identificador único |
| `nombre` | TEXT | Nombre del cargo (ej. "Limpieza", "Mantención canal") |
| `accionista_id` | INTEGER FK | Accionista al que se le cobra |
| `temporada_id` | INTEGER FK | Temporada a la que pertenece |
| `monto` | REAL | Monto del cargo |
| `fecha` | TEXT | Fecha asignada al cargo |
| `pagado` | INTEGER (0/1) | Indica si el cargo ya fue cobrado |
| `notas` | TEXT | Observaciones opcionales |
| `created_at` | TEXT | Marca de tiempo de creación |

---

## 4. Relaciones entre Entidades

```
temporadas
    │
    ├──< pagos >──── accionistas >──< propiedades
    ├──< abonos >─┘
    ├──< deudores_config >─┘
    └──< cargos >─┘
```

- Un **accionista** tiene una o más **propiedades** (relación 1:N).
- Un **accionista** puede tener múltiples **abonos** en una misma temporada (1:N).
- Un **accionista** solo puede tener **un pago** por temporada (relación 1:1 lógica).
- Existe como máximo **una configuración de deuda** por accionista y temporada (`deudores_config` es 1:1 por combinación).
- Un **cargo** está asociado a exactamente un accionista y una temporada, pero se pueden crear lotes (batch) del mismo cargo para múltiples accionistas a la vez.

---

## 5. Fórmulas y Cálculos

### 5.1 Monto por Acciones

El monto base que un accionista debe pagar se calcula así:

```
montoAcciones = (valorAccion × acciones + valorAccion × hectareas) × temporadasPagadas
             = valorAccion × (acciones + hectareas) × temporadasPagadas
```

**Donde:**
- `valorAccion` es el precio unitario definido en la temporada activa.
- `acciones` y `hectareas` son los totales sumados de todas las propiedades del accionista.
- `temporadasPagadas` es el número de temporadas que se están cancelando (puede ser más de una si hay deuda acumulada de años anteriores).

**Ejemplo:** Si `valorAccion = $50.000`, el accionista tiene `2 acciones` y `3 hectáreas`, y paga `1 temporada`:
```
montoAcciones = 50.000 × (2 + 3) × 1 = $250.000
```

### 5.2 Multas

La multa penaliza las temporadas no pagadas a tiempo:

```
multas = 5.000 × acciones × hectareas × periodosAtrasados
```

**Regla especial:** Si `acciones` es 0, se usa 1. Si `hectareas` es 0, se usa 1. Esto evita que accionistas sin datos registrados queden exentos de multas.

**Ejemplo:** Accionista con `2 acciones`, `3 hectáreas`, `2 períodos atrasados`:
```
multas = 5.000 × 2 × 3 × 2 = $60.000
```

**Ejemplo con datos vacíos (acciones=0, hectareas=0):**
```
multas = 5.000 × 1 × 1 × 2 = $10.000
```

### 5.3 Total a Pagar

```
total = montoAcciones + multas + cuotaExtraordinaria + otrosIngresos
```

### 5.4 Total con Abonos Descontados (Pago Final)

Cuando un accionista ha realizado abonos previos y finalmente hace el pago completo, el total que se cobra en ese pago final descuenta lo ya abonado:

```
totalPagoFinal = max(0, total - totalAbonado)
```

Esto significa que el campo `total` en la tabla `pagos` representa solo lo cobrado en ese último pago, no la deuda original. Para el análisis contable completo se suman los abonos más el pago final.

---

## 6. Flujo de Pagos

### Registro de un Pago Completo

1. El usuario selecciona el accionista en el formulario "Nuevo Pago".
2. El sistema carga automáticamente:
   - Sus acciones y hectáreas totales.
   - Las temporadas adeudadas desde `deudores_config` (o 1 por defecto).
   - Los abonos previos ya realizados (`total_abonado`).
3. Se calcula el monto por acciones, las multas (opcionalmente), y el total.
4. Si hay abonos previos, se muestra el descuento y el **total a pagar** es la diferencia.
5. El sistema verifica que no exista ya un pago para ese accionista y temporada.
6. Al confirmar, se crea un registro en la tabla `pagos` y el accionista deja de aparecer en la lista de deudores.

### Registro de un Abono

1. El usuario accede desde "Nuevo Pago" (pestaña "Abono") o desde "Deudores".
2. El sistema muestra la deuda total, lo abonado y el pendiente.
3. El usuario ingresa el monto a abonar (se pre-rellena con el pendiente).
4. Se crea un registro en la tabla `abonos`. El accionista sigue apareciendo como deudor.
5. Opcionalmente se genera un comprobante PDF con el saldo restante.

---

## 7. Abonos: qué son y cómo funcionan

Un **abono** es un pago parcial. A diferencia del pago completo, un abono:

- **No cierra la deuda.** El accionista sigue apareciendo en la lista de deudores.
- Se pueden registrar **múltiples abonos** para el mismo accionista y temporada.
- El campo `total_abonado` se calcula dinámicamente como la **suma de todos los abonos** para ese accionista y temporada.
- Los abonos se descuentan automáticamente al registrar el pago final.

**Regla:** El sistema no bloquea registrar abonos si ya existe un pago completo, pero sí muestra una advertencia, ya que sería incoherente abonar a una deuda ya cancelada.

---

## 8. Deudores y Configuración de Deuda

La pantalla "Deudores" muestra todos los accionistas activos **que no tienen un pago completo** para la temporada activa.

### Qué muestra cada fila:

| Columna | Cálculo |
|---------|---------|
| **Monto adeudado** | `valorAccion × (acciones + hectareas) × temporadasAdeudadas` |
| **Multas** | `5.000 × acciones × hectareas × temporadasAdeudadas` |
| **Total** | Monto adeudado + Multas + Cuota Extraordinaria + Otros Ingresos |
| **Ya abonado** | Suma de todos los abonos de ese accionista para la temporada |
| **Pendiente** | Total − Ya abonado |

### Configuración de deuda (`deudores_config`)

Desde la pantalla de Deudores, se puede editar para cada accionista:
- **Temporadas adeudadas:** Cuántas temporadas arrastra sin pagar. Por defecto es 1.
- **Cuota Extraordinaria:** Un cobro adicional específico para ese deudor.
- **Otros Ingresos:** Otros importes a cobrar al deudor.

Estos valores se guardan en `deudores_config` y se usan al registrar el pago o abono.

---

## 9. Cargos

Los cargos son cobros adicionales con **nombre libre** (definido por el usuario) que se asocian a uno o más accionistas para una temporada específica.

**Ejemplos de uso:**
- "Limpieza" — cobro por servicio de limpieza del canal que contrató un grupo de accionistas.
- "Mantención compuerta" — gasto específico de reparación.

### Diferencia entre Cargo y Cuota Extraordinaria

| Concepto | Cargo | Cuota Extraordinaria |
|----------|-------|----------------------|
| Nombre | Libre (definido por usuario) | Sin nombre (campo genérico) |
| Origen | Tabla `cargos` | Campo en `deudores_config` |
| Múltiples por accionista | Sí | No (un valor por temporada) |
| Se descuenta del pago | No directamente | Sí, incluida en el total del pago |
| Gestión | Página "Cargos" | Pantalla "Deudores" |

### Creación en lote

Al crear un cargo nuevo, el usuario puede seleccionar múltiples accionistas a la vez. El sistema crea un registro individual por cada accionista seleccionado, todos con el mismo nombre, monto y fecha.

### Estado del cargo

Cada cargo tiene un estado **pendiente** o **pagado** que se puede marcar manualmente. Esto permite llevar un registro de cobros ya efectuados independientemente del sistema de pagos principal.

---

## 10. Multas

Las multas se calculan automáticamente pero el usuario puede modificarlas manualmente en el formulario antes de guardar.

**Fórmula:**
```
multas = 5.000 × max(acciones, 1) × max(hectareas, 1) × temporadasAtrasadas
```

El botón "Auto-calcular" en el formulario de pago aplica esta fórmula usando los valores del accionista y las temporadas a pagar.

**Cuándo se aplican:** Solo en pagos de accionistas que tienen temporadas adeudadas (`temporadas_adeudadas > 1`). Un accionista al día no debería tener multas.

---

## 11. Número de Ingreso

El **N° Ingreso** es el número de comprobante que aparece en el recibo entregado al accionista. Es una secuencia única compartida entre **pagos** y **abonos**.

```
próximo_número = MAX(numero_ingreso en pagos, numero_ingreso en abonos) + 1
```

El sistema sugiere automáticamente el próximo número disponible al abrir un formulario de pago o abono. El usuario puede modificarlo si es necesario.

---

## 12. Temporadas

Cada temporada define el contexto económico del período:

- **Solo una temporada puede estar activa a la vez.** Al activar una, las demás quedan inactivas.
- El `valor_accion` de la temporada activa es el precio unitario usado en todos los cálculos de cobro.
- Los pagos y abonos siempre se asocian a una temporada específica.
- La lista de deudores siempre muestra la situación respecto a la **temporada activa**.

---

## 13. Resumen Contable

La pantalla "Resumen Contable" muestra los totales de **pagos + abonos** para una temporada seleccionada.

### Totales generales

Suma de todos los `monto_acciones`, `multas`, `cuota_extraordinaria`, `otros_ingresos` y `total` de los registros de pagos y abonos de la temporada.

### Desglose mensual

Los mismos totales agrupados por mes, útil para informes de caja y rendición de cuentas.

> **Importante:** El `total` de un pago con abonos previos ya descuenta lo abonado. Por eso, para calcular el total real recaudado en la temporada, la vista suma tanto los abonos como los pagos (no sería correcto sumar solo los pagos).

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
