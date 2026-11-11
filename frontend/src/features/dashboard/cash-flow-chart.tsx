import { format, parseISO } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CashFlowMetrics } from "../metrics/api";
import { formatCompactMoney, formatMoney } from "../../lib/money";

function EndpointDot({
  cx = 0,
  cy = 0,
  fill = "currentColor",
}: {
  cx?: number | undefined;
  cy?: number | undefined;
  fill?: string;
}) {
  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} fill={fill} opacity={0.22} r={12} />
      <circle cx={cx} cy={cy} fill={fill} r={6} />
    </g>
  );
}

export function CashFlowChart({
  metrics,
  currencyCode,
}: {
  metrics: CashFlowMetrics;
  currencyCode: string | null;
}) {
  if (metrics.transaction_count === 0) {
    return (
      <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-border bg-surface-raised px-5 text-center">
        <div>
          <p className="font-semibold text-foreground-body">No cash movement in this range</p>
          <p className="mt-1 text-sm text-muted">
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
        Cash-flow chart. Lines show inflows and outflows returned by the metrics service.
      </figcaption>
      <ResponsiveContainer height="100%" minWidth={0} width="100%">
        <AreaChart
          accessibilityLayer
          className="fp-cash-flow-chart"
          data={chartData}
          margin={{ top: 12, right: 8, left: 4, bottom: 4 }}
        >
          <CartesianGrid stroke="var(--fp-card-line)" strokeWidth={1} vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="period_start"
            tickFormatter={(value: string) => formatPeriod(value, metrics.granularity)}
            tickLine={false}
            tickMargin={10}
            tick={{ fill: "var(--fp-stone)", fontFamily: "var(--fp-font-mono)", fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickFormatter={(value: number) => formatCompactMoney(value, currencyCode)}
            tickLine={false}
            tick={{ fill: "var(--fp-stone)", fontFamily: "var(--fp-font-mono)", fontSize: 12, textAnchor: "end" }}
            width={72}
          />
          <Tooltip
            formatter={(value, name) => [
              formatMoney(value as number, currencyCode),
              name === "inflows" ? "Inflows" : "Outflows",
            ]}
            labelFormatter={(value) => formatPeriod(String(value), metrics.granularity, true)}
            contentStyle={{
              backgroundColor: "var(--fp-card)",
              borderRadius: "var(--fp-radius-md)",
              borderColor: "var(--fp-card-line)",
              boxShadow: "none",
              color: "var(--fp-pine)",
              fontFamily: "var(--fp-font-mono)",
              fontVariantNumeric: "tabular-nums",
              textAlign: "right",
            }}
          />
          <Legend
            formatter={(value) => (value === "inflows" ? "Inflows" : "Outflows")}
            wrapperStyle={{ color: "var(--fp-stone)", fontFamily: "var(--fp-font-ui)", fontSize: 12 }}
          />
          <Area
            dataKey="inflows"
            fill="var(--fp-signal-deep)"
            fillOpacity={0.09}
            stroke="var(--fp-signal-deep)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            type="linear"
            dot={(props) =>
              props.index === chartData.length - 1 ? (
                <EndpointDot cx={props.cx} cy={props.cy} fill="var(--fp-signal-deep)" />
              ) : false
            }
          />
          <Area
            dataKey="outflows"
            fill="var(--fp-clay)"
            fillOpacity={0}
            stroke="var(--fp-clay)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            type="linear"
            dot={(props) =>
              props.index === chartData.length - 1 ? (
                <EndpointDot cx={props.cx} cy={props.cy} fill="var(--fp-clay)" />
              ) : false
            }
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}

function formatPeriod(value: string, granularity: "day" | "month", long = false): string {
  const date = parseISO(value);
  if (granularity === "month") return format(date, long ? "MMMM yyyy" : "MMM yy");
  return format(date, long ? "MMMM d, yyyy" : "MMM d");
}
