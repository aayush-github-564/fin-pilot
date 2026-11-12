import { ArrowDownRight, ArrowUpRight, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Select } from "../../components/ui/select";
import { formatMoney } from "../../lib/money";
import { useCompany, useRole } from "../companies/company-context";
import type { Category, Transaction } from "./api";
import {
  useAcceptTransactionSuggestion,
  useCategories,
  useOverrideReviewCategory,
  useReviewTransactions,
} from "./hooks";

const PAGE_SIZE = 50;

function queryError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The review queue could not load.";
}

function suggestedConfidence(value: string | null) {
  if (value === null) return "Confidence unavailable";
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return "Confidence unavailable";
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(confidence * 100)}% confidence`;
}

function matchingCategories(transaction: Transaction, categories: Category[]) {
  if (/^-?0+(?:\.0+)?$/.test(transaction.amount)) return [];
  const kind: Category["kind"] = transaction.amount.startsWith("-") ? "expense" : "income";
  return categories.filter((category) => category.kind === kind);
}

function ReviewItem({
  transaction,
  categories,
  currency,
  canWrite,
  pending,
  selectedCategory,
  onSelectCategory,
  onAccept,
  onOverride,
}: {
  transaction: Transaction;
  categories: Category[];
  currency: string | null;
  canWrite: boolean;
  pending: boolean;
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  onAccept: () => void;
  onOverride: () => void;
}) {
  const categoryOptions = matchingCategories(transaction, categories);
  const suggestion = categories.find((category) => category.id === transaction.suggested_category_id);
  const noAmount = /^-?0+(?:\.0+)?$/.test(transaction.amount);

  return (
    <article className="grid gap-5 rounded-lg border border-card-line bg-card p-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="caution">Needs review</Badge>
          <span className="text-xs text-muted">{transaction.date}</span>
          <Badge variant="info">{transaction.source === "upload" ? "Imported" : "Manual"}</Badge>
        </div>
        <h2 className="mt-3 truncate text-base font-semibold text-foreground" title={transaction.description ?? "No description"}>
          {transaction.description || "No description"}
        </h2>
        <p className="fp-figure mt-1 flex w-full items-center justify-end gap-1.5 text-sm font-semibold text-foreground-body">
          {!noAmount && (transaction.amount.startsWith("-")
            ? <ArrowUpRight aria-hidden="true" className="size-4 text-negative" />
            : <ArrowDownRight aria-hidden="true" className="size-4 text-positive" />)}
          {formatMoney(transaction.amount, currency)}
        </p>
      </div>

      <div className="rounded-md bg-surface-raised p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Suggested category</p>
        <p className="mt-1 font-semibold text-foreground">{suggestion?.name ?? (transaction.suggested_category_id ? "Suggestion unavailable" : "No suggestion")}</p>
        <p className="mt-1 text-right text-xs text-muted"><span className="tabular-nums">{suggestedConfidence(transaction.suggestion_confidence)}</span></p>
      </div>

      {canWrite && <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
        {transaction.suggested_category_id && <Button disabled={pending} onClick={onAccept} size="sm">
          <Check aria-hidden="true" className="size-4" />Accept suggestion
        </Button>}
        <div className="flex min-w-52 gap-2">
          <Select
            aria-label={`Override category for ${transaction.description ?? "transaction"}`}
            className="min-h-9 py-1.5 text-xs"
            disabled={pending || categoryOptions.length === 0}
            onChange={(event) => onSelectCategory(event.currentTarget.value)}
            value={selectedCategory}
          >
            <option value="">Choose override</option>
            {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
          <Button disabled={pending || !selectedCategory} onClick={onOverride} size="sm" variant="secondary">Save</Button>
        </div>
      </div>}
    </article>
  );
}

export function ReviewQueuePage() {
  const company = useCompany();
  const { canCategorize: canWrite } = useRole();
  const [skip, setSkip] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const query = { skip, limit: PAGE_SIZE };
  const queue = useReviewTransactions(company.company_id, query);
  const categories = useCategories(company.company_id);
  const acceptSuggestion = useAcceptTransactionSuggestion(company.company_id);
  const overrideCategory = useOverrideReviewCategory(company.company_id);
  const actionPending = acceptSuggestion.isPending || overrideCategory.isPending;
  const mutationError = acceptSuggestion.error ?? overrideCategory.error;
  const conflict = mutationError instanceof ApiError && mutationError.status === 409;

  return (
    <div className="space-y-6">
      <div>
        <p className="fp-eyebrow">Categorization</p>
        <h1 className="fp-page-title mt-2">Review <em>queue</em></h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Check uncertain transaction categories. Accept a suggestion or choose a category that matches the transaction direction.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-line">
          <div><CardTitle>Transactions needing review</CardTitle><CardDescription className="mt-1">Suggestions are not applied until an authorized member confirms them.</CardDescription></div>
          <Badge variant="neutral">{queue.data ? `${queue.data.length} on this page` : "Loading queue"}</Badge>
        </CardHeader>

        {mutationError && <div className="px-5 pt-4">
          <ErrorMessage>{conflict
            ? "This transaction changed while you were reviewing it. The queue has been refreshed; check the latest suggestion before acting again."
            : queryError(mutationError)}</ErrorMessage>
        </div>}
        {categories.isError && <div className="px-5 pt-4"><ErrorMessage>{queryError(categories.error)}</ErrorMessage></div>}

        {queue.isPending ? <LoadingState label="Loading review queue" /> : queue.isError ? <div className="space-y-3 p-5"><ErrorMessage>{queryError(queue.error)}</ErrorMessage><Button onClick={() => void queue.refetch()} variant="secondary">Try again</Button></div> : queue.data.length === 0 ? <div className="px-6 py-14 text-center"><h2 className="text-lg font-semibold text-foreground">Nothing needs review</h2><p className="mt-2 text-sm text-muted">New uncertain or failed categorizations will appear here.</p></div> : <div className="space-y-3 p-5">
          {queue.data.map((transaction) => <ReviewItem
            canWrite={canWrite && !categories.isError}
            categories={categories.data ?? []}
            currency={company.currency_code}
            key={transaction.id}
            onAccept={() => { acceptSuggestion.reset(); overrideCategory.reset(); acceptSuggestion.mutate(transaction.id); }}
            onOverride={() => {
              const categoryId = overrides[transaction.id];
              if (!categoryId) return;
              acceptSuggestion.reset();
              overrideCategory.mutate({ transactionId: transaction.id, categoryId });
            }}
            onSelectCategory={(categoryId) => setOverrides((current) => ({ ...current, [transaction.id]: categoryId }))}
            pending={actionPending}
            selectedCategory={overrides[transaction.id] ?? ""}
            transaction={transaction}
          />)}
        </div>}

        {queue.data && queue.data.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="text-sm text-muted">Page {Math.floor(skip / PAGE_SIZE) + 1}</p>
          <div className="flex gap-2">
            <Button disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))} size="sm" variant="secondary"><ChevronLeft aria-hidden="true" className="size-4" />Previous</Button>
            <Button disabled={queue.data.length < PAGE_SIZE} onClick={() => setSkip(skip + PAGE_SIZE)} size="sm" variant="secondary">Next<ChevronRight aria-hidden="true" className="size-4" /></Button>
          </div>
        </div>}
      </Card>
    </div>
  );
}
