import { NavLink, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview';
import Seeds from './pages/Seeds';
import Beds from './pages/Beds';
import Settings from './pages/Settings';

export default function App() {
  return (
    <div className="app-shell">
      <header>
        <h1 className="brand">Odlat</h1>
        <p className="tagline">Kartlägg bäddar, fröer och skörd — på svenska.</p>
      </header>
      <nav className="nav">
        <NavLink to="/" end>Översikt</NavLink>
        <NavLink to="/froer">Fröer</NavLink>
        <NavLink to="/baddar">Bäddar</NavLink>
        <NavLink to="/installningar">Inställningar</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/froer" element={<Seeds />} />
        <Route path="/baddar" element={<Beds />} />
        <Route path="/installningar" element={<Settings />} />
      </Routes>
    </div>
  );
}
