import { useNavigate } from "react-router-dom";

import { useCompany } from "../companies/company-context";

export function useInvoiceUploadTrigger() {
  const navigate = useNavigate();
  const { company_id: companyId } = useCompany();

  return (file?: File) => {
    navigate(`/c/${companyId}/invoices#upload`, {
      state: file ? { uploadFile: file } : undefined,
    });
  };
}
