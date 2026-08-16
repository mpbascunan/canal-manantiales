import * as XLSX from 'xlsx'

/**
 * Blank workbooks in the exact shape each importer reads.
 *
 * Every parser finds its columns by header text, so these headers are the
 * contract — changing one here without changing `importParser.ts` produces a
 * template that silently imports nothing. Each sheet carries a couple of example
 * rows, because the rules that are easy to get wrong (one row per property, the
 * Unidad column, repeating a N° Socio) are far clearer shown than described.
 */

type Row = (string | number | null)[]

function sheet(rows: Row[], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map(wch => ({ wch }))
  return ws
}

/**
 * The listado de accionistas: one row per property, split across the three
 * sheets the parser recognises. Any other sheet — such as Instrucciones — is
 * ignored on import, which is what makes it safe to ship one in the template.
 */
export function buildPlantillaAccionistas(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  const header: Row = ['N°', 'Propietario / Razón Social', 'Acciones', 'Unidad',
                       'N° Socio', 'Nombre propiedad']
  const widths = [10, 38, 12, 12, 10, 30]

  XLSX.utils.book_append_sheet(wb, sheet([
    ['INSTRUCCIONES PARA LLENAR ESTA PLANILLA'],
    [],
    ['1.', 'Cada fila es UNA propiedad, no un accionista.'],
    ['', 'Si un accionista tiene cuatro parcelas, ocupa cuatro filas.'],
    [],
    ['2.', 'El N° Socio es lo que identifica al accionista.'],
    ['', 'Todas las filas de una misma persona deben repetir su mismo N° Socio.'],
    ['', 'Una fila sin N° Socio no se importa: el sistema no sabe de quién es.'],
    [],
    ['3.', 'La columna Unidad dice qué significa el número de la columna Acciones:'],
    ['', 'escriba "Acciones" o "Hectáreas". Si dice Hectáreas, el valor se registra'],
    ['', 'como hectáreas y no como acciones de agua.'],
    [],
    ['4.', 'Nombre propiedad es como aparece en el listado, por ejemplo'],
    ['', '"Parcela N°8 Lote A-2". Es lo que se imprime en el aviso de cobranza.'],
    [],
    ['5.', 'El tipo de propiedad lo define la hoja: PARCELAS, SITIOS o'],
    ['', 'PEQUEÑOS PROPIETARIOS. No cambie los nombres de las hojas.'],
    [],
    ['6.', 'Al importar, a cada accionista que aparezca en el archivo se le'],
    ['', 'reemplazan TODAS sus propiedades por las de esta planilla.'],
    [],
    ['', 'Puede agregar columnas propias (notas, observaciones): se ignoran.']
  ], [6, 70]), 'Instrucciones')

  XLSX.utils.book_append_sheet(wb, sheet([
    header,
    ['1.-', 'JUAN PÉREZ SOTO', 8.954, 'Acciones', 1, 'Parcela N°1'],
    // Same N° Socio twice: one accionista with two parcelas.
    ['2.-', 'SOCIEDAD AGRÍCOLA EJEMPLO LTDA.', 7.896, 'Acciones', 2, 'Parcela N°2'],
    ['3.-', 'SOCIEDAD AGRÍCOLA EJEMPLO LTDA.', 5.147, 'Acciones', 2, 'Parcela N°3'],
    ['3-A', 'ANA DÍAZ ROJAS', 0.36848, 'Acciones', 3, 'Parcela N°3 Lote A-4']
  ], widths), 'PARCELAS')

  XLSX.utils.book_append_sheet(wb, sheet([
    header,
    ['1.-', 'PEDRO MUÑOZ LARA', 0.493, 'Acciones', 102, 'Sitio N°1'],
    // A sitio measured in hectáreas — the Unidad column is what decides.
    ['2.-', 'CARMEN SOTO GONZÁLEZ', 0.2143, 'Hectáreas', 307, 'Sitio N°2 Lote B']
  ], widths), 'SITIOS')

  XLSX.utils.book_append_sheet(wb, sheet([
    header,
    ['1', 'CARLOS GALAZ ORELLANA', 0.212, 'Hectáreas', 205, 'Sitio Casa'],
    ['2', 'LUZMIRA ROJAS DÍAZ', 1, 'Hectáreas', 214, 'Pequeño Propietario']
  ], widths), 'PEQUEÑOS PROPIETARIOS')

  return wb
}

export function descargarPlantillaAccionistas(): void {
  XLSX.writeFile(buildPlantillaAccionistas(), 'Plantilla_Accionistas.xlsx')
}

/** The ingresos sheet: one row per payment received. */
export function buildPlantillaPagos(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, sheet([
    ['INGRESOS TEMPORADA'],
    [],
    ['Fecha', 'N° Ingreso', 'N° Socio', 'Accionista', 'Temporadas', 'Monto Acciones', 'Multas', 'Total'],
    ['01/05/2025', 500, 1, 'JUAN PÉREZ SOTO', 1, 89540, 0, 89540],
    ['03/05/2025', 501, 3, 'ANA DÍAZ ROJAS', 2, 73680, 5000, 78680],
    [],
    ['La temporada se elige en la pantalla al importar, no se escribe aquí.'],
    ['El N° Ingreso no puede repetirse: es lo que evita importar dos veces el mismo pago.'],
    ['El N° Socio es la forma segura de identificar al accionista. Si la columna está,'],
    ['se usa ella; si no, se busca por nombre y hay que emparejar a mano lo que no calce.']
  ], [14, 12, 10, 34, 12, 16, 12, 14]), 'Ingresos')

  return wb
}

export function descargarPlantillaPagos(): void {
  XLSX.writeFile(buildPlantillaPagos(), 'Plantilla_Pagos.xlsx')
}

/**
 * Opening balances. The parser also accepts a single Monto column typed by a
 * Tipo column; the template uses the two-column layout because one row per
 * accionista is easier to fill in from the administration's own records.
 */
export function buildPlantillaDeudaInicial(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, sheet([
    ['N° Socio', 'Accionista', 'Concepto', 'Cuota', 'Otro', 'Multa'],
    ['1', 'JUAN PÉREZ SOTO', 'Deuda temporada 2023-2024', 480000, 0, 240000],
    ['3', 'ANA DÍAZ ROJAS', 'Multa temporada 2024-2025', 0, 0, 120000],
    ['5', 'PEDRO MUÑOZ LARA', 'Aporte obras 2024', 0, 95000, 0],
    [],
    ['Deje en 0 o en blanco lo que no corresponda: solo se importan los montos mayores a 0.'],
    ['«Otro» es cualquier cobro que no sea la cuota de la temporada ni una multa'],
    ['(un aporte a obras, un convenio). Se cobra después de la cuota y antes de la multa.'],
    ['El N° Socio es la forma segura de identificar al accionista; el nombre es el respaldo.'],
    ['Al importar se reemplaza la deuda anterior de cada accionista que aparezca en la planilla.'],
    ['Estos montos se registran tal cual, el sistema no los recalcula.']
  ], [10, 34, 34, 14, 14, 14]), 'Deuda anterior')

  return wb
}

export function descargarPlantillaDeudaInicial(): void {
  XLSX.writeFile(buildPlantillaDeudaInicial(), 'Plantilla_Deuda_Anterior.xlsx')
}
