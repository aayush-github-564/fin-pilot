import { Navigate, Route, Routes } from "react-router-dom";

import { RedirectAuthenticated, RequireAuthentication, HomeRedirect } from "./guards";
import { CompanyPickerPage } from "../features/companies/company-picker-page";
import { CompanyLayout } from "../features/companies/company-layout";
import { LoginPage } from "../features/auth/login-page";
import { RegisterPage } from "../features/auth/register-page";
import { CompanySettingsPage } from "../features/companies/company-settings-page";
import { DashboardPage } from "../features/dashboard/dashboard-page";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route
        path="/login"
        element={
          <RedirectAuthenticated>
            <LoginPage />
          </RedirectAuthenticated>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectAuthenticated>
            <RegisterPage />
          </RedirectAuthenticated>
        }
      />
      <Route
        path="/companies"
        element={
          <RequireAuthentication>
            <CompanyPickerPage />
          </RequireAuthentication>
        }
      />
      <Route
        path="/c/:companyId"
        element={
          <RequireAuthentication>
            <CompanyLayout />
          </RequireAuthentication>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="settings" element={<CompanySettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
