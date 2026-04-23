/**
 * Shared delimiter validation used by both `createInterpolate` (the ES-module
 * factory path) and `$InterpolateProvider` (the DI config-phase path). Both
 * paths must reject the same malformed symbol pairs — keeping the rules in
 * one place avoids divergence between the two surfaces.
 *
 * The rules match AngularJS parity:
 * - An empty `startSymbol` or `endSymbol` is rejected with a descriptive error.
 * - Identical `startSymbol` / `endSymbol` is rejected — the scanner could not
 *   distinguish the two otherwise.
 *
 * The errors are thrown synchronously at the call site so misconfiguration
 * surfaces during module load / config block execution rather than at first
 * template render.
 */

export const DEFAULT_START_SYMBOL = '{{';
export const DEFAULT_END_SYMBOL = '}}';

export function validateDelimiters(startSymbol: string, endSymbol: string): void {
  if (startSymbol === '') {
    throw new Error("Invalid interpolation symbols: startSymbol cannot be an empty string (received '')");
  }
  if (endSymbol === '') {
    throw new Error("Invalid interpolation symbols: endSymbol cannot be an empty string (received '')");
  }
  if (startSymbol === endSymbol) {
    throw new Error(
      `Invalid interpolation symbols: startSymbol and endSymbol must differ (both set to '${startSymbol}')`,
    );
  }
}
