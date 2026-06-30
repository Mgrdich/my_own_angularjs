/**
 * Public barrel for the `@http` module — the networking service (`$http`,
 * `$httpBackend`, `$HttpProvider`; spec 038 Slice 2).
 *
 * Exposes the pure {@link createHttp} / {@link createHttpBackend} factories,
 * the config-phase {@link $HttpProvider}, the transport-error sentinel, and
 * the public types. The DI registration lives on `ngModule`
 * (`src/core/ng-module.ts`), not here — mirroring the `@async` / `@cache`
 * precedent where a service ships a pure factory AND a separate `ngModule`
 * registration.
 */

export { createHttp } from './http';
export type { CreateHttpArgs } from './http';
export {
  createHttpBackend,
  HttpTransportError,
  isHttpTransportError,
  JSONP_CALLBACK_PLACEHOLDER,
} from './http-backend';
export type { CreateHttpBackendArgs, FetchFn, JsonpDocument, JsonpGlobal } from './http-backend';
export { mergeHeaders, parseHeaders } from './http-headers';
export { buildUrl, paramSerializer, paramSerializerJQLike } from './http-params';
export {
  applyRequestTransforms,
  applyResponseTransforms,
  defaultTransformRequest,
  defaultTransformResponse,
  resolveTransforms,
} from './http-transforms';
export {
  applyXsrfHeader,
  defaultCookieReader,
  DEFAULT_XSRF_COOKIE_NAME,
  DEFAULT_XSRF_HEADER_NAME,
  readCookieValue,
  resolveBaseUrl,
} from './http-xsrf';
export type { ApplyXsrfHeaderArgs, CookieReader } from './http-xsrf';
export { $HttpProvider } from './http-provider';
export type { InterceptorRegistration } from './http-provider';
export type {
  HttpBackend,
  HttpBackendOptions,
  HttpConfig,
  HttpDefaults,
  HttpHeaders,
  HttpHeadersGetter,
  HttpResponse,
  HttpService,
  HttpTransportErrorKind,
  ParamSerializer,
  RawResponse,
  RequestTransform,
  ResponseTransform,
} from './http-types';
