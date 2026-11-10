import { useMutation } from "@tanstack/react-query";

import { askFinancialQuestion } from "./api";

export function useAskFinancialQuestion(companyId: string) {
  return useMutation({
    mutationFn: (question: string) => askFinancialQuestion(companyId, { question }),
    retry: false,
  });
}
