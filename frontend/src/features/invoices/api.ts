import type { components, operations } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type Invoice = components["schemas"]["InvoiceRead"];
export type InvoiceUpdate = components["schemas"]["InvoiceUpdate"];
export type InvoiceDirection = components["schemas"]["InvoiceDirection"];
export type InvoiceStatus = components["schemas"]["InvoiceStatus"];
export type InvoiceListQuery = NonNullable<
  operations["list_invoices_api_v1_companies__company_id__invoices_get"]["parameters"]["query"]
>;

export async function listInvoices(companyId: string, query: InvoiceListQuery): Promise<Invoice[]> {
  const result = await api.GET("/api/v1/companies/{company_id}/invoices", {
    params: { path: { company_id: companyId }, query },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no invoice list.");
  return result.data;
}

export async function uploadInvoice(companyId: string, file: File, direction: InvoiceDirection): Promise<Invoice> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("direction", direction);
  const result = await api.POST("/api/v1/companies/{company_id}/invoices/upload", {
    params: { path: { company_id: companyId } },
    // openapi-typescript models this multipart file as a string; FormData is the runtime contract.
    body: formData as unknown as components["schemas"]["Body_upload_invoice_api_v1_companies__company_id__invoices_upload_post"],
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no uploaded invoice.");
  return result.data;
}

export async function updateInvoice(companyId: string, invoiceId: string, body: InvoiceUpdate): Promise<Invoice> {
  const result = await api.PATCH("/api/v1/companies/{company_id}/invoices/{invoice_id}", {
    params: { path: { company_id: companyId, invoice_id: invoiceId } },
    body,
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no updated invoice.");
  return result.data;
}

export async function confirmInvoice(companyId: string, invoiceId: string): Promise<Invoice> {
  const result = await api.POST("/api/v1/companies/{company_id}/invoices/{invoice_id}/confirm", {
    params: { path: { company_id: companyId, invoice_id: invoiceId } },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no confirmed invoice.");
  return result.data;
}

export async function downloadInvoiceFile(companyId: string, invoiceId: string): Promise<{ blob: Blob; filename: string }> {
  const result = await api.GET("/api/v1/companies/{company_id}/invoices/{invoice_id}/download", {
    params: { path: { company_id: companyId, invoice_id: invoiceId } },
    parseAs: "blob",
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (!result.data) throw new Error("The server returned no invoice file.");
  const disposition = result.response.headers.get("Content-Disposition") ?? "";
  const candidate = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const filename = candidate && /^invoice-[a-f0-9-]+\.[a-z0-9]+$/i.test(candidate)
    ? candidate
    : `invoice-${invoiceId}`;
  return { blob: result.data, filename };
}
