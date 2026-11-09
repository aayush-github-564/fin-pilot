import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CashFlowMetrics } from "../metrics/api";
import { formatCompactMoney, formatMoney } from "../../lib/money";

export function CashFlowChart({
  metrics,
  currencyCode,
}: {
  metrics: CashFlowMetrics;
  currencyCode: string | null;
}) {
  if (metrics.transaction_count === 0) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center">
        <div>
          <p className="font-semibold text-slate-800">No cash movement in this range</p>
          <p className="mt-1 text-sm text-slate-600">
            The chart will fill in as company transactions are recorded.
          </p>
        </div>
      </div>
    );
  }

  const chartData = metrics.buckets.map((bucket) => ({
    period_start: bucket.period_start,
    inflows: Number(bucket.inflows),
    outflows: Number(bucket.outflows),
  }));

  return (
    <figure className="h-72 w-full min-w-0" aria-labelledby="cash-flow-chart-caption">
      <figcaption className="sr-only" id="cash-flow-chart-caption">
        Cash-flow chart. Bars show inflows and outflows returned by the metrics service.
      </figcaption>
      <ResponsiveContainer height="100%" minWidth={0} width="100%">
        <BarChart
          accessibilityLayer
          data={chartData}
          margin={{ top: 12, right: 8, left: 4, bottom: 4 }}
        >
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="period_start"
            tickFormatter={(value: string) => formatPeriod(value, metrics.granularity)}
            tickLine={false}
            tickMargin={10}
            tick={{ fill: "#64748b", fontSize: 11 }}
          />
          <YAxis
            axisLine={false}
            tickFormatter={(value: number) => formatCompactMoney(value, currencyCode)}
            tickLine={false}
            tick={{ fill: "#64748b", fontSize: 11 }}
            width={72}
          />
          <Tooltip
            formatter={(value, name) => [
              formatMoney(value as number, currencyCode),
              name === "inflows" ? "Inflows" : "Outflows",
            ]}
            labelFormatter={(value) => formatPeriod(String(value), metrics.granularity, true)}
            contentStyle={{ borderRadius: "0.75rem", borderColor: "#e2e8f0" }}
          />
          <Legend formatter={(value) => (value === "inflows" ? "Inflows" : "Outflows")} />
          <Bar dataKey="inflows" fill="#0e7490" maxBarSize={28} radius={[5, 5, 0, 0]} />
          <Bar dataKey="outflows" fill="#f59e0b" maxBarSize={28} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

function formatPeriod(value: string, granularity: "day" | "month", long = false): string {
  const date = parseISO(value);
  if (granularity === "month") return format(date, long ? "MMMM yyyy" : "MMM yy");
  return format(date, long ? "MMMM d, yyyy" : "MMM d");
}
