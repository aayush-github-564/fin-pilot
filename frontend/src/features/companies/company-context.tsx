import { createContext, useContext, type ReactNode } from "react";

import type { CompanyMembership } from "./api";

interface CompanyContextValue {
  company: CompanyMembership;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({
  company,
  children,
}: {
  company: CompanyMembership;
  children: ReactNode;
}) {
  return (
    <CompanyContext.Provider value={{ company }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany(): CompanyMembership {
  const context = useContext(CompanyContext);
  if (!context) throw new Error("useCompany must be used inside a company route.");
  return context.company;
}

export function useRole() {
  const company = useCompany();
  const fallbackPermissions: Record<CompanyMembership["role"], string[]> = {
    owner: ["invoice:upload", "invoice:review", "invoices:manage", "transaction:categorize", "transaction:manage", "categories:manage", "budgets:manage", "company:edit", "company:currency", "company:delete", "members:manage", "owner:grant"],
    accountant: ["invoice:upload", "invoice:review", "invoices:manage", "transaction:categorize", "transaction:manage", "categories:manage", "budgets:manage", "company:edit", "members:manage"],
    member: ["invoice:upload", "invoice:review", "transaction:categorize"],
    viewer: [],
  };
  const permissions = company.permissions ?? fallbackPermissions[company.role];
  const hasPermission = (permission: string) => permissions.includes(permission);
  const roleLabel = company.role === "accountant"
    ? "Admin"
    : company.role === "owner"
      ? "Owner"
      : company.role === "member"
        ? "Member"
        : "Viewer";
  const roleDescription = company.role === "owner"
    ? "Full company control, including accounting currency and ownership."
    : company.role === "accountant"
      ? "Can manage financial records, budgets, categories, and members."
      : company.role === "member"
        ? "Can upload invoices, review extracted details, and categorize transactions."
        : "Can view company records and ask FinPilot questions.";
  return {
    role: company.role,
    permissions,
    hasPermission,
    roleLabel,
    roleDescription,
    canWrite: hasPermission("transaction:manage"),
    canUploadInvoices: hasPermission("invoice:upload"),
    canReviewInvoices: hasPermission("invoice:review"),
    canCategorize: hasPermission("transaction:categorize"),
    canManageCategories: hasPermission("categories:manage"),
    canManageBudgets: hasPermission("budgets:manage"),
    canManageMembers: hasPermission("members:manage"),
    isOwner: company.role === "owner",
  };
}
