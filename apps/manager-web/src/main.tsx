import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './App';
import { LiveMapPage } from './pages/LiveMapPage';
import { DriversListPage } from './pages/DriversListPage';
import { PaymentsListPage } from './pages/PaymentsListPage';
import { RoadblocksPage } from './pages/RoadblocksPage';
import { SystemSettingsPage } from './pages/SystemSettingsPage';
import '@waselneh/ui/tokens.css';
import './ui/styles.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/drivers" replace />} />
          <Route path="live-map" element={<LiveMapPage />} />
          <Route path="drivers" element={<DriversListPage />} />
          <Route path="payments" element={<PaymentsListPage />} />
          <Route path="roadblocks" element={<RoadblocksPage />} />
          <Route path="settings" element={<SystemSettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
