import { ArrowLeftRight, Building2, ClipboardCheck, LayoutDashboard, LogOut, Settings2 } from "lucide-react";
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Select } from "../../components/ui/select";
import { useAuth } from "../../app/auth-context";
import { useCurrentUser } from "../auth/hooks";
import { CompanyProvider, useRole } from "./company-context";
import { CurrencyBanner } from "./currency-banner";
import type { CompanyMembership } from "./api";
import { useCompanies } from "./hooks";

function CompanyWorkspace({
  company,
  email,
}: {
  company: CompanyMembership;
  email: string;
}) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { role } = useRole();
  const navigationClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition ${
      isActive
        ? "bg-slate-950 text-white shadow-sm"
        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
    }`;

  return (
    <div className="min-h-screen bg-[#f5f7f8]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Link className="flex items-center gap-3 px-2" to={`/c/${company.company_id}/dashboard`}>
          <span className="grid size-10 place-items-center rounded-xl bg-slate-950 text-cyan-300">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <span>
            <span className="block text-base font-bold tracking-tight text-slate-950">FinPilot</span>
            <span className="block text-[11px] text-slate-500">Finance operations</span>
          </span>
        </Link>

        <div className="mt-9 px-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Workspace
          </p>
          <p className="mt-2 truncate text-sm font-semibold text-slate-800" title={company.name}>
            {company.name}
          </p>
        </div>

        <nav aria-label="Company navigation" className="mt-5 space-y-1">
          <NavLink className={navigationClass} to={`/c/${company.company_id}/dashboard`}>
            <LayoutDashboard aria-hidden="true" className="size-4" />
            Overview
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/transactions`}>
            <ArrowLeftRight aria-hidden="true" className="size-4" />
            Transactions
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/review`}>
            <ClipboardCheck aria-hidden="true" className="size-4" />
            Review queue
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/settings`}>
            <Settings2 aria-hidden="true" className="size-4" />
            Company settings
          </NavLink>
        </nav>

        <div className="mt-auto rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-800">Your access</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge variant={role === "viewer" ? "neutral" : "info"}>{role}</Badge>
            <span className="text-[11px] text-slate-500">Company scoped</span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur sm:px-7 lg:px-9">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-xl">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-cyan-300 lg:hidden">
                <Building2 aria-hidden="true" className="size-4" />
              </span>
              <label className="sr-only" htmlFor="company-switcher">
                Switch company
              </label>
              <Select
                className="min-w-0 max-w-full border-transparent bg-slate-50 font-semibold shadow-none sm:max-w-sm"
                id="company-switcher"
                onChange={(event) =>
                  navigate(`/c/${event.currentTarget.value}/dashboard`)
                }
                value={company.company_id}
              >
                <option value={company.company_id}>{company.name}</option>
                <CompanyOptions activeCompanyId={company.company_id} />
              </Select>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Badge className="lg:hidden" variant={role === "viewer" ? "neutral" : "info"}>
                {role}
              </Badge>
              <span className="hidden max-w-48 truncate text-sm text-slate-600 sm:block">{email}</span>
              <Button
                aria-label="Sign out"
                onClick={signOut}
                size="icon"
                title="Sign out"
                variant="quiet"
              >
                <LogOut aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8 lg:px-9">
          <CurrencyBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function CompanyOptions({ activeCompanyId }: { activeCompanyId: string }) {
  const companies = useCompanies();
  if (!companies.data) return null;
  return (
    <>
      {companies.data
        .filter((company) => company.company_id !== activeCompanyId)
        .map((company) => (
          <option key={company.company_id} value={company.company_id}>
            {company.name}
          </option>
        ))}
    </>
  );
}

export function CompanyLayout() {
  const { companyId } = useParams();
  const { isAuthenticated } = useAuth();
  const companies = useCompanies(isAuthenticated);
  const user = useCurrentUser(isAuthenticated);

  if (companies.isPending || user.isPending) {
    return <LoadingState label="Opening your company workspace" />;
  }
  if (companies.isError || user.isError) {
    const retry = () => {
      void companies.refetch();
      void user.refetch();
    };
    return (
      <main className="mx-auto max-w-xl px-5 py-16">
        <Card className="space-y-4 p-6">
          <ErrorMessage>
            {companies.error instanceof Error
              ? companies.error.message
              : user.error instanceof Error
                ? user.error.message
                : "Your company workspace could not load."}
          </ErrorMessage>
          <Button onClick={retry} variant="secondary">Try again</Button>
        </Card>
      </main>
    );
  }

  const company = companies.data.find((item) => item.company_id === companyId);
  if (!company) return <Navigate to="/companies" replace />;

  return (
    <CompanyProvider company={company}>
      <CompanyWorkspace company={company} email={user.data.email} />
    </CompanyProvider>
  );
}
