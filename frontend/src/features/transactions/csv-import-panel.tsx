import { useQueries, type Query } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage } from "../../components/ui/feedback";
import { Select } from "../../components/ui/select";
import type { CSVImportResult, Transaction } from "./api";
import { getTransaction } from "./api";
import { useImportTransactionsCsv } from "./hooks";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
type RowFilter = "all" | CSVImportResult["rows"][number]["status"];

function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The CSV file could not be imported.";
}

function resultVariant(status: CSVImportResult["rows"][number]["status"]) {
  if (status === "imported") return "success" as const;
  if (status === "duplicate") return "neutral" as const;
  return "danger" as const;
}

function categorizationLabel(status: string | null | undefined) {
  if (!status) return "—";
  return status.replaceAll("_", " ");
}

export function CsvImportPanel({ companyId, currencyCode }: { companyId: string; currencyCode: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [result, setResult] = useState<CSVImportResult | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const importMutation = useImportTransactionsCsv(companyId);

  const pendingRows = result?.rows.filter((row) =>
    row.status === "imported" && row.categorization_status === "pending" && row.transaction_id,
  ) ?? [];
  const statusQueries = useQueries({
    queries: pendingRows.map((row) => ({
      queryKey: ["company", companyId, "transactions", "import-status", row.transaction_id],
      queryFn: () => getTransaction(companyId, row.transaction_id!),
      refetchInterval: (query: Query<Transaction>) =>
        query.state.data?.categorization_status === "pending" ? 2_000 : false,
      refetchIntervalInBackground: false,
      retry: false,
    })),
  });

  const statusByTransactionId = new Map(
    pendingRows.map((row, index) => [
      row.transaction_id!,
      {
        status: statusQueries[index]?.data?.categorization_status ?? row.categorization_status,
        error: statusQueries[index]?.isError ?? false,
      },
    ]),
  );

  const visibleRows = result?.rows.filter((row) => rowFilter === "all" || row.status === rowFilter) ?? [];
  const stillPendingCount = pendingRows.filter((row) =>
    statusByTransactionId.get(row.transaction_id!)?.status === "pending",
  ).length;

  const chooseFile = (selected: File | null) => {
    setFile(selected);
    setResult(null);
    setRowFilter("all");
    importMutation.reset();
    if (selected && selected.size > MAX_FILE_BYTES) {
      setFileError("CSV file exceeds the 5 MiB upload limit. Choose a smaller file.");
      return;
    }
    setFileError("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setFileError("Choose a CSV file to import.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError("CSV file exceeds the 5 MiB upload limit. Choose a smaller file.");
      return;
    }
    setFileError("");
    importMutation.mutate(file, {
      onSuccess: (report) => setResult(report),
    });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-line">
        <CardTitle>Import a bank statement</CardTitle>
        <CardDescription className="mt-1">
          CSV imports support up to 1,000 transaction rows. Review these assumptions before uploading.
        </CardDescription>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-foreground-body">
          <li>
            Amounts are treated as {currencyCode ? `company accounting currency (${currencyCode})` : "company accounting currency"}; FinPilot does not convert currencies.
            {!currencyCode && " This company has no currency set, so amounts will be imported as-is."}
          </li>
          <li>Ambiguous slash dates are read day-first (for example, 03/04/2026 means 3 April 2026).</li>
          <li>Rows with stable bank references are checked for duplicates. Without one, duplicate detection uses this exact file and row number.</li>
        </ul>
      </CardHeader>

      <div className="space-y-4 p-5">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={submit}>
          <label className="min-w-0 flex-1 space-y-1.5 text-xs font-semibold text-muted" htmlFor="statement-csv">
            CSV file (maximum 5 MiB)
            <input
              accept=".csv,text/csv"
              className="block min-h-11 w-full rounded-md border border-input-line bg-surface px-3 py-2 text-sm font-normal text-foreground-body file:mr-3 file:rounded-sm file:border-0 file:bg-linen file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground-body focus:outline-none focus:ring-4 focus:ring-accent/10"
              id="statement-csv"
              onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)}
              type="file"
            />
          </label>
          <Button disabled={!file || Boolean(fileError) || importMutation.isPending} type="submit">
            {importMutation.isPending ? "Importing…" : "Import CSV"}
          </Button>
        </form>

        {fileError && <ErrorMessage>{fileError}</ErrorMessage>}
        {importMutation.error && <ErrorMessage>{errorText(importMutation.error)}</ErrorMessage>}

        {result && <section aria-labelledby="csv-import-results" className="space-y-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground" id="csv-import-results">Import results</h3>
              <p className="mt-1 text-sm text-muted">{result.rows_seen} non-empty transaction rows checked.</p>
            </div>
            {stillPendingCount > 0 && <Badge variant="info">Refreshing {stillPendingCount} pending categorization{stillPendingCount === 1 ? "" : "s"}</Badge>}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Imported" value={result.imported_count} />
            <SummaryCard label="Duplicates skipped" value={result.duplicate_count} />
            <SummaryCard label="Rows rejected" value={result.rejected_count} />
            <SummaryCard label="Rows checked" value={result.rows_seen} />
          </div>

          <label className="flex max-w-xs flex-col gap-1.5 text-xs font-semibold text-muted" htmlFor="csv-row-filter">
            Filter report rows
            <Select id="csv-row-filter" onChange={(event) => setRowFilter(event.currentTarget.value as RowFilter)} value={rowFilter}>
              <option value="all">All results</option>
              <option value="imported">Imported</option>
              <option value="duplicate">Duplicates</option>
              <option value="rejected">Rejected</option>
            </Select>
          </label>

          {visibleRows.length === 0 ? <p className="rounded-md bg-surface-raised p-4 text-sm text-muted">No report rows match this filter.</p> :
            <div className="overflow-x-auto rounded-sm border border-border">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="bg-surface-raised text-xs font-bold uppercase tracking-wide text-muted">
                  <tr><th className="px-4 py-3">CSV row</th><th className="px-4 py-3">Import result</th><th className="px-4 py-3">Categorization</th><th className="px-4 py-3">Details</th></tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const polled = row.transaction_id ? statusByTransactionId.get(row.transaction_id) : undefined;
                    const categorization = polled?.status ?? row.categorization_status;
                    const details = row.status === "rejected"
                      ? row.error_message ?? row.error_code ?? "Row could not be imported."
                      : row.status === "duplicate"
                        ? "This row matches a transaction already imported."
                        : polled?.error
                          ? "Could not refresh this row’s categorization status."
                          : categorization === "pending"
                            ? "Categorization is still processing."
                            : categorization === "needs_review"
                              ? "Open the review queue to check its category."
                              : categorization === "failed"
                                ? "Categorization failed; assign a category in the transactions list."
                                : "Transaction added to the company ledger.";
                    return <tr className="border-t border-line" key={row.row_number}>
                      <td className="px-4 py-3 tabular-nums">{row.row_number}</td>
                      <td className="px-4 py-3"><Badge variant={resultVariant(row.status)}>{row.status}</Badge></td>
                      <td className="px-4 py-3">{categorizationLabel(categorization)}</td>
                      <td className="px-4 py-3 text-muted">{details}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>}
        </section>}
      </div>
    </Card>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md bg-surface-raised px-4 py-3">
    <p className="text-xs font-medium text-muted">{label}</p>
    <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
  </div>;
}
