import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import type { Temporada } from '../../../shared/types'

const navItems = [
  { to: '/dashboard', icon: '◎', label: 'Inicio' },
  { to: '/pagos/nuevo', icon: '+', label: 'Nuevo Pago' },
  { to: '/accionistas', icon: '⊞', label: 'Accionistas' },
  { to: '/pagos/mes', icon: '⊟', label: 'Pagos por Mes' },
  { to: '/resumen', icon: '≡', label: 'Resumen Contable' },
  { to: '/deudores', icon: '⚠', label: 'Deudores' },
  { to: '/cargos', icon: '⊕', label: 'Cargos' },
  { to: '/temporadas', icon: '◷', label: 'Temporadas' },
  { to: '/importar', icon: '↑', label: 'Importar Excel' }
]

export default function Layout() {
  const [temporada, setTemporada] = useState<Temporada | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.temporadas.getActive().then(setTemporada)
  }, [])

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 flex flex-col shrink-0">
        <div className="px-4 pt-8 pb-4 border-b border-slate-700">
          <div className="text-white font-bold text-sm leading-tight">Canal Rinconada</div>
          <div className="text-slate-400 text-xs mt-0.5">de Manantiales</div>
        </div>

        {temporada && (
          <div className="px-4 py-2 bg-slate-800 border-b border-slate-700">
            <div className="text-xs text-slate-400">Temporada activa</div>
            <div className="text-sky-400 text-sm font-semibold">{temporada.nombre}</div>
          </div>
        )}

        <nav className="flex-1 py-2 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span className="text-base w-4 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-slate-700 text-xs text-slate-500">
          v1.0.0
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
