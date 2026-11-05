import { ArrowUpRight, Building2, Check, Compass, Layers3 } from "lucide-react";
import { Link } from "react-router-dom";

import { useCompany, useRole } from "../companies/company-context";
import { Badge } from "../../components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

export function DashboardPage() {
  const company = useCompany();
  const { role } = useRole();

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl shadow-slate-300/30 sm:px-9 sm:py-10">
        <div
          aria-hidden="true"
          className="absolute -right-14 -top-28 size-80 rounded-full bg-cyan-500/25 blur-[90px]"
        />
        <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-2/5 opacity-20 sm:block">
          <div className="absolute inset-0 [background-image:linear-gradient(rgba(148,163,184,.25)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.25)_1px,transparent_1px)] [background-size:30px_30px]" />
          <svg
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            viewBox="0 0 420 200"
          >
            <path d="M0 165 C70 120 82 152 150 106 S270 112 310 65 S370 60 420 20" fill="none" stroke="#67e8f9" strokeWidth="2" />
            <path d="M0 185 C72 158 105 179 170 138 S280 142 326 116 S380 108 420 92" fill="none" stroke="#34d399" strokeOpacity=".65" strokeWidth="2" />
          </svg>
        </div>
        <div className="relative max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-white/10 text-cyan-100" variant="neutral">
              Workspace overview
            </Badge>
            <Badge className="border border-white/15 bg-white/5 text-slate-200" variant="neutral">
              {role}
            </Badge>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome to {company.name}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
            Your company workspace is connected. FinPilot keeps financial records, review work,
            and reporting together in this company context.
          </p>
          <Link
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-100"
            to={`/c/${company.company_id}/settings`}
          >
            Review workspace settings
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>

      <section aria-labelledby="workspace-status-title">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950" id="workspace-status-title">
              Workspace context
            </h2>
            <p className="mt-1 text-sm text-slate-600">These settings apply to this company only.</p>
          </div>
          <Link className="hidden text-sm font-semibold text-cyan-900 hover:text-cyan-700 sm:inline" to={`/c/${company.company_id}/settings`}>
            Company settings <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center gap-4 space-y-0">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-900">
                <Building2 aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Company</p>
                <CardTitle className="mt-1 truncate">{company.name}</CardTitle>
              </div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center gap-4 space-y-0">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-900">
                <Check aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Accounting currency</p>
                <CardTitle className="mt-1">{company.currency_code ?? "Needs owner setup"}</CardTitle>
              </div>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Card className="bg-white/70">
          <CardHeader className="flex flex-row items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-800">
              <Layers3 aria-hidden="true" className="size-5" />
            </span>
            <div>
              <CardTitle>Company-scoped records</CardTitle>
              <CardDescription className="mt-1">
                Your membership determines what you can view and change. Switching companies
                changes the active workspace.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
        <Card className="bg-white/70">
          <CardHeader className="flex flex-row items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-900">
              <Compass aria-hidden="true" className="size-5" />
            </span>
            <div>
              <CardTitle>One accounting currency</CardTitle>
              <CardDescription className="mt-1">
                Amounts stay in your company's accounting currency. FinPilot does not perform
                currency conversion.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </section>
    </div>
  );
}
