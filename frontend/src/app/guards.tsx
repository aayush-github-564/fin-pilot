import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { LoadingState } from "../components/ui/feedback";
import { useAuth } from "./auth-context";
import { useCompanies } from "../features/companies/hooks";

export function RequireAuthentication({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (isAuthenticated) return children;
  const next = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}

export function RedirectAuthenticated({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

export function HomeRedirect() {
  const { isAuthenticated } = useAuth();
  const companies = useCompanies(isAuthenticated);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (companies.isPending) return <LoadingState label="Opening your workspace" />;
  if (companies.isError) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16 text-center">
        <h1 className="text-xl font-semibold text-slate-950">Your companies could not load</h1>
        <p className="mt-2 text-sm text-slate-600">Check your connection and try again.</p>
        <button
          className="mt-5 text-sm font-semibold text-cyan-800 underline underline-offset-4"
          onClick={() => void companies.refetch()}
          type="button"
        >
          Try again
        </button>
      </main>
    );
  }

  const firstCompany = companies.data[0];
  if (companies.data.length === 1 && firstCompany) {
    return <Navigate to={`/c/${firstCompany.company_id}/dashboard`} replace />;
  }
  return <Navigate to="/companies" replace />;
}
