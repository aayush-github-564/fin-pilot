export type DecimalValue = string | number;

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
  if (!currencyCode) return numberFormat.format(amount);

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${numberFormat.format(amount)}`;
  }
}

export function formatRunwayMonths(value: DecimalValue): string {
  const months = Number(value);
  if (!Number.isFinite(months)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(months);
}

export function formatCompactMoney(value: number, currencyCode: string | null): string {
  const options: Intl.NumberFormatOptions = {
    notation: "compact",
    maximumFractionDigits: 1,
  };
  if (currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        ...options,
        style: "currency",
        currency: currencyCode,
      }).format(value);
    } catch {
      // A historic code may no longer be supported by this browser's Intl data.
    }
  }
  return new Intl.NumberFormat(undefined, options).format(value);
}
