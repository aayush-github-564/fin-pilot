import { Building2, CircleDollarSign, ShieldCheck } from "lucide-react";

import { useCompany, useRole } from "./company-context";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";

export function CompanySettingsPage() {
  const company = useCompany();
  const { role } = useRole();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="fp-eyebrow">Workspace</p>
        <h1 className="fp-page-title mt-2">
          Company <em>settings</em>
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Review the company identity, accounting currency, and your access level.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-signal-deep/10 text-accent">
              <Building2 aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <CardDescription>Company name</CardDescription>
              <CardTitle className="mt-1 break-words">{company.name}</CardTitle>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-positive/10 text-positive">
              <CircleDollarSign aria-hidden="true" className="size-5" />
            </span>
            <div>
              <CardDescription>Accounting currency</CardDescription>
              <CardTitle className="mt-1">
                {company.currency_code ?? "Not set"}
              </CardTitle>
            </div>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-raised text-accent">
                <ShieldCheck aria-hidden="true" className="size-5" />
              </span>
              <div>
                <CardTitle>Your company access</CardTitle>
                <CardDescription className="mt-1">
                  Your current role is read from your company membership.
                </CardDescription>
              </div>
            </div>
            <Badge variant={role === "viewer" ? "neutral" : "info"}>{role}</Badge>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
