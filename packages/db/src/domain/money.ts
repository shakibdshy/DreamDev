/**
 * Money in this domain is integer taka (GLOSSARY.md). Formatting follows
 * Bangladeshi grouping (lakh/crore) with the ৳ symbol.
 */
const grouped = new Intl.NumberFormat("en-IN");

export function formatTaka(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}৳${grouped.format(Math.abs(Math.trunc(amount)))}`;
}
