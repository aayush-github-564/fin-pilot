export type DecimalValue = string | number;

function formatWithTrueMinus(formatter: Intl.NumberFormat, value: number): string {
  return formatter
    .formatToParts(value)
    .map((part) => part.type === "minusSign" ? "−" : part.value)
    .join("");
}

export function formatFigureText(value: string): string {
  return value.startsWith("-") ? `−${value.slice(1)}` : value;
}

export function formatMoney(
  value: DecimalValue,
  currencyCode: string | null,
): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";

  const numberFormat = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!currencyCode) return formatWithTrueMinus(numberFormat, amount);

  try {
    return formatWithTrueMinus(new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }), amount);
  } catch {
    return `${currencyCode} ${formatWithTrueMinus(numberFormat, amount)}`;
  }
}

export function formatRunwayMonths(value: DecimalValue): string {
  const months = Number(value);
  if (!Number.isFinite(months)) return "—";
  return formatWithTrueMinus(new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }), months);
}

export function formatCompactMoney(value: number, currencyCode: string | null): string {
  const options: Intl.NumberFormatOptions = {
    notation: "compact",
    maximumFractionDigits: 1,
  };
  if (currencyCode) {
    try {
      return formatWithTrueMinus(new Intl.NumberFormat(undefined, {
        ...options,
        style: "currency",
        currency: currencyCode,
      }), value);
    } catch {
      // A historic code may no longer be supported by this browser's Intl data.
    }
  }
  return formatWithTrueMinus(new Intl.NumberFormat(undefined, options), value);
}
