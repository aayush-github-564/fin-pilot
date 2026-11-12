import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { ApiError } from "../../api/errors";
import { useAuth } from "../../app/auth-context";
import { BrandLockup } from "../../components/brand/brand-lockup";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { useCurrentUser } from "../auth/hooks";
import { createCompany, type CompanyMembership } from "./api";
import { companiesQueryKey, useCompanies } from "./hooks";
import { acceptMyInvitation } from "./members-api";
import { myInvitationsQueryKey, useMyInvitations } from "./members-hooks";

const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Enter a company name."),
  currency_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Enter a three-letter ISO currency code.")
    .transform((value) => value.toUpperCase()),
});

type CreateCompanyInput = z.input<typeof createCompanySchema>;
type CreateCompanyValues = z.output<typeof createCompanySchema>;

function companyPath(company: CompanyMembership): string {
  return `/c/${company.company_id}/dashboard`;
}

export function CompanyPickerPage() {
  const companies = useCompanies();
  const user = useCurrentUser();
  const invitations = useMyInvitations();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<CreateCompanyInput, unknown, CreateCompanyValues>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: { name: "", currency_code: "INR" },
  });
  const createMutation = useMutation({
    mutationFn: createCompany,
    onSuccess: async (company) => {
      await queryClient.invalidateQueries({ queryKey: companiesQueryKey });
      navigate(`/c/${company.id}/dashboard`, { replace: true });
    },
  });
  const acceptMutation = useMutation({
    mutationFn: acceptMyInvitation,
    onSuccess: async ({ company_id }) => {
      await queryClient.invalidateQueries({ queryKey: companiesQueryKey });
      await queryClient.invalidateQueries({ queryKey: myInvitationsQueryKey });
      navigate(`/c/${company_id}/dashboard`, { replace: true });
    },
  });

  if (companies.isPending || user.isPending) {
    return <LoadingState label="Loading your company memberships" />;
  }
  if (companies.isError || user.isError) {
    return (
      <main className="mx-auto max-w-xl px-5 py-16">
        <Card className="space-y-4 p-6">
          <ErrorMessage>
            {companies.error instanceof Error
              ? companies.error.message
              : user.error instanceof Error
                ? user.error.message
                : "Your company memberships could not load."}
          </ErrorMessage>
          <Button
            onClick={() => {
              void companies.refetch();
              void user.refetch();
            }}
            variant="secondary"
          >
            Try again
          </Button>
        </Card>
      </main>
    );
  }

  const joinedAt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(new Date(user.data.created_at));

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <BrandLockup className="text-pine" wordmarkClassName="text-base" />
            <div>
              <p className="text-xs text-muted">Choose your workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-64 truncate text-sm text-muted sm:block">
              {user.data.email}
            </span>
            <Button onClick={signOut} size="sm" variant="quiet">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-9 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:gap-10 lg:py-14">
        <section>
          <p className="fp-eyebrow">
            Company access
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="fp-page-title">
                Your <em>workspaces</em>
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                Choose a company to continue. Each workspace keeps its records and access in
                their own company context.
              </p>
            </div>
            <Badge className="gap-1.5" variant="success">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Member since {joinedAt}
            </Badge>
          </div>

          {invitations.data && invitations.data.length > 0 && <Card className="mt-6"><CardHeader><CardTitle>Invitations for you</CardTitle><CardDescription>These invitations were sent to {user.data.email}.</CardDescription></CardHeader><div className="divide-y divide-line px-5 pb-5 sm:px-6">{invitations.data.map((invitation) => <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0" key={invitation.id}><div><p className="font-semibold text-foreground-body">{invitation.company_name}</p><p className="text-sm text-muted">Access: {invitation.role === "accountant" ? "Admin" : invitation.role[0]?.toUpperCase() + invitation.role.slice(1)}</p></div><Button disabled={acceptMutation.isPending} onClick={() => acceptMutation.mutate(invitation.id)} type="button">Accept</Button></div>)}</div></Card>}
          {acceptMutation.isError && <div className="mt-4"><ErrorMessage>{acceptMutation.error instanceof Error ? acceptMutation.error.message : "The invitation could not be accepted."}</ErrorMessage></div>}

          {companies.data.length > 0 ? (
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {companies.data.map((company) => (
                <Link
                  className="group block h-full rounded-lg text-left outline-none focus-visible:ring-4 focus-visible:ring-accent/20"
                  key={company.company_id}
                  to={companyPath(company)}
                >
                  <Card className="h-full transition-colors group-hover:border-accent/40">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid size-10 place-items-center rounded-md bg-signal-deep/5 text-accent">
                          <Building2 aria-hidden="true" className="size-5" />
                        </span>
                        <Badge variant={company.role === "viewer" ? "neutral" : "info"}>
                          {company.role === "accountant" ? "Admin" : company.role === "owner" ? "Owner" : company.role === "member" ? "Member" : "Viewer"}
                        </Badge>
                      </div>
                      <CardTitle className="pt-3 text-lg">{company.name}</CardTitle>
                      <CardDescription>
                        {company.currency_code
                          ? `Accounting currency · ${company.currency_code}`
                          : "Accounting currency not set"}
                      </CardDescription>
                      <span className="inline-flex items-center gap-1 pt-3 text-sm font-semibold text-accent">
                        Open workspace
                        <ArrowRight
                          aria-hidden="true"
                          className="size-4 transition group-hover:translate-x-1"
                        />
                      </span>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="mt-7 border-dashed bg-card p-7 text-center sm:p-10">
              <span className="mx-auto grid size-12 place-items-center rounded-lg bg-signal-deep/5 text-accent">
                <Building2 aria-hidden="true" className="size-6" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-foreground">
                Your company workspace starts here
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
                Create a workspace for your business or ask an owner to invite you to an existing
                company.
              </p>
            </Card>
          )}
        </section>

        <section>
          <Card className="overflow-hidden">
            <div className="h-1.5 bg-moss" />
            <CardHeader>
              <div className="flex items-center gap-2 fp-label">
                <Plus aria-hidden="true" className="size-4" />
                New workspace
              </div>
              <CardTitle className="pt-2 text-xl">Create a company</CardTitle>
              <CardDescription>
                Choose the accounting currency carefully. FinPilot does not convert amounts.
              </CardDescription>
            </CardHeader>
            <div className="px-5 pb-6 sm:px-6">
              <form
                className="space-y-4"
                noValidate
                onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
              >
                {createMutation.isError && (
                  <ErrorMessage>
                    {createMutation.error instanceof ApiError
                      ? createMutation.error.message
                      : "The company could not be created."}
                  </ErrorMessage>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-body" htmlFor="company-name">
                    Company name
                  </label>
                  <Input
                    autoComplete="organization"
                    id="company-name"
                    placeholder="Northstar Studio"
                    {...form.register("name")}
                  />
                  {form.formState.errors.name && (
                    <p className="text-xs text-negative" role="alert">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground-body" htmlFor="company-currency-create">
                    Accounting currency
                  </label>
                  <Input
                    autoCapitalize="characters"
                    autoComplete="off"
                    id="company-currency-create"
                    maxLength={3}
                    placeholder="INR"
                    {...form.register("currency_code")}
                  />
                  <p className="text-xs leading-5 text-muted">
                    Enter the three-letter ISO 4217 code used by your books. The form starts with
                    INR; change it if your company uses another currency.
                  </p>
                  {form.formState.errors.currency_code && (
                    <p className="text-xs text-negative" role="alert">
                      {form.formState.errors.currency_code.message}
                    </p>
                  )}
                </div>

                <Button className="w-full" disabled={createMutation.isPending} size="lg" type="submit">
                  {createMutation.isPending ? (
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <ArrowRight aria-hidden="true" className="size-4" />
                  )}
                  {createMutation.isPending ? "Creating workspace" : "Create workspace"}
                </Button>
              </form>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
