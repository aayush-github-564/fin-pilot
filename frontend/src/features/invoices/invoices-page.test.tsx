import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { CompanyProvider } from "../companies/company-context";
import type { CompanyMembership } from "../companies/api";
import { server } from "../../test/server";
import type { Invoice } from "./api";
import { InvoicesPage } from "./invoices-page";

const company: CompanyMembership = {
  company_id: "company-a",
  name: "Northstar Studio",
  currency_code: "USD",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
};

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    company_id: company.company_id,
    direction: "purchase",
    vendor: "Northwind Paper",
    amount: "125.50",
    date: "2026-11-03",
    status: "pending",
    processing_status: "complete",
    confirmed_at: null,
    file_reference: "company-a/northwind.pdf",
    ...overrides,
  };
}

function renderPage(role: CompanyMembership["role"] = "owner") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><CompanyProvider company={{ ...company, role }}><InvoicesPage /></CompanyProvider></QueryClientProvider>);
}

describe("invoices page", () => {
  it("uploads a supported document with a required direction", async () => {
    let uploadContentType: string | null = null;
    let savedInvoice: Invoice | null = null;
    server.use(
      http.get("*/api/v1/companies/company-a/invoices", () => HttpResponse.json(savedInvoice ? [savedInvoice] : [])),
      http.post("*/api/v1/companies/company-a/invoices/upload", ({ request }) => {
        uploadContentType = request.headers.get("content-type");
        savedInvoice = invoice({ direction: "sale", processing_status: "pending" });
        return HttpResponse.json(savedInvoice, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("No invoices yet");
    await user.selectOptions(document.getElementById("invoice-direction") as HTMLSelectElement, "sale");
    await user.upload(screen.getByLabelText("Invoice or receipt file"), new File(["fake pdf"], "customer-invoice.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    expect(await screen.findByText(/customer-invoice.pdf uploaded/)).toBeInTheDocument();
    await screen.findAllByText("Sale");
    expect(uploadContentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(screen.getByText(/Invoices do not change cash flow/)).toBeInTheDocument();
  });

  it("lets an accountant correct missing extraction fields and confirm after the server accepts them", async () => {
    let saved = invoice({ vendor: null, amount: null, date: null, processing_status: "failed" });
    let patchBody: unknown;
    server.use(
      http.get("*/api/v1/companies/company-a/invoices", () => HttpResponse.json([saved])),
      http.patch("*/api/v1/companies/company-a/invoices/:invoiceId", async ({ request }) => {
        patchBody = await request.json();
        saved = invoice({ ...saved, ...(patchBody as object) });
        return HttpResponse.json(saved);
      }),
      http.post("*/api/v1/companies/company-a/invoices/:invoiceId/confirm", () => {
        saved = invoice({ ...saved, confirmed_at: "2026-11-10T09:00:00Z" });
        return HttpResponse.json(saved);
      }),
    );
    const user = userEvent.setup();
    renderPage("accountant");

    await screen.findByText("Extraction failed");
    expect(screen.getAllByText("Needs review")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Review or edit" }));
    await user.type(screen.getByLabelText("Vendor or customer"), "Contoso Supplies");
    await user.type(screen.getByLabelText("Invoice total"), "349.95");
    await user.type(screen.getByLabelText("Invoice date"), "2026-11-04");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findAllByText("Contoso Supplies");
    expect(patchBody).toEqual({ direction: "purchase", vendor: "Contoso Supplies", amount: "349.95", date: "2026-11-04", status: "pending" });
    await user.click(screen.getByRole("button", { name: "Confirm review" }));
    expect(await screen.findByText("Reviewed")).toBeInTheDocument();
  });

  it("polls only while an invoice is processing and stops after it completes", async () => {
    let requestCount = 0;
    server.use(http.get("*/api/v1/companies/company-a/invoices", () => {
      requestCount += 1;
      return HttpResponse.json([invoice({ processing_status: requestCount === 1 ? "processing" : "complete" })]);
    }));
    renderPage();

    await screen.findByText("Reading document");
    expect(await screen.findByText("Extraction complete", {}, { timeout: 6_000 })).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 3_300));
    expect(requestCount).toBe(2);
  }, 10_000);

  it("keeps viewer controls read-only while allowing company-scoped download", async () => {
    const fileId = invoice().id;
    server.use(
      http.get("*/api/v1/companies/company-a/invoices", () => HttpResponse.json([invoice()])),
      http.get("*/api/v1/companies/company-a/invoices/:invoiceId/download", () => HttpResponse.arrayBuffer(new ArrayBuffer(4), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="invoice-${fileId}.pdf"` },
      })),
    );
    const createObjectURL = vi.fn<(file: Blob) => string>(() => "blob:invoice-test");
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const user = userEvent.setup();
    renderPage("viewer");

    await screen.findAllByText("Northwind Paper");
    expect(screen.queryByRole("button", { name: "Upload document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review or edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm review" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download document" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    anchorClick.mockRestore();
  });

  it("blocks unsupported file extensions before sending an upload request", async () => {
    let uploadCalled = false;
    server.use(
      http.get("*/api/v1/companies/company-a/invoices", () => HttpResponse.json([])),
      http.post("*/api/v1/companies/company-a/invoices/upload", () => { uploadCalled = true; return HttpResponse.json(invoice(), { status: 201 }); }),
    );
    renderPage();
    await screen.findByText("No invoices yet");
    fireEvent.change(screen.getByLabelText("Invoice or receipt file"), { target: { files: [new File(["not supported"], "invoice.gif", { type: "image/gif" })] } });
    expect(await screen.findByText("Choose a PDF, PNG, JPG, JPEG, or WebP invoice or receipt.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload document" })).toBeDisabled();
    expect(uploadCalled).toBe(false);
  });
});
