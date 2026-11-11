import { z } from "zod";

const money = z.string();
const count = z.number().int().nonnegative();
const cashFlow = z.object({
  inflows: money,
  outflows: money,
  net_cash_flow: money,
  transaction_count: count,
});

export const weeklyDigestFactsSchema = z.object({
  period: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  current_week: cashFlow,
  previous_week: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ...cashFlow.shape,
  }),
  top_expense_categories: z.object({
    items: z.array(z.object({ category_name: z.string(), outflows: money, transaction_count: count })),
    truncated: z.boolean(),
  }),
  month_to_date_budget: z.object({
    period: z.string().regex(/^\d{4}-\d{2}$/),
    through_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    total_budgeted: money,
    total_actual: money,
    total_remaining: money,
    over_budget_count: count,
    items: z.array(z.object({
      category_name: z.string(),
      category_kind: z.enum(["income", "expense"]),
      budgeted_amount: money,
      actual_amount: money,
      remaining_amount: money,
      transaction_count: count,
      over_budget: z.boolean(),
    })),
    items_truncated: z.boolean(),
  }),
  signals: z.object({
    activity: z.enum(["no_transactions", "transactions_recorded"]),
    net_cash_flow: z.enum(["positive", "negative", "balanced"]),
    inflows_trend: z.enum(["started", "no_previous_activity", "increased", "decreased", "unchanged"]),
    outflows_trend: z.enum(["started", "no_previous_activity", "increased", "decreased", "unchanged"]),
    month_to_date_budget: z.enum(["no_budgets", "over_budget", "within_budget"]),
  }),
});

export type WeeklyDigestFacts = z.infer<typeof weeklyDigestFactsSchema>;
