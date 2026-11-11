import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { formatMoney } from "../../lib/money";
import { useCompany, useRole } from "../companies/company-context";
import type { Category } from "../categories/api";
import { useManagedCategories } from "../categories/hooks";
import type { Budget, BudgetCreate } from "./api";
import { useBudgets, useCreateBudget, useDeleteBudget, useUpdateBudget } from "./hooks";

const amountPattern = /^\d{1,10}(?:\.\d{1,2})?$/;
const budgetFormSchema = z.object({
  category_id: z.string().min(1, "Choose an expense category."),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a valid month."),
  limit_amount: z.string().trim().regex(amountPattern, "Enter an amount with up to two decimal places.")
    .refine((value) => Number(value) > 0, "The budget amount must be greater than zero."),
});

type BudgetFormValues = z.infer<typeof budgetFormSchema>;

function currentMonth() {
  return format(new Date(), "yyyy-MM");
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function BudgetFields({
  initial,
  categories,
  busy,
  error,
  formError,
  submitLabel,
  onCancel,
  onSave,
}: {
  initial?: Budget;
  categories: Category[];
  busy: boolean;
  error: unknown;
  formError?: string;
  submitLabel: string;
  onCancel?: () => void;
  onSave: (values: BudgetFormValues) => void;
}) {
  const form = useForm<BudgetFormValues>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: initial
      ? { category_id: initial.category_id, period: initial.period, limit_amount: initial.limit_amount }
      : { category_id: "", period: currentMonth(), limit_amount: "" },
  });
  const expenseCategories = categories.filter((category) => category.kind === "expense");

  return <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" noValidate onSubmit={form.handleSubmit(onSave)}>
    <label className="space-y-1.5 text-sm font-medium text-slate-700">Expense category
      <Select {...form.register("category_id")}>
        <option value="">Choose an expense category</option>
        {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.company_id === null ? " · default" : ""}</option>)}
        {initial && !expenseCategories.some((category) => category.id === initial.category_id) && <option value={initial.category_id}>Current category (no longer available)</option>}
      </Select>
      {form.formState.errors.category_id && <span className="block text-xs text-rose-700">{form.formState.errors.category_id.message}</span>}
    </label>
    <label className="space-y-1.5 text-sm font-medium text-slate-700">Month
      <Input type="month" {...form.register("period")} />
      {form.formState.errors.period && <span className="block text-xs text-rose-700">{form.formState.errors.period.message}</span>}
    </label>
    <label className="space-y-1.5 text-sm font-medium text-slate-700">Budget limit
      <Input inputMode="decimal" placeholder="0.00" {...form.register("limit_amount")} />
      {form.formState.errors.limit_amount && <span className="block text-xs text-rose-700">{form.formState.errors.limit_amount.message}</span>}
    </label>
    <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1">
      {onCancel && <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">Cancel</Button>}
      <Button disabled={busy || expenseCategories.length === 0} type="submit">{busy ? "Saving…" : submitLabel}</Button>
    </div>
    {(error || formError) && <div className="sm:col-span-2 lg:col-span-4"><ErrorMessage>{formError ?? errorText(error, "The budget could not be saved.")}</ErrorMessage></div>}
    {expenseCategories.length === 0 && <p className="text-sm text-amber-900 sm:col-span-2 lg:col-span-4">Add an expense category before creating a budget.</p>}
  </form>;
}

function BudgetCard({ budget, categories, categoryName, currency, companyId, canWrite }: {
  budget: Budget;
  categories: Category[];
  categoryName: string;
  currency: string | null;
  companyId: string;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateBudget(companyId);
  const remove = useDeleteBudget(companyId);
  const periodLabel = format(parseISO(`${budget.period}-01`), "MMMM yyyy");
  const save = (values: BudgetFormValues) => update.mutate({ budgetId: budget.id, body: values }, { onSuccess: () => setEditing(false) });

  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    {editing ? <>
      <div className="mb-4"><h3 className="font-semibold text-slate-900">Edit budget · {periodLabel}</h3><p className="mt-1 text-xs text-slate-500">Category budgets are monthly limits.</p></div>
      <BudgetFields categories={categories} error={update.error} initial={budget} busy={update.isPending} onCancel={() => { setEditing(false); update.reset(); }} onSave={save} submitLabel="Save budget" />
    </> : <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold text-slate-900">{categoryName}</h3><Badge variant="neutral">{periodLabel}</Badge></div>
        <p className="mt-1 text-xs text-slate-500">Expense budget</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-lg font-semibold tabular-nums text-slate-950">{formatMoney(budget.limit_amount, currency)}</p>
        {canWrite && <Button aria-label={`Edit ${categoryName} budget for ${periodLabel}`} onClick={() => { setEditing(true); update.reset(); remove.reset(); }} size="icon" title="Edit budget" variant="quiet"><Pencil aria-hidden="true" className="size-4" /></Button>}
        {canWrite && !confirmDelete && <Button aria-label={`Delete ${categoryName} budget for ${periodLabel}`} onClick={() => { setConfirmDelete(true); remove.reset(); }} size="icon" title="Delete budget" variant="quiet"><Trash2 aria-hidden="true" className="size-4 text-rose-700" /></Button>}
        {canWrite && confirmDelete && <div className="flex items-center gap-2"><span className="text-xs text-rose-800">Delete this budget?</span><Button disabled={remove.isPending} onClick={() => remove.mutate(budget.id, { onSuccess: () => setConfirmDelete(false) })} size="sm" variant="danger">{remove.isPending ? "Deleting…" : "Confirm"}</Button><Button disabled={remove.isPending} onClick={() => setConfirmDelete(false)} size="sm" variant="secondary">Cancel</Button></div>}
      </div>
      {update.error && <div className="w-full"><ErrorMessage>{errorText(update.error, "The budget could not be updated.")}</ErrorMessage></div>}
      {remove.error && <div className="w-full"><ErrorMessage>{errorText(remove.error, "The budget could not be deleted.")}</ErrorMessage></div>}
    </div>}
  </article>;
}

function CompanyBudgets({ companyId, currency, canWrite }: { companyId: string; currency: string | null; canWrite: boolean }) {
  const [period, setPeriod] = useState(currentMonth);
  const budgets = useBudgets(companyId);
  const categories = useManagedCategories(companyId);
  const create = useCreateBudget(companyId);
  const [duplicateError, setDuplicateError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const expenseCategories = (categories.data ?? []).filter((category) => category.kind === "expense");
  const periodBudgets = (budgets.data ?? []).filter((budget) => budget.period === period);
  const categoryById = new Map((categories.data ?? []).map((category) => [category.id, category]));

  const createBudget = (values: BudgetFormValues) => {
    if (periodBudgets.some((budget) => budget.category_id === values.category_id)) {
      setDuplicateError("A budget already exists for this category and month. Edit the existing budget instead.");
      return;
    }
    setDuplicateError("");
    setSavedMessage("");
    const body: BudgetCreate = values;
    create.mutate(body, { onSuccess: () => setSavedMessage("Budget saved.") });
  };

  return <div className="mx-auto max-w-5xl space-y-6">
    <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-900">Planning</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Budgets</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Set monthly spending limits by expense category. Actual spending is shown on the Overview dashboard.</p></div>
    {canWrite && <Card className="overflow-hidden"><CardHeader className="border-b border-slate-100"><CardTitle>Create a budget</CardTitle><CardDescription className="mt-1">Choose an expense category and the month it applies to.</CardDescription></CardHeader><div className="space-y-3 p-5"><BudgetFields categories={categories.data ?? []} error={create.error} formError={duplicateError} busy={create.isPending} onSave={createBudget} submitLabel="Add budget" />{savedMessage && <p className="text-sm text-emerald-800" role="status">{savedMessage}</p>}</div></Card>}
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-100"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Monthly budgets</CardTitle><CardDescription className="mt-1">These limits are used by the dashboard and monthly budget reports.</CardDescription></div><label className="space-y-1.5 text-xs font-semibold text-slate-600">Show month<Input aria-label="Show budget month" onChange={(event) => setPeriod(event.currentTarget.value)} type="month" value={period} /></label></div></CardHeader>
      {budgets.isPending || categories.isPending ? <LoadingState label="Loading budgets" /> : budgets.isError || categories.isError ? <div className="space-y-3 p-5">{budgets.isError && <ErrorMessage>{errorText(budgets.error, "Budgets could not load.")}</ErrorMessage>}{categories.isError && <ErrorMessage>{errorText(categories.error, "Categories could not load.")}</ErrorMessage>}<Button onClick={() => { void budgets.refetch(); void categories.refetch(); }} variant="secondary">Try again</Button></div> : periodBudgets.length === 0 ? <div className="px-6 py-12 text-center"><h2 className="text-base font-semibold text-slate-900">No budgets for {period ? format(parseISO(`${period}-01`), "MMMM yyyy") : "this month"}</h2><p className="mt-1 text-sm text-slate-600">{canWrite ? expenseCategories.length ? "Add a monthly budget to track spending against a limit." : "Create an expense category first, then come back to set a budget." : "No spending limits have been set for this month."}</p></div> : <div className="space-y-3 p-4 sm:p-5">{periodBudgets.map((budget) => <BudgetCard canWrite={canWrite} categories={categories.data ?? []} categoryName={categoryById.get(budget.category_id)?.name ?? "Category unavailable"} companyId={companyId} currency={currency} budget={budget} key={budget.id} />)}</div>}
    </Card>
  </div>;
}

export function BudgetsPage() {
  const company = useCompany();
  const { canWrite } = useRole();
  return <CompanyBudgets canWrite={canWrite} companyId={company.company_id} currency={company.currency_code} key={company.company_id} />;
}
