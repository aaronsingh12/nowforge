import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { api } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import AgentChat from './pages/AgentChat.jsx';
import Incidents from './pages/Incidents.jsx';
import Catalog from './pages/Catalog.jsx';
import Flows from './pages/Flows.jsx';
import Sla from './pages/Sla.jsx';
import Access from './pages/Access.jsx';
import Settings from './pages/Settings.jsx';
import Toasts from './components/Toasts.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';

const TITLES = {
  '/': 'Dashboard',
  '/agent': 'Agent',
  '/incidents': 'Incident Management',
  '/catalog': 'Catalog Management',
  '/flows': 'Flow Designer',
  '/sla': 'SLA Definitions',
  '/access': 'Access Control',
  '/settings': 'Settings',
};

function Topbar() {
  const loc = useLocation();
  const [health, setHealth] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/system/health').then((h) => alive && setHealth(h)).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const host = health?.instanceUrl ? health.instanceUrl.replace(/^https?:\/\//, '') : 'no instance bound';
  return (
    <div className="topbar">
      <h1>{TITLES[loc.pathname] || 'NowForge'}</h1>
      <span className="instance-pill" title={health?.instanceUrl || ''}>
        <span className={`dot ${health?.connected ? 'on' : ''}`} />
        {host}
      </span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="shell">
        <aside className="sidebar">
          <div className="logo">
            Now<span className="forge">Forge</span>
            <span className="logo-sub">agentic servicenow studio</span>
          </div>
          <NavLink to="/" end className="navlink">Dashboard</NavLink>
          <NavLink to="/agent" className="navlink">Agent</NavLink>
          <NavLink to="/incidents" className="navlink">Incidents</NavLink>
          <NavLink to="/catalog" className="navlink">Catalog</NavLink>
          <NavLink to="/flows" className="navlink">Flows</NavLink>
          <NavLink to="/sla" className="navlink">SLA</NavLink>
          <NavLink to="/access" className="navlink">Access</NavLink>
          <NavLink to="/settings" className="navlink">Settings</NavLink>
          <div className="sidebar-foot">v0.1 · phase 1</div>
        </aside>
        <div className="main">
          <Topbar />
          <div className="content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/agent" element={<AgentChat />} />
              <Route path="/incidents" element={<Incidents />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/flows" element={<Flows />} />
              <Route path="/sla" element={<Sla />} />
              <Route path="/access" element={<Access />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </div>
      </div>
      {/* Mounted once, outside the routed content: a toast raised by a page
          that is navigating away must still be readable, and the dialog must
          outlive the row that opened it. */}
      <Toasts />
      <ConfirmDialog />
    </BrowserRouter>
  );
}
