import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import { ArrowDownRight, ArrowUpRight, CirclePlus, FileUp, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import {
  useCategories,
  useCreateTransaction,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
} from "./hooks";
import type { Category, Transaction, TransactionListQuery } from "./api";
import { CsvImportPanel } from "./csv-import-panel";

const PAGE_SIZE = 25;

const transactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a transaction date."),
  direction: z.enum(["inflow", "outflow"]),
  amount: z.string().trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a positive amount with up to two decimal places.")
    .refine((value) => /[1-9]/.test(value), "Amount must be greater than zero."),
  description: z.string().trim().min(1, "Enter a description.").max(500),
  category_id: z.string(),
});

type TransactionFields = z.infer<typeof transactionSchema>;

function todayUtc() {
  const date = new Date();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function statusVariant(status: Transaction["categorization_status"]) {
  if (status === "done") return "success" as const;
  if (status === "needs_review") return "caution" as const;
  if (status === "failed") return "danger" as const;
  return "info" as const;
}

function categoryKindForDirection(direction: TransactionFields["direction"]): Category["kind"] {
  return direction === "inflow" ? "income" : "expense";
}

function amountKind(amount: string): Category["kind"] | null {
  if (/^-?0+(?:\.0+)?$/.test(amount)) return null;
  return amount.startsWith("-") ? "expense" : "income";
}

function absoluteAmount(amount: string) {
  return amount.startsWith("-") ? amount.slice(1) : amount;
}

function signedAmount(amount: string, direction: TransactionFields["direction"]) {
  const trimmed = amount.trim();
  return direction === "outflow" ? `-${trimmed}` : trimmed;
}

function TransactionEditor({
  categories,
  initial,
  pending,
  error,
  onCancel,
  onSave,
}: {
  categories: Category[];
  initial: Transaction | null;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (values: TransactionFields) => void;
}) {
  const form = useForm<TransactionFields>({
    resolver: zodResolver(transactionSchema),
    defaultValues: initial
      ? {
          date: initial.date,
          direction: initial.amount.startsWith("-") ? "outflow" : "inflow",
          amount: absoluteAmount(initial.amount),
          description: initial.description ?? "",
          category_id: initial.category_id ?? "",
        }
      : { date: todayUtc(), direction: "outflow", amount: "", description: "", category_id: "" },
  });
  const direction = useWatch({ control: form.control, name: "direction" });
  const validCategories = categories.filter((category) => category.kind === categoryKindForDirection(direction));

  return (
    <Card className="border-border bg-signal-deep/5">
      <CardHeader>
        <CardTitle>{initial ? "Edit transaction" : "Record a transaction"}</CardTitle>
        <CardDescription>
          Enter a positive amount. FinPilot applies the inflow or outflow sign when saving.
        </CardDescription>
      </CardHeader>
      <form
        className="grid gap-4 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-5"
        noValidate
        onSubmit={form.handleSubmit(onSave)}
      >
        {error ? <div className="sm:col-span-2 xl:col-span-5"><ErrorMessage>{errorText(error, "The transaction could not be saved.")}</ErrorMessage></div> : null}
        <label className="space-y-1.5 text-sm font-medium text-foreground-body">
          Date
          <Input type="date" {...form.register("date")} />
          {form.formState.errors.date && <span className="block text-xs text-negative">{form.formState.errors.date.message}</span>}
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground-body">
          Direction
          <Select {...form.register("direction")}>
            <option value="outflow">Outflow</option>
            <option value="inflow">Inflow</option>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground-body">
          Amount
          <Input className="fp-figure" inputMode="decimal" placeholder="0.00" {...form.register("amount")} />
          {form.formState.errors.amount && <span className="block text-xs text-negative">{form.formState.errors.amount.message}</span>}
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground-body">
          Category
          <Select data-testid="transaction-category-select" {...form.register("category_id")}>
            <option value="">Uncategorized</option>
            {validCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground-body sm:col-span-2 xl:col-span-1">
          Description
          <Input autoFocus={!initial} placeholder="e.g. Office supplies" {...form.register("description")} />
          {form.formState.errors.description && <span className="block text-xs text-negative">{form.formState.errors.description.message}</span>}
        </label>
        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2 xl:col-span-5">
          <Button disabled={pending} onClick={onCancel} type="button" variant="secondary">Cancel</Button>
          <Button disabled={pending} type="submit">{pending ? "Saving…" : initial ? "Save changes" : "Save transaction"}</Button>
        </div>
      </form>
    </Card>
  );
}

function TransactionRow({
  transaction,
  categories,
  currency,
  canWrite,
  pending,
  deleting,
  onEdit,
  onDelete,
  onCancelDelete,
  onCategory,
}: {
  transaction: Transaction;
  categories: Category[];
  currency: string | null;
  canWrite: boolean;
  pending: boolean;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onCategory: (categoryId: string | null) => void;
}) {
  const category = categories.find((item) => item.id === transaction.category_id);
  const kind = amountKind(transaction.amount);
  const zeroAmount = /^-?0+(?:\.0+)?$/.test(transaction.amount);
  const options = kind ? categories.filter((item) => item.kind === kind) : [];

  return (
    <tr className="border-t border-line align-top">
      <td className="whitespace-nowrap px-4 py-4 text-sm text-muted">{format(parseISO(transaction.date), "MMM d, yyyy")}</td>
      <td className="min-w-48 px-4 py-4">
        <p className="font-medium text-foreground">{transaction.description || "No description"}</p>
        <p className="mt-1 text-xs capitalize text-muted">{transaction.source}</p>
      </td>
      <td className="fp-figure whitespace-nowrap px-4 py-4 text-sm font-semibold text-foreground">
        <span className="inline-flex items-center justify-end gap-1.5">
          {!zeroAmount && (transaction.amount.startsWith("-") ? <ArrowUpRight aria-hidden="true" className="size-4 text-negative" /> : <ArrowDownRight aria-hidden="true" className="size-4 text-positive" />)}
          {formatMoney(transaction.amount, currency)}
        </span>
      </td>
      <td className="min-w-48 px-4 py-4">
        {canWrite && kind ? (
          <Select
            aria-label={`Category for ${transaction.description ?? "transaction"}`}
            className="min-h-9 py-1.5 text-xs"
            disabled={pending}
            onChange={(event) => onCategory(event.currentTarget.value || null)}
            value={transaction.category_id ?? ""}
          >
            <option value="">Uncategorized</option>
            {transaction.category_id && !options.some((item) => item.id === transaction.category_id) && <option disabled value={transaction.category_id}>{category?.name ?? "Current category"}</option>}
            {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        ) : <span className="text-sm text-foreground-body">{category?.name ?? "Uncategorized"}</span>}
      </td>
      <td className="px-4 py-4"><Badge variant={statusVariant(transaction.categorization_status)}>{transaction.categorization_status.replaceAll("_", " ")}</Badge></td>
      {canWrite && <td className="whitespace-nowrap px-4 py-3 text-right">
        {deleting ? <div className="flex justify-end gap-1">
          <Button disabled={pending} onClick={onDelete} size="sm" variant="danger">Confirm</Button>
          <Button disabled={pending} onClick={onCancelDelete} size="sm" variant="quiet">Cancel</Button>
        </div> : <div className="flex justify-end gap-1">
          <Button aria-label={`Edit ${transaction.description ?? "transaction"}`} disabled={pending} onClick={onEdit} size="icon" title="Edit transaction" variant="quiet"><Pencil aria-hidden="true" className="size-4" /></Button>
          <Button aria-label={`Delete ${transaction.description ?? "transaction"}`} disabled={pending} onClick={onDelete} size="icon" title="Delete transaction" variant="quiet"><Trash2 aria-hidden="true" className="size-4 text-negative" /></Button>
        </div>}
      </td>}
    </tr>
  );
}

export function TransactionsPage() {
  const company = useCompany();
  const { canWrite } = useRole();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<NonNullable<TransactionListQuery["categorization_status"]> | "">("");
  const [source, setSource] = useState<NonNullable<TransactionListQuery["source"]> | "">("");
  const [direction, setDirection] = useState<NonNullable<TransactionListQuery["direction"]> | "">("");
  const [editorTransaction, setEditorTransaction] = useState<Transaction | null | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const query = useMemo<TransactionListQuery>(() => ({
    offset,
    limit: PAGE_SIZE,
    ...(deferredSearch.trim() ? { search: deferredSearch.trim() } : {}),
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(status ? { categorization_status: status } : {}),
    ...(source ? { source } : {}),
    ...(direction ? { direction } : {}),
  }), [categoryId, deferredSearch, direction, endDate, offset, source, startDate, status]);
  const transactions = useTransactions(company.company_id, query);
  const categories = useCategories(company.company_id);
  const createMutation = useCreateTransaction(company.company_id);
  const updateMutation = useUpdateTransaction(company.company_id);
  const deleteMutation = useDeleteTransaction(company.company_id);

  const resetPage = (change: () => void) => {
    change();
    setOffset(0);
  };
  const save = (values: TransactionFields) => {
    const body = {
      date: values.date,
      amount: signedAmount(values.amount, values.direction),
      description: values.description.trim(),
      category_id: values.category_id || null,
      source: "manual" as const,
    };
    if (editorTransaction) {
      updateMutation.mutate({ transactionId: editorTransaction.id, body }, {
        onSuccess: () => { setEditorTransaction(undefined); updateMutation.reset(); },
      });
    } else {
      createMutation.mutate(body, {
        onSuccess: () => { setEditorTransaction(undefined); createMutation.reset(); },
      });
    }
  };
  const editing = editorTransaction !== undefined;
  const savePending = createMutation.isPending || updateMutation.isPending;
  const saveError = editorTransaction ? updateMutation.error : createMutation.error;
  const deleteRow = (transactionId: string) => deleteMutation.mutate(transactionId, {
    onSuccess: () => { setDeleteId(null); deleteMutation.reset(); },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="fp-eyebrow">Ledger</p>
          <h1 className="fp-page-title mt-2"><em>Transactions</em></h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Browse and maintain this company’s cash movements. Inflows are positive and outflows are negative in the ledger.</p>
        </div>
        {canWrite && <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowCsvImport((current) => !current)} variant="secondary">
            <FileUp aria-hidden="true" className="size-4" />{showCsvImport ? "Close CSV import" : "Import CSV"}
          </Button>
          <Button onClick={() => { createMutation.reset(); updateMutation.reset(); setEditorTransaction(null); }}><CirclePlus aria-hidden="true" className="size-4" />New transaction</Button>
        </div>}
      </div>

      {canWrite && showCsvImport && <CsvImportPanel companyId={company.company_id} currencyCode={company.currency_code} />}

      {editing && <TransactionEditor
        categories={categories.data ?? []}
        error={saveError}
        initial={editorTransaction}
        key={editorTransaction?.id ?? "new"}
        onCancel={() => { setEditorTransaction(undefined); createMutation.reset(); updateMutation.reset(); }}
        onSave={save}
        pending={savePending}
      />}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-line">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><CardTitle>Company ledger</CardTitle><CardDescription className="mt-1">Filter and page through the server’s newest-first transaction list.</CardDescription></div>
            <Badge className="tabular-nums" variant="neutral">{transactions.data ? `${transactions.data.total} records` : "Loading records"}</Badge>
          </div>
          <div className="grid gap-3 pt-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1.5 text-xs font-semibold text-muted">Search description<Input aria-label="Search description" onChange={(event) => resetPage(() => setSearch(event.currentTarget.value))} placeholder="Search transactions" value={search} /></label>
            <label className="space-y-1.5 text-xs font-semibold text-muted">Direction<Select aria-label="Filter by direction" onChange={(event) => resetPage(() => setDirection(event.currentTarget.value as typeof direction))} value={direction}><option value="">All directions</option><option value="inflow">Inflows</option><option value="outflow">Outflows</option></Select></label>
            <label className="space-y-1.5 text-xs font-semibold text-muted">Review status<Select aria-label="Filter by review status" onChange={(event) => resetPage(() => setStatus(event.currentTarget.value as typeof status))} value={status}><option value="">All statuses</option><option value="pending">Pending</option><option value="done">Done</option><option value="needs_review">Needs review</option><option value="failed">Failed</option></Select></label>
            <label className="space-y-1.5 text-xs font-semibold text-muted">Source<Select aria-label="Filter by source" onChange={(event) => resetPage(() => setSource(event.currentTarget.value as typeof source))} value={source}><option value="">All sources</option><option value="manual">Manual</option><option value="upload">Imported</option></Select></label>
            <label className="space-y-1.5 text-xs font-semibold text-muted">From<Input aria-label="Start date" onChange={(event) => resetPage(() => setStartDate(event.currentTarget.value))} type="date" value={startDate} /></label>
            <label className="space-y-1.5 text-xs font-semibold text-muted">Through<Input aria-label="End date" onChange={(event) => resetPage(() => setEndDate(event.currentTarget.value))} type="date" value={endDate} /></label>
            <label className="space-y-1.5 text-xs font-semibold text-muted">Category<Select aria-label="Filter by category" disabled={categories.isPending} onChange={(event) => resetPage(() => setCategoryId(event.currentTarget.value))} value={categoryId}><option value="">All categories</option>{categories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label>
            <div className="flex items-end"><Button onClick={() => { setSearch(""); setStartDate(""); setEndDate(""); setCategoryId(""); setStatus(""); setSource(""); setDirection(""); setOffset(0); }} size="sm" variant="secondary"><RotateCcw aria-hidden="true" className="size-3.5" />Clear filters</Button></div>
          </div>
        </CardHeader>

        {categories.isError && <div className="px-5 pt-4"><ErrorMessage>{errorText(categories.error, "Categories could not load; category controls are unavailable.")}</ErrorMessage></div>}
        {transactions.isPending ? <LoadingState label="Loading transactions" /> : transactions.isError ? <div className="space-y-3 p-5"><ErrorMessage>{errorText(transactions.error, "Transactions could not load.")}</ErrorMessage><Button onClick={() => void transactions.refetch()} variant="secondary">Try again</Button></div> : transactions.data.items.length === 0 ? <div className="px-6 py-14 text-center"><h2 className="text-lg font-semibold text-foreground">No transactions match these filters</h2><p className="mt-2 text-sm text-muted">Clear one or more filters, or record a transaction to start the ledger.</p>{canWrite && <Button className="mt-5" onClick={() => setEditorTransaction(null)}><CirclePlus aria-hidden="true" className="size-4" />Record a transaction</Button>}</div> : <>
          {deleteMutation.error && <div className="px-5 pt-4"><ErrorMessage>{errorText(deleteMutation.error, "The transaction could not be deleted.")}</ErrorMessage></div>}
          {updateMutation.error && !editing && <div className="px-5 pt-4"><ErrorMessage>{errorText(updateMutation.error, "The category could not be changed.")}</ErrorMessage></div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead className="bg-surface-raised text-xs font-bold uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Categorization</th>{canWrite && <th className="px-4 py-3 text-right">Actions</th>}</tr></thead>
              <tbody>{transactions.data.items.map((transaction) => <TransactionRow
                canWrite={canWrite}
                categories={categories.data ?? []}
                currency={company.currency_code}
                deleting={deleteId === transaction.id}
                key={transaction.id}
                onCategory={(categoryId) => updateMutation.mutate({ transactionId: transaction.id, body: { category_id: categoryId } })}
                onDelete={() => deleteId === transaction.id ? deleteRow(transaction.id) : setDeleteId(transaction.id)}
                onEdit={() => { deleteMutation.reset(); updateMutation.reset(); setEditorTransaction(transaction); }}
                onCancelDelete={() => { setDeleteId(null); deleteMutation.reset(); }}
                pending={updateMutation.isPending || deleteMutation.isPending}
                transaction={transaction}
              />)}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <p className="text-sm text-muted">Page <span className="tabular-nums">{Math.floor(offset / PAGE_SIZE) + 1}</span> · <span className="tabular-nums">{transactions.data.total}</span> matching transactions</p>
            <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} size="sm" variant="secondary">Previous</Button><Button disabled={!transactions.data.has_more} onClick={() => setOffset(offset + PAGE_SIZE)} size="sm" variant="secondary">Next</Button></div>
          </div>
        </>}
      </Card>
    </div>
  );
}
