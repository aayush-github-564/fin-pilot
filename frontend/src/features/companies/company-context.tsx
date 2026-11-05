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
  return {
    role: company.role,
    canWrite: company.role === "owner" || company.role === "accountant",
    isOwner: company.role === "owner",
  };
}
