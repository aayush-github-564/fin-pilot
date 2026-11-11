import { z } from "zod";

const money = z.string();
const count = z.number().int().nonnegative();

export const cashFlowFactsSchema = z.object({
  inflows: money,
  outflows: money,
  net_cash_flow: money,
  transaction_count: count,
});

export const expensesByCategoryFactsSchema = z.object({
  items: z.array(z.object({
    category_id: z.string().uuid(),
    category_name: z.string(),
    amount: money,
    transaction_count: count,
  })),
  has_more: z.boolean(),
});

export const largestExpensesFactsSchema = z.object({
  items: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().nullable(),
    amount: money,
    category_name: z.string().nullable(),
  })),
  has_more: z.boolean(),
});

export const budgetVsActualFactsSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  total_budgeted: money,
  total_actual: money,
  total_remaining: money,
  items: z.array(z.object({
    category_name: z.string(),
    category_kind: z.enum(["income", "expense"]),
    budgeted_amount: money,
    actual_amount: money,
    remaining_amount: money,
    transaction_count: count,
    over_budget: z.boolean(),
  })),
  has_more: z.boolean(),
});
