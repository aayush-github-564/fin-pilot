import { Activity, ArrowLeftRight, CalendarDays, ClipboardCheck, LayoutDashboard, LogOut, MessageCircle, ReceiptText, Settings2, Tags, WalletCards } from "lucide-react";
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";

import { Badge } from "../../components/ui/badge";
import { BrandLockup } from "../../components/brand/brand-lockup";
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
    `flex h-11 items-center gap-3 rounded-sm px-3.5 text-sm font-semibold transition ${
      isActive
        ? "bg-dark-surface text-dark-text"
        : "text-dark-text-muted hover:bg-dark-surface hover:text-dark-text"
    }`;

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-58 flex-col border-r border-dark-border bg-dark-bg px-4 py-5 text-dark-text lg:flex">
        <Link className="flex items-center px-2 text-dark-text" to={`/c/${company.company_id}/dashboard`}>
          <BrandLockup wordmarkClassName="text-lg" />
        </Link>

        <div className="mt-9 px-2">
          <p className="fp-label fp-label--dark-muted">
            Workspace
          </p>
          <p className="mt-2 truncate text-sm font-semibold text-dark-text" title={company.name}>
            {company.name}
          </p>
        </div>

        <nav aria-label="Company navigation" className="mt-5 space-y-1">
          <NavLink className={navigationClass} to={`/c/${company.company_id}/dashboard`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><LayoutDashboard aria-hidden="true" className="size-4" />Overview</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/transactions`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><ArrowLeftRight aria-hidden="true" className="size-4" />Transactions</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/budgets`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><WalletCards aria-hidden="true" className="size-4" />Budgets</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/categories`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><Tags aria-hidden="true" className="size-4" />Categories</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/review`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><ClipboardCheck aria-hidden="true" className="size-4" />Review queue</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/chat`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><MessageCircle aria-hidden="true" className="size-4" />Ask FinPilot</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/anomalies`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><Activity aria-hidden="true" className="size-4" />Spending anomalies</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/digests`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><CalendarDays aria-hidden="true" className="size-4" />Weekly digests</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/invoices`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><ReceiptText aria-hidden="true" className="size-4" />Invoices</>}
          </NavLink>
          <NavLink className={navigationClass} to={`/c/${company.company_id}/settings`}>
            {({ isActive }) => <><span aria-hidden="true" className={`size-[7px] shrink-0 rounded-pill ${isActive ? "bg-dark-accent" : "bg-transparent"}`} /><Settings2 aria-hidden="true" className="size-4" />Company settings</>}
          </NavLink>
        </nav>

        <div className="mt-auto rounded-lg bg-dark-surface p-4">
          <p className="text-xs font-semibold text-dark-text">Your access</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge className="border border-dark-border bg-dark-bg text-dark-accent" variant={role === "viewer" ? "neutral" : "info"}>{role}</Badge>
            <span className="text-xs text-dark-text-muted">Company scoped</span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-58">
        <header className="sticky top-0 z-10 border-b border-line bg-card px-4 py-3 sm:px-7 lg:px-9">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-xl">
              <BrandLockup className="text-pine lg:hidden" wordmarkClassName="text-sm" />
              <label className="sr-only" htmlFor="company-switcher">
                Switch company
              </label>
              <Select
                className="min-w-0 max-w-full border-transparent bg-surface-raised font-semibold sm:max-w-sm"
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
              <span className="hidden max-w-48 truncate text-sm text-muted sm:block">{email}</span>
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
