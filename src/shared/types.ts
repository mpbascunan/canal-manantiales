export type AccionistaType = 'PARCELA' | 'SITIO' | 'PEQUEÑO_PROPIETARIO'

export interface Temporada {
  id: number
  nombre: string
  fecha_inicio: string
  fecha_fin: string
  valor_accion: number
  activa: boolean
  nota_aviso: string | null
}

export interface Propiedad {
  id: number
  accionista_id: number
  numero: string | null
  tipo: AccionistaType
  acciones: number
  hectareas: number
}

export interface PropiedadInput {
  id?: number
  numero?: string | null
  tipo: AccionistaType
  acciones: number
  hectareas: number
}

export interface Accionista {
  id: number
  numero: string | null   // primary number (first propiedad or legacy)
  numeros: string | null  // all numbers joined: "84, 14, 47-A"
  nombre: string
  tipo: AccionistaType    // primary tipo (first propiedad or legacy)
  acciones: number        // total from all propiedades (or legacy)
  hectareas: number       // total from all propiedades (or legacy)
  activo: boolean
  notas: string | null
}

export interface AccionistaInput {
  id?: number
  nombre: string
  activo: boolean
  notas?: string | null
  propiedades: PropiedadInput[]
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
