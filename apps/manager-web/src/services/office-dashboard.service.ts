import { httpsCallable } from 'firebase/functions';

import { getFunctionsInstance } from './firebase';

export type DashboardDoc = { id: string; [key: string]: unknown };

export interface OfficeDashboard {
  office: DashboardDoc;
  drivers: DashboardDoc[];
  vehicles: DashboardDoc[];
  lines: DashboardDoc[];
  trips: DashboardDoc[];
  commissions: DashboardDoc[];
  invoices: DashboardDoc[];
  statements: DashboardDoc[];
  subscription: DashboardDoc | null;
  generatedAt: string;
}

export async function getOfficeDashboard(officeId: string): Promise<OfficeDashboard> {
  const callable = httpsCallable<{ officeId: string }, OfficeDashboard>(
    getFunctionsInstance(),
    'getManagerOfficeDashboard'
  );
  const result = await callable({ officeId });
  return result.data;
}
