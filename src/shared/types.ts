export type AccionistaType = 'PARCELA' | 'SITIO' | 'PEQUEÑO_PROPIETARIO'

export interface Temporada {
  id: number
  nombre: string
  fecha_inicio: string
  fecha_fin: string
  valor_accion: number
  activa: boolean
  nota_aviso: string | null
  fecha_multa: string | null
  monto_multa_por_accion: number
}

export interface Propiedad {
  id: number
  accionista_id: number
  numero: string | null
  tipo: AccionistaType
  acciones: number
  hectareas: number
  direccion: string | null
  sector: string | null
  comuna: string | null
  marco: string | null
}

export interface PropiedadInput {
  id?: number
  numero?: string | null
  tipo: AccionistaType
  acciones: number
  hectareas: number
  direccion?: string | null
  sector?: string | null
  comuna?: string | null
  marco?: string | null
}

export interface Accionista {
  id: number
  numero: string | null   // primary number (first propiedad or legacy)
  numeros: string | null  // all numbers joined: "84, 14, 47-A"
  nombre: string
  apellido_paterno: string | null
  apellido_materno: string | null
  numero_socio: string | null
  tipo: AccionistaType    // primary tipo (first propiedad or legacy)
  acciones: number        // total from all propiedades (or legacy)
  hectareas: number       // total from all propiedades (or legacy)
  activo: boolean
  notas: string | null
}

export interface AccionistaInput {
  id?: number
  nombre: string
  apellido_paterno?: string | null
  apellido_materno?: string | null
  numero_socio?: string | null
  activo: boolean
  notas?: string | null
  propiedades: PropiedadInput[]
}

export function nombreCompleto(a: Pick<Accionista, 'nombre' | 'apellido_paterno' | 'apellido_materno'>): string {
  return [a.nombre, a.apellido_paterno, a.apellido_materno].filter(Boolean).join(' ')
}

export interface Pago {
  id: number
  numero_ingreso: number
  accionista_id: number
  temporada_id: number
  fecha: string
  temporadas_pagadas: number
  monto_acciones: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total: number
  notas: string | null
  created_at: string
  // joined
  accionista_nombre?: string
  accionista_tipo?: AccionistaType
  temporada_nombre?: string
}

export interface PagoInput {
  numero_ingreso: number
  accionista_id: number
  temporada_id: number
  fecha: string
  temporadas_pagadas: number
  monto_acciones: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total: number
  notas?: string
}

export interface Abono {
  id: number
  numero_ingreso: number
  accionista_id: number
  temporada_id: number
  fecha: string
  temporadas_cubiertas: number
  monto: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total: number
  notas: string | null
  created_at: string
  // joined
  accionista_nombre?: string
  temporada_nombre?: string
}

export interface AbonoInput {
  numero_ingreso: number
  accionista_id: number
  temporada_id: number
  fecha: string
  monto: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total: number
  notas?: string
}

export interface DeudorConfig {
  accionista_id: number
  temporada_id: number
  temporadas_adeudadas: number
  cuota_extraordinaria: number
  otros_ingresos: number
}

export interface Deudor extends Accionista {
  temporadas_adeudadas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total_abonado: number   // SUM of abonos for this accionista+temporada
  total_cargos: number    // SUM of cargo_accionistas.monto for this accionista+temporada
  monto_adeudado: number
  multas: number
  total: number
}

export interface ResumenContable {
  monto_acciones: number
  multas: number
  cuota_extraordinaria: number
  otros_ingresos: number
  total: number
}

export interface ResumenMensual extends ResumenContable {
  mes: string
  anio: number
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export interface AccionistaConPago extends Accionista {
  pagó_temporada_activa: boolean
}

export interface Cargo {
  id: number
  nombre: string
  temporada_id: number
  tarifa: number
  tipo_tarifa: 'proporcional' | 'fija'
  fecha: string
  notas: string | null
  created_at: string
  temporada_nombre?: string
  accionista_count?: number
  total_monto?: number
  pagados_count?: number
}

export interface CargoAccionista {
  id: number
  nombre: string
  acciones: number
  hectareas: number
  monto: number
  pagado: boolean
}

export interface CargoConAccionistas extends Cargo {
  accionistas: CargoAccionista[]
}

export interface CargoResumen {
  id: number
  nombre: string
  total_emitido: number
  total_cobrado: number
}

export interface CargoCreateInput {
  nombre: string
  temporada_id: number
  tarifa: number
  tipo_tarifa: 'proporcional' | 'fija'
  fecha: string
  notas?: string | null
  accionista_ids: number[]
}
