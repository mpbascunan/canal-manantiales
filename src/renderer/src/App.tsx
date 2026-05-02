import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Accionistas from './pages/Accionistas'
import AccionistaDetalle from './pages/AccionistaDetalle'
import NuevoPago from './pages/NuevoPago'
import PagosPorMes from './pages/PagosPorMes'
import ResumenContable from './pages/ResumenContable'
import Deudores from './pages/Deudores'
import Temporadas from './pages/Temporadas'
import ImportarExcel from './pages/ImportarExcel'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="accionistas" element={<Accionistas />} />
          <Route path="accionistas/:id" element={<AccionistaDetalle />} />
          <Route path="pagos/nuevo" element={<NuevoPago />} />
          <Route path="pagos/mes" element={<PagosPorMes />} />
          <Route path="resumen" element={<ResumenContable />} />
          <Route path="deudores" element={<Deudores />} />
          <Route path="temporadas" element={<Temporadas />} />
          <Route path="importar" element={<ImportarExcel />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
