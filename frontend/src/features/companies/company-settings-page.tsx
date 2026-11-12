import { Building2, CircleDollarSign, Pencil, ShieldCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { updateCompanyName } from "./api";
import { useCompany, useRole } from "./company-context";
import type { CompanyMembership } from "./api";
import { companiesQueryKey } from "./hooks";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";

export function CompanySettingsPage() {
  const company = useCompany();
  const { role, roleLabel, roleDescription, canManageMembers, hasPermission } = useRole();
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(company.name);
  const updateName = useMutation({
    mutationFn: (value: string) => updateCompanyName(company.company_id, value),
    onSuccess: async (updated) => {
      await queryClient.setQueryData(companiesQueryKey, (current: CompanyMembership[] | undefined) =>
        current?.map((item) => item.company_id === updated.id ? { ...item, name: updated.name } : item),
      );
      setEditingName(false);
    },
  });

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = name.trim();
    if (cleaned && cleaned !== company.name) updateName.mutate(cleaned);
    else setEditingName(false);
  }

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
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-signal-deep/5 text-accent">
              <Building2 aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <CardDescription>Company name</CardDescription>
              {editingName ? (
                <form className="mt-2 flex flex-wrap gap-2" onSubmit={saveName}>
                  <Input aria-label="Company name" autoFocus maxLength={120} onChange={(event) => setName(event.currentTarget.value)} value={name} />
                  <Button disabled={updateName.isPending || !name.trim()} size="sm" type="submit">Save</Button>
                  <Button onClick={() => { setName(company.name); setEditingName(false); }} size="sm" type="button" variant="secondary">Cancel</Button>
                </form>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <CardTitle className="break-words">{company.name}</CardTitle>
                  {hasPermission("company:edit") && <Button aria-label="Edit company name" onClick={() => setEditingName(true)} size="icon" variant="quiet"><Pencil aria-hidden="true" className="size-4" /></Button>}
                </div>
              )}
              {updateName.isError && <ErrorMessage>Company name could not be updated. Try again.</ErrorMessage>}
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-positive/5 text-positive">
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
                  {roleDescription}
                </CardDescription>
              </div>
            </div>
            <Badge variant={role === "viewer" ? "neutral" : "info"}>{roleLabel}</Badge>
          </div>
          {canManageMembers && <Link className="mt-4 inline-flex text-sm font-semibold text-accent underline underline-offset-4" to={`/c/${company.company_id}/members`}>Manage company members</Link>}
        </CardHeader>
      </Card>
    </div>
  );
}
