// The one place a dollar amount becomes text (#447). Before this module the
// web UI formatted money three ways in three places — the header meter, the
// inbox/decide cards, and the metrics page — so the same $18.50 ceiling
// could read as `$18.50`, `$18.50`, or `$18.5` depending which component
// printed it. Every site that prints a dollar figure calls `usd` instead of
// its own `toFixed` or template literal.

/**
 * A dollar figure as the budget meter prints one: whole dollars stay whole
 * (`$10`), anything else keeps two decimals (`$18.50`, `$0.37`).
 *
 * `exact: true` keeps two decimals even on a whole number — for a tooltip
 * that states an amount against its ceiling (`$0.00 of $18.50`), where the
 * two zeroes are themselves part of the fact being shown, not noise to
 * round away.
 *
 * Rounds to the cent before asking whether the amount is whole. A float sum
 * like `6.4 + 3.6` lands on `10.000000000000002`, not `10` — checking
 * `Number.isInteger` against that raw value would print `$10.00` beside a
 * limit that prints `$10`, the exact mismatch this module exists to remove.
 */
export function usd(n: number, opts?: { exact?: boolean }): string {
  if (opts?.exact) return `$${n.toFixed(2)}`
  const cents = Math.round(n * 100)
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`
}
