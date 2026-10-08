import { describe, expect, it } from 'vitest';
import { AssetsPage } from './assets.js';
import { CalendarPage } from './calendar.js';
import { DocumentsPage } from './documents.js';
import { EmployeePage } from './employee.js';
import { ExpensesPage } from './expenses.js';
import { IntegrationsPage } from './integrations.js';
import { PerformancePage } from './performance.js';
import { ProfilePage } from './profile.js';
import { ReportsPage } from './reports.js';
import { RequestsPage } from './requests.js';
import { SettingsPage } from './settings.js';
import { TrainingPage } from './training.js';

/** The route table in App.tsx imports exactly these named exports. */
const pages = {
  AssetsPage,
  CalendarPage,
  DocumentsPage,
  EmployeePage,
  ExpensesPage,
  IntegrationsPage,
  PerformancePage,
  ProfilePage,
  ReportsPage,
  RequestsPage,
  SettingsPage,
  TrainingPage,
};

describe('page modules', () => {
  it('exposes every routed page as a named component export', () => {
    for (const [name, page] of Object.entries(pages)) {
      expect(typeof page, `${name} must be a component`).toBe('function');
    }
    expect(Object.keys(pages)).toHaveLength(12);
  });
});
