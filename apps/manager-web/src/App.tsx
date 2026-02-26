import { Outlet, Link } from 'react-router-dom';
import { Button, Card, Text } from './ui';
import './App.css';

export function App() {
  return (
    <div className="app">
      <header className="header">
        <Text as="h1" variant="h2">
          Waselneh Manager
        </Text>
        <nav>
          <Link className="nav-link" to="/drivers">
            Drivers
          </Link>
          <Link className="nav-link" to="/live-map">
            Live Map
          </Link>
          <Link className="nav-link" to="/payments">
            Payments
          </Link>
          <Link className="nav-link" to="/roadblocks">
            Roadblocks
          </Link>
          <Link className="nav-link" to="/settings">
            Settings
          </Link>
          <Button type="button" variant="primary" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        </nav>
      </header>
      <main className="main">
        <Card elevated>
          <Outlet />
        </Card>
      </main>
    </div>
  );
}
