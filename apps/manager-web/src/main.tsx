import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { App } from './App';
import { I18nProvider } from './localization';
import { CommissionsPage } from './pages/CommissionsPage';
import { DriversListPage } from './pages/DriversListPage';
import { LiveMapPage } from './pages/LiveMapPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { OfficeDetailsPage } from './pages/OfficeDetailsPage';
import { OperationsPage } from './pages/OperationsPage';
import { PaymentReconciliationPage } from './pages/PaymentReconciliationPage';
import { PaymentsListPage } from './pages/PaymentsListPage';
import { RoadblocksPage } from './pages/RoadblocksPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { SystemSettingsPage } from './pages/SystemSettingsPage';
import { installWebErrorTracking } from './services/error-tracking.service';
import '@waselneh/ui/tokens.css';
import './ui/styles.css';
import './index.css';

installWebErrorTracking();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<Navigate to="/drivers" replace />} />
            <Route path="live-map" element={<LiveMapPage />} />
            <Route path="drivers" element={<DriversListPage />} />
            <Route path="payments" element={<PaymentsListPage />} />
            <Route path="commissions" element={<CommissionsPage />} />
            <Route path="reconciliation" element={<PaymentReconciliationPage />} />
            <Route path="roadblocks" element={<RoadblocksPage />} />
            <Route path="settings" element={<SystemSettingsPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="operations" element={<OperationsPage />} />
            <Route path="offices/:officeId" element={<OfficeDetailsPage />} />
            <Route path="monitoring" element={<MonitoringPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>
);
