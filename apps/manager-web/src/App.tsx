import { Outlet, Link } from 'react-router-dom';
import './App.css';

export function App() {
  return (
    <div className="app">
      <header className="header">
        <h1>🚕 Waselneh Manager</h1>
        <nav>
          <Link to="/live-map">Live Map</Link>
        </nav>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
