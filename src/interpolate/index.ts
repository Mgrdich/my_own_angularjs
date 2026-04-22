export { createInterpolate } from './interpolate';
export { $InterpolateProvider } from './interpolate-provider';
export type { InterpolateFn, InterpolateOptions, InterpolateService } from './interpolate-types';

import { createInterpolate } from './interpolate';

/**
 * Pre-configured interpolation service using the default delimiters `{{` / `}}`.
 * Equivalent to `createInterpolate()`; use this when you don't need custom symbols.
 */
export const interpolate = createInterpolate();
