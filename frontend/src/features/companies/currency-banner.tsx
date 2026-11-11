import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, LoaderCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError } from "../../api/errors";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { setCompanyCurrency, type CompanyMembership } from "./api";
import { useCompany, useRole } from "./company-context";
import { companiesQueryKey } from "./hooks";

const currencySchema = z.object({
  currency_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Enter a three-letter ISO currency code.")
    .transform((value) => value.toUpperCase()),
});

type CurrencyFields = z.input<typeof currencySchema>;
type CurrencyValues = z.output<typeof currencySchema>;

export function CurrencyBanner() {
  const company = useCompany();
  const { isOwner } = useRole();
  const queryClient = useQueryClient();
  const form = useForm<CurrencyFields, unknown, CurrencyValues>({
    resolver: zodResolver(currencySchema),
    defaultValues: { currency_code: "INR" },
  });
  const currencyMutation = useMutation({
    mutationFn: (values: CurrencyValues) =>
      setCompanyCurrency(company.company_id, values.currency_code),
    onSuccess: async (updatedCompany) => {
      queryClient.setQueryData<CompanyMembership[]>(companiesQueryKey, (companies) =>
        companies?.map((item) =>
          item.company_id === updatedCompany.id
            ? { ...item, currency_code: updatedCompany.currency_code }
            : item,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: companiesQueryKey });
    },
  });

  if (company.currency_code) return null;

  return (
    <Card className="mb-7 overflow-hidden border-caution/40 bg-caution/20">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)] lg:items-center">
        <div className="flex items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-caution/20 text-pine">
            <CircleDollarSign aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Set your company accounting currency
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-foreground-body">
              FinPilot displays amounts in this currency and does not convert between
              currencies. An owner must set it before this workspace records financial activity.
            </p>
          </div>
        </div>

        {isOwner ? (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-start"
            noValidate
            onSubmit={form.handleSubmit((values) => currencyMutation.mutate(values))}
          >
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="company-currency">
                ISO 4217 currency code
              </label>
              <Input
                autoCapitalize="characters"
                autoComplete="off"
                id="company-currency"
                maxLength={3}
                placeholder="INR"
                {...form.register("currency_code")}
              />
              {form.formState.errors.currency_code && (
                <p className="mt-1.5 text-xs text-negative" role="alert">
                  {form.formState.errors.currency_code.message}
                </p>
              )}
            </div>
            <Button disabled={currencyMutation.isPending} type="submit">
              {currencyMutation.isPending && (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              )}
              Set currency
            </Button>
            {currencyMutation.isError && (
              <div className="sm:basis-full">
                <ErrorMessage>
                  {currencyMutation.error instanceof ApiError
                    ? currencyMutation.error.message
                    : "The currency could not be saved."}
                </ErrorMessage>
              </div>
            )}
          </form>
        ) : (
          <p className="rounded-md border border-caution/40 bg-surface/70 px-4 py-3 text-sm text-foreground-body">
            Ask an owner to choose the accounting currency for this company.
          </p>
        )}
      </div>
    </Card>
  );
}
