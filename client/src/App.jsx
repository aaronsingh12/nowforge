import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useHealth } from './hooks/useHealth.js';
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
import ErrorBoundary from './components/ErrorBoundary.jsx';

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

function Topbar({ title }) {
  // One poller for the whole app (D-3). This used to be the topbar's private
  // 20s interval, while four other places answered the same question from
  // three other sources and disagreed with it.
  const { connected, instanceUrl, loading, serverDown } = useHealth();
  const host = instanceUrl
    ? instanceUrl.replace(/^https?:\/\//, '')
    : (serverDown ? 'server not responding' : 'no instance bound');
  return (
    <div className="topbar">
      <h1>{title}</h1>
      <span className="instance-pill" title={instanceUrl || ''}>
        <span className={`dot ${connected ? 'on' : ''}`} />
        {loading ? 'checking…' : host}
      </span>
    </div>
  );
}

/**
 * Everything that needs router context lives here rather than in App, which
 * renders the router itself — `useLocation` one level up throws, and that is
 * exactly the class of render error the boundary below now contains.
 */
function Shell() {
  const { pathname } = useLocation();
  const title = TITLES[pathname] || 'NowForge';
  return (
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
        <Topbar title={title} />
        <div className="content">
          {/* Keyed on the path so navigating away clears a caught error — a
              boundary that latches means one bad page bricks the session. */}
          <ErrorBoundary key={pathname} where={title}>
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
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
      {/* Mounted once, outside the routed content: a toast raised by a page
          that is navigating away must still be readable, the dialog must
          outlive the row that opened it, and neither may be unmounted by the
          error boundary catching a page. */}
      <Toasts />
      <ConfirmDialog />
    </BrowserRouter>
  );
}
