import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "./components/ui/misc.js";
import { AppShell } from "./components/layout/app-shell.js";
import { useAuth } from "./store/auth.js";

/**
 * Route modules are code-split: a user signing in for leave management never
 * downloads the reporting or settings screens. Each page module exports its
 * component by name, so `lazyNamed` resolves the export at load time.
 */
function lazyNamed<T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
): React.LazyExoticComponent<React.ComponentType> {
  return lazy(async () => ({
    default: (await loader())[name] as React.ComponentType,
  }));
}

const AcceptInvitationPage = lazyNamed(
  () => import("./pages/accept-invitation.js"),
  "AcceptInvitationPage",
);
const AssetsPage = lazyNamed(() => import("./pages/assets.js"), "AssetsPage");
const AttendancePage = lazyNamed(
  () => import("./pages/attendance.js"),
  "AttendancePage",
);
const CalendarPage = lazyNamed(
  () => import("./pages/calendar.js"),
  "CalendarPage",
);
const DashboardPage = lazyNamed(
  () => import("./pages/dashboard.js"),
  "DashboardPage",
);
const DocumentsPage = lazyNamed(
  () => import("./pages/documents.js"),
  "DocumentsPage",
);
const EmployeePage = lazyNamed(
  () => import("./pages/employee.js"),
  "EmployeePage",
);
const ExpensesPage = lazyNamed(
  () => import("./pages/expenses.js"),
  "ExpensesPage",
);
const ForgotPasswordPage = lazyNamed(
  () => import("./pages/forgot-password.js"),
  "ForgotPasswordPage",
);
const IntegrationsPage = lazyNamed(
  () => import("./pages/integrations.js"),
  "IntegrationsPage",
);
const LeavePage = lazyNamed(() => import("./pages/leave.js"), "LeavePage");
const LoginPage = lazyNamed(() => import("./pages/login.js"), "LoginPage");
const MfaPage = lazyNamed(() => import("./pages/mfa.js"), "MfaPage");
const NotFoundPage = lazyNamed(
  () => import("./pages/not-found.js"),
  "NotFoundPage",
);
const OAuthCallbackPage = lazyNamed(
  () => import("./pages/oauth-callback.js"),
  "OAuthCallbackPage",
);
const PeoplePage = lazyNamed(() => import("./pages/people.js"), "PeoplePage");
const PerformancePage = lazyNamed(
  () => import("./pages/performance.js"),
  "PerformancePage",
);
const ProfilePage = lazyNamed(
  () => import("./pages/profile.js"),
  "ProfilePage",
);
const ReportsPage = lazyNamed(
  () => import("./pages/reports.js"),
  "ReportsPage",
);
const RequestsPage = lazyNamed(
  () => import("./pages/requests.js"),
  "RequestsPage",
);
const ResetPasswordPage = lazyNamed(
  () => import("./pages/reset-password.js"),
  "ResetPasswordPage",
);
const SettingsPage = lazyNamed(
  () => import("./pages/settings.js"),
  "SettingsPage",
);
const TrainingPage = lazyNamed(
  () => import("./pages/training.js"),
  "TrainingPage",
);
const VerifyEmailPage = lazyNamed(
  () => import("./pages/verify-email.js"),
  "VerifyEmailPage",
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

/** Shown while a route's code-split chunk is being fetched. */
function RouteFallback() {
  return (
    <div
      className="flex h-full min-h-64 items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const status = useAuth((state) => state.status);
  const location = useLocation();

  if (status === "loading") {
    return <RouteFallback />;
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const status = useAuth((state) => state.status);
  if (status === "authenticated") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SessionBootstrap() {
  const loadSession = useAuth((state) => state.loadSession);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <SessionBootstrap />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <LoginPage />
                  </PublicRoute>
                }
              />
              <Route path="/mfa" element={<MfaPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route
                path="/accept-invitation"
                element={<AcceptInvitationPage />}
              />
              <Route path="/auth/callback" element={<OAuthCallbackPage />} />

              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="people" element={<PeoplePage />} />
                <Route path="people/:id" element={<EmployeePage />} />
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="leave" element={<LeavePage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="requests" element={<RequestsPage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="performance" element={<PerformancePage />} />
                <Route path="training" element={<TrainingPage />} />
                <Route path="expenses" element={<ExpensesPage />} />
                <Route path="assets" element={<AssetsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="settings/*" element={<SettingsPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
          <Toaster position="top-right" richColors closeButton />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
