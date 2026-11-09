import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { LoadingState } from "../components/ui/feedback";
import { RedirectAuthenticated, RequireAuthentication, HomeRedirect } from "./guards";

const CompanyPickerPage = lazy(() =>
  import("../features/companies/company-picker-page").then((module) => ({ default: module.CompanyPickerPage })),
);
const CompanyLayout = lazy(() =>
  import("../features/companies/company-layout").then((module) => ({ default: module.CompanyLayout })),
);
const LoginPage = lazy(() =>
  import("../features/auth/login-page").then((module) => ({ default: module.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("../features/auth/register-page").then((module) => ({ default: module.RegisterPage })),
);
const CompanySettingsPage = lazy(() =>
  import("../features/companies/company-settings-page").then((module) => ({ default: module.CompanySettingsPage })),
);
const DashboardPage = lazy(() =>
  import("../features/dashboard/dashboard-page").then((module) => ({ default: module.DashboardPage })),
);
const TransactionsPage = lazy(() =>
  import("../features/transactions/transactions-page").then((module) => ({ default: module.TransactionsPage })),
);
const ReviewQueuePage = lazy(() =>
  import("../features/transactions/review-queue-page").then((module) => ({ default: module.ReviewQueuePage })),
);

function LoadPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState label="Opening FinPilot" />}>{children}</Suspense>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route
        path="/login"
        element={
          <LoadPage>
            <RedirectAuthenticated>
              <LoginPage />
            </RedirectAuthenticated>
          </LoadPage>
        }
      />
      <Route
        path="/register"
        element={
          <LoadPage>
            <RedirectAuthenticated>
              <RegisterPage />
            </RedirectAuthenticated>
          </LoadPage>
        }
      />
      <Route
        path="/companies"
        element={
          <LoadPage>
            <RequireAuthentication>
              <CompanyPickerPage />
            </RequireAuthentication>
          </LoadPage>
        }
      />
      <Route
        path="/c/:companyId"
        element={
          <LoadPage>
            <RequireAuthentication>
              <CompanyLayout />
            </RequireAuthentication>
          </LoadPage>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<LoadPage><DashboardPage /></LoadPage>} />
        <Route path="transactions" element={<LoadPage><TransactionsPage /></LoadPage>} />
        <Route path="review" element={<LoadPage><ReviewQueuePage /></LoadPage>} />
        <Route path="settings" element={<LoadPage><CompanySettingsPage /></LoadPage>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
