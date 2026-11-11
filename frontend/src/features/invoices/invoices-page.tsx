import { format, isValid, parseISO } from "date-fns";
import { Check, Download, FileUp, ReceiptText, RotateCw, TriangleAlert } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { formatMoney } from "../../lib/money";
import { useCompany, useRole } from "../companies/company-context";
import type { Invoice, InvoiceDirection, InvoiceStatus, InvoiceUpdate } from "./api";
import { invoiceListQueryKey, useConfirmInvoice, useDownloadInvoice, useInvoices, useUpdateInvoice, useUploadInvoice } from "./hooks";

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const PAYMENT_STATUSES: InvoiceStatus[] = ["pending", "paid", "overdue", "cancelled"];

function errorText(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not extracted";
  const date = parseISO(value);
  return isValid(date) ? format(date, "MMM d, yyyy") : value;
}

function processingLabel(status: string) {
  if (status === "pending") return "Queued";
  if (status === "processing") return "Reading document";
  if (status === "complete") return "Extraction complete";
  if (status === "failed") return "Extraction failed";
  return status.replaceAll("_", " ");
}

function processingVariant(status: string) {
  if (status === "complete") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "info" as const;
}

function isProcessing(status: string) {
  return status === "pending" || status === "processing";
}

function MissingField({ label, value }: { label: string; value: string | null | undefined }) {
  const missing = value === null || value === undefined || value.trim() === "";
  return <div className="space-y-1">
    <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">{label}{missing && <Badge variant="danger">Needs review</Badge>}</dt>
    <dd className={`break-words text-sm font-semibold ${missing ? "text-amber-900" : "text-slate-900"}`}>{value || "Not extracted"}</dd>
  </div>;
}

function InvoiceEditForm({
  invoice,
  pending,
  onSave,
  onCancel,
}: {
  invoice: Invoice;
  pending: boolean;
  onSave: (body: InvoiceUpdate) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<InvoiceDirection | "">(invoice.direction ?? "");
  const [vendor, setVendor] = useState(invoice.vendor ?? "");
  const [amount, setAmount] = useState(invoice.amount ?? "");
  const [date, setDate] = useState(invoice.date ?? "");
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [validationError, setValidationError] = useState("");
  const confirmed = Boolean(invoice.confirmed_at);

  const submit = () => {
    if (!confirmed && !direction) {
      setValidationError("Choose whether this is a purchase or a sale.");
      return;
    }
    if (!confirmed && amount.trim() && !/^-?(?:\d{1,10}(?:\.\d{1,2})?|\.\d{1,2})$/.test(amount.trim())) {
      setValidationError("Enter a valid amount with no more than two decimal places.");
      return;
    }
    setValidationError("");
    onSave(confirmed ? { status } : {
      direction: direction as InvoiceDirection,
      vendor: vendor.trim() || null,
      amount: amount.trim() || null,
      date: date || null,
      status,
    });
  };

  return <div className="space-y-4 rounded-xl border border-cyan-100 bg-cyan-50/50 p-4">
    <h3 className="text-sm font-semibold text-slate-900">{confirmed ? "Update payment status" : "Review extracted details"}</h3>
    {!confirmed && <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-xs font-semibold text-slate-600" htmlFor={`invoice-direction-${invoice.id}`}>Document direction
        <Select id={`invoice-direction-${invoice.id}`} onChange={(event) => setDirection(event.currentTarget.value as InvoiceDirection | "")} value={direction}>
          <option value="">Choose direction</option><option value="purchase">Purchase · money owed to vendor</option><option value="sale">Sale · money owed by customer</option>
        </Select>
      </label>
      <label className="space-y-1.5 text-xs font-semibold text-slate-600" htmlFor={`invoice-vendor-${invoice.id}`}>Vendor or customer<Input autoComplete="organization" id={`invoice-vendor-${invoice.id}`} onChange={(event) => setVendor(event.currentTarget.value)} value={vendor} /></label>
      <label className="space-y-1.5 text-xs font-semibold text-slate-600" htmlFor={`invoice-amount-${invoice.id}`}>Invoice total<Input id={`invoice-amount-${invoice.id}`} inputMode="decimal" onChange={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" value={amount} /></label>
      <label className="space-y-1.5 text-xs font-semibold text-slate-600" htmlFor={`invoice-date-${invoice.id}`}>Invoice date<Input id={`invoice-date-${invoice.id}`} onChange={(event) => setDate(event.currentTarget.value)} type="date" value={date} /></label>
    </div>}
    <label className="block max-w-xs space-y-1.5 text-xs font-semibold text-slate-600" htmlFor={`invoice-status-${invoice.id}`}>Payment status
      <Select id={`invoice-status-${invoice.id}`} onChange={(event) => setStatus(event.currentTarget.value as InvoiceStatus)} value={status}>
        {PAYMENT_STATUSES.map((option) => <option key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</option>)}
      </Select>
    </label>
    {validationError && <p className="text-sm text-rose-800" role="alert">{validationError}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={pending} onClick={submit} size="sm">{pending ? "Saving…" : "Save changes"}</Button><Button disabled={pending} onClick={onCancel} size="sm" variant="secondary">Cancel</Button></div>
  </div>;
}

function InvoiceCard({ invoice, companyId, currency, canWrite }: {
  invoice: Invoice;
  companyId: string;
  currency: string | null;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateInvoice(companyId);
  const confirm = useConfirmInvoice(companyId);
  const download = useDownloadInvoice(companyId);
  const busy = update.isPending || confirm.isPending || download.isPending;
  const pendingExtraction = isProcessing(invoice.processing_status);
  const completeFieldsPresent = Boolean(
    invoice.direction && invoice.vendor?.trim() && invoice.amount !== null && invoice.amount !== undefined && invoice.date,
  );
  const canConfirm = canWrite && !invoice.confirmed_at && !pendingExtraction && completeFieldsPresent;

  const save = (body: InvoiceUpdate) => update.mutate({ invoiceId: invoice.id, body }, {
    onSuccess: () => {
      setEditing(false);
    },
  });

  const downloadFile = async () => {
    try {
      const file = await download.mutateAsync(invoice.id);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      // The query mutation retains the normalized API error for the card's message.
    }
  };

  return <Card className="overflow-hidden">
    <CardHeader className="border-b border-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={invoice.direction === "sale" ? "success" : "info"}>{invoice.direction === "sale" ? "Sale" : invoice.direction === "purchase" ? "Purchase" : "Direction needed"}</Badge>
            <Badge variant={processingVariant(invoice.processing_status)}>{processingLabel(invoice.processing_status)}</Badge>
            <Badge variant={invoice.status === "overdue" ? "danger" : invoice.status === "paid" ? "success" : "neutral"}>Payment {invoice.status}</Badge>
            {invoice.confirmed_at && <Badge variant="success">Reviewed</Badge>}
          </div>
          <CardTitle className="mt-3 break-words">{invoice.vendor?.trim() || "Vendor or customer not extracted"}</CardTitle>
          <CardDescription className="mt-1">Invoice date: {formatDate(invoice.date)}{invoice.confirmed_at ? ` · Reviewed ${formatDate(invoice.confirmed_at.slice(0, 10))}` : ""}</CardDescription>
        </div>
        <p className="shrink-0 text-lg font-semibold tabular-nums text-slate-950">{invoice.amount === null || invoice.amount === undefined ? "Amount not extracted" : formatMoney(invoice.amount, currency)}</p>
      </div>
    </CardHeader>

    <div className="space-y-4 p-5">
      {(invoice.vendor === null || invoice.vendor?.trim() === "" || invoice.amount === null || invoice.amount === undefined || !invoice.date || !invoice.direction) && !pendingExtraction && <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950" role="status"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Some fields were not extracted. Review and correct the marked details before confirming.</p>}
      {invoice.processing_status === "failed" && <p className="text-sm text-rose-800">Automatic extraction failed. You can enter the invoice details manually and review them.</p>}
      {pendingExtraction && <p className="text-sm text-slate-600">FinPilot is reading the document. This invoice will refresh automatically for a limited time while processing.</p>}
      <dl className="grid gap-3 sm:grid-cols-2">
        <MissingField label="Vendor or customer" value={invoice.vendor} />
        <MissingField label="Direction" value={invoice.direction === "purchase" ? "Purchase" : invoice.direction === "sale" ? "Sale" : null} />
        <MissingField label="Invoice date" value={invoice.date ? formatDate(invoice.date) : null} />
        <MissingField label="Invoice total" value={invoice.amount === null || invoice.amount === undefined ? null : formatMoney(invoice.amount, currency)} />
      </dl>

      {editing && <InvoiceEditForm
        invoice={invoice}
        onCancel={() => { setEditing(false); update.reset(); }}
        onSave={save}
        pending={update.isPending}
      />}
      {(update.error || confirm.error || download.error) && <ErrorMessage>{errorText(update.error ?? confirm.error ?? download.error, "This invoice action could not be completed.")}</ErrorMessage>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        {invoice.file_reference && <Button disabled={download.isPending} onClick={() => void downloadFile()} size="sm" variant="secondary"><Download aria-hidden="true" className="size-4" />{download.isPending ? "Downloading…" : "Download document"}</Button>}
        {canWrite && !pendingExtraction && !invoice.confirmed_at && <Button disabled={busy} onClick={() => { setEditing(true); update.reset(); confirm.reset(); }} size="sm" variant="secondary">Review or edit</Button>}
        {canWrite && invoice.confirmed_at && !editing && <Button disabled={busy} onClick={() => { setEditing(true); update.reset(); }} size="sm" variant="secondary">Update payment status</Button>}
        {canConfirm && !editing && <Button disabled={busy} onClick={() => confirm.mutate(invoice.id)} size="sm"><Check aria-hidden="true" className="size-4" />{confirm.isPending ? "Confirming…" : "Confirm review"}</Button>}
        {canWrite && !invoice.confirmed_at && !pendingExtraction && !completeFieldsPresent && !editing && <span className="self-center text-xs text-slate-500">Fill all required details to enable confirmation.</span>}
      </div>
    </div>
  </Card>;
}

function InvoiceUploadForm({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [direction, setDirection] = useState<InvoiceDirection>("purchase");
  const [fileError, setFileError] = useState("");
  const [uploadedName, setUploadedName] = useState("");
  const upload = useUploadInvoice(companyId);

  if (!canWrite) return null;

  const selectFile = (selected: File | null) => {
    setFile(selected);
    setUploadedName("");
    upload.reset();
    const extension = selected?.name.includes(".") ? `.${selected.name.split(".").pop()?.toLowerCase()}` : "";
    if (selected && !SUPPORTED_EXTENSIONS.has(extension)) {
      setFileError("Choose a PDF, PNG, JPG, JPEG, or WebP invoice or receipt.");
      return;
    }
    setFileError("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setFileError("Choose an invoice or receipt file to upload.");
      return;
    }
    if (!SUPPORTED_EXTENSIONS.has(`.${file.name.split(".").pop()?.toLowerCase()}`)) {
      setFileError("Choose a PDF, PNG, JPG, JPEG, or WebP invoice or receipt.");
      return;
    }
    setFileError("");
    upload.mutate({ file, direction }, {
      onSuccess: () => {
        setUploadedName(file.name);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
      },
    });
  };

  return <Card className="overflow-hidden">
    <CardHeader className="border-b border-slate-100">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-900"><FileUp aria-hidden="true" className="size-5" /></span><div><CardTitle>Upload an invoice or receipt</CardTitle><CardDescription className="mt-1">FinPilot reads the document and suggests the vendor, total, and date for you to review.</CardDescription></div></div>
    </CardHeader>
    <div className="space-y-4 p-5">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="space-y-1.5 text-xs font-semibold text-slate-600" htmlFor="invoice-direction">Direction
          <Select id="invoice-direction" onChange={(event) => setDirection(event.currentTarget.value as InvoiceDirection)} value={direction}><option value="purchase">Purchase · money owed to vendor</option><option value="sale">Sale · money owed by customer</option></Select>
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-slate-600 sm:col-span-2" htmlFor="invoice-file">Invoice or receipt file
          <Input accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" id="invoice-file" onChange={(event) => selectFile(event.currentTarget.files?.[0] ?? null)} ref={fileInput} type="file" />
        </label>
        <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Supported file types: PDF, PNG, JPG/JPEG, and WebP. The purchase/sale direction is saved for review. Extraction may leave fields blank if they are unclear.</p>
        <div className="sm:col-span-2"><Button disabled={!file || Boolean(fileError) || upload.isPending} type="submit"><ReceiptText aria-hidden="true" className="size-4" />{upload.isPending ? "Uploading…" : "Upload document"}</Button></div>
      </form>
      {fileError && <ErrorMessage>{fileError}</ErrorMessage>}
      {upload.error && <ErrorMessage>{errorText(upload.error, "The invoice could not be uploaded.")}</ErrorMessage>}
      {uploadedName && <p className="text-sm text-emerald-800" role="status">{uploadedName} uploaded. It will appear in the review list shortly.</p>}
    </div>
  </Card>;
}

function CompanyInvoices({ companyId, currency, canWrite }: { companyId: string; currency: string | null; canWrite: boolean }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [directionFilter, setDirectionFilter] = useState<InvoiceDirection | "">("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "">("");
  const invoices = useInvoices(companyId, limit);
  const queryClient = useQueryClient();
  const queryState = queryClient.getQueryState(invoiceListQueryKey(companyId, { skip: 0, limit }));
  const allItems = invoices.data ?? [];
  const visibleItems = allItems.filter((invoice) =>
    (!directionFilter || invoice.direction === directionFilter) && (!statusFilter || invoice.status === statusFilter),
  );
  const hasProcessing = allItems.some((invoice) => isProcessing(invoice.processing_status));
  const atRefreshLimit = (queryState?.dataUpdateCount ?? 0) + (queryState?.errorUpdateCount ?? 0) >= 30;
  const canLoadMore = allItems.length === limit && limit < MAX_PAGE_SIZE;

  return <div className="mx-auto max-w-5xl space-y-6">
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-900">Documents</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Invoices</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Upload a document, check the extracted details, and confirm the review when they are correct.</p>
    </div>
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><p><strong>Invoices do not change cash flow.</strong> Confirming a document records that you reviewed it. Record money actually received or paid separately in Transactions.</p></div>
    <InvoiceUploadForm canWrite={canWrite} companyId={companyId} />
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-100">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Invoice review list</CardTitle><CardDescription className="mt-1">Newest documents first. Viewers can inspect and download; owners and accountants can upload, edit, and confirm.</CardDescription></div><Badge variant="neutral">{invoices.data ? `${allItems.length} loaded` : "Loading"}</Badge></div>
        <div className="grid gap-3 pt-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-semibold text-slate-600" htmlFor="invoice-filter-direction">Direction
            <Select id="invoice-filter-direction" onChange={(event) => setDirectionFilter(event.currentTarget.value as InvoiceDirection | "")} value={directionFilter}><option value="">All directions</option><option value="purchase">Purchases</option><option value="sale">Sales</option></Select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-slate-600" htmlFor="invoice-filter-status">Payment status
            <Select id="invoice-filter-status" onChange={(event) => setStatusFilter(event.currentTarget.value as InvoiceStatus | "")} value={statusFilter}><option value="">All statuses</option>{PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}</Select>
          </label>
        </div>
      </CardHeader>
      {invoices.isPending ? <LoadingState label="Loading invoices" /> : invoices.isError ? <div className="space-y-3 p-5"><ErrorMessage>{errorText(invoices.error, "Invoices could not load.")}</ErrorMessage><Button onClick={() => void invoices.refetch()} variant="secondary"><RotateCw aria-hidden="true" className="size-4" />Try again</Button></div> : visibleItems.length === 0 ? <div className="px-6 py-12 text-center"><ReceiptText aria-hidden="true" className="mx-auto size-7 text-slate-400" /><h2 className="mt-3 text-base font-semibold text-slate-900">{allItems.length === 0 ? "No invoices yet" : "No invoices match these filters"}</h2><p className="mt-1 text-sm text-slate-600">{allItems.length === 0 ? canWrite ? "Upload an invoice or receipt to start a review." : "No invoice documents have been added to this company yet." : "Change or clear the direction and payment status filters."}</p></div> : <div className="space-y-3 p-4 sm:p-5">
        {hasProcessing && !atRefreshLimit && <p className="flex items-center gap-2 text-xs text-cyan-900" role="status"><RotateCw aria-hidden="true" className="size-3.5 animate-spin" />Refreshing invoices while extraction is running. Automatic checks stop after about 90 seconds.</p>}
        {hasProcessing && atRefreshLimit && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3" role="status"><p className="text-sm text-amber-900">Extraction is still running. Automatic checks have paused.</p><Button disabled={invoices.isFetching} onClick={() => void invoices.refetch()} size="sm" variant="secondary"><RotateCw aria-hidden="true" className="size-4" />{invoices.isFetching ? "Refreshing…" : "Refresh invoices"}</Button></div>}
        {visibleItems.map((invoice) => <InvoiceCard canWrite={canWrite} companyId={companyId} currency={currency} invoice={invoice} key={invoice.id} />)}
        {canLoadMore && <div className="flex justify-center border-t border-slate-100 pt-4"><Button disabled={invoices.isFetching} onClick={() => setLimit((current) => Math.min(MAX_PAGE_SIZE, current + PAGE_SIZE))} variant="secondary">{invoices.isFetching ? "Loading more…" : "Load more invoices"}</Button></div>}
        {limit === MAX_PAGE_SIZE && allItems.length === limit && <p className="text-center text-xs text-slate-500">Showing the maximum of {MAX_PAGE_SIZE} invoices. Use the filters to narrow this list.</p>}
      </div>}
    </Card>
  </div>;
}

export function InvoicesPage() {
  const company = useCompany();
  const { canWrite } = useRole();
  return <CompanyInvoices canWrite={canWrite} companyId={company.company_id} currency={company.currency_code} key={company.company_id} />;
}
