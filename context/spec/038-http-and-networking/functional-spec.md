# Functional Specification: HTTP & Networking (`$http`)

- **Roadmap Item:** HTTP & Networking — `$http` service, interceptors, request/response transformations
- **Status:** Completed
- **Author:** AWOS spec workflow

---

## 1. Overview and Rationale (The "Why")

A developer building a real application on this framework has no built-in way to talk to a backend. They can reach for the browser's native networking, but it sits *outside* the framework: a response that arrives and changes the data does **not** refresh the on-screen content on its own, there is no shared place to set common request settings (a base set of headers, an auth token, a default way to turn objects into query strings), and there is no single point to observe or adjust every request and response the application makes.

This change delivers one consistent networking service so a developer can:

- **Make a request and get a result they can react to** — the result is a promise (the same promise toolkit shipped previously), so when the response arrives the bound content updates automatically, with no manual refresh.
- **Use short, familiar method calls** for the common verbs, or a single general form for full control.
- **Set application-wide defaults once** — common headers, a default way to serialize query parameters, JSON handling — instead of repeating them at every call site.
- **Observe and adjust every request and response in one place** — interceptors that can read, change, retry, or short-circuit traffic (for example, attaching an auth token to every outgoing request, or redirecting to a login flow when the server reports "unauthorized").
- **Cancel work that is no longer needed** — abort a request manually or after a time limit.
- **Get common safety and convenience behavior for free** — automatic JSON handling, cross-site-request-forgery protection, optional response caching, and visibility into requests still in flight.

Behavior is validated against original AngularJS wherever the two overlap — this targets parity with `$http`, `$httpProvider` defaults, and the interceptor pipeline. A small number of intentional deviations (Section 3) are called out explicitly so they can be tested as deliberate.

**Desired outcome:** making a backend call is a one-liner that returns a typed, digest-aware result; cross-cutting concerns (auth, error handling, headers) live in one place; and common conveniences (JSON, CSRF, caching) work without ceremony.

**Success measure:** a developer can perform the common request types, set sensible application-wide defaults, intercept all traffic in one place, cancel requests, and rely on automatic JSON + CSRF handling — all without reading the framework source, and with response data that refreshes bound content the moment it arrives.

---

## 2. Functional Requirements (The "What")

> Throughout, "**update cycle**" means the framework's existing data-refresh pass; "**result**" means the promise returned by a request; a result **succeeds** or **fails** as defined in the previously-shipped promise toolkit.

### 2.1 Make a request and receive a digest-aware result

- A developer can issue a request by describing it (at minimum, where to send it and which action to perform) and receives back a **result** they can attach success and failure follow-ups to.
- On a **successful** response, the result delivers a single bundle containing: the **response body**, the numeric **status**, a **status description**, the **response headers**, and the **request description** that produced it.
- When the result settles, the framework runs an **update cycle on its own**, so content bound to the response data refreshes without any further developer action.
- **Acceptance Criteria:**
  - [x] Given a developer describes a request, when they issue it, then they receive a result they can attach success/failure follow-ups to.
  - [x] On a successful response, the success follow-up receives a bundle with the body, status, status description, headers, and the originating request description.
  - [x] When a response arrives, content bound to the response data refreshes without any further developer action.
  - [x] The response headers are retrievable by name from the delivered bundle, case-insensitively.

### 2.2 Short method calls for the common verbs

- A developer can use concise per-action calls for the everyday verbs — fetch, create, replace, remove, partially-update, headers-only — and a dedicated call for the legacy cross-origin-script approach. A single general form remains available for full control.
- The "send a body" actions accept the body to send; the "no body" actions accept just the destination and options.
- **Acceptance Criteria:**
  - [x] Each of the common actions can be issued through its own concise call (fetch / create / replace / remove / partially-update / headers-only) and through the general form, producing equivalent results.
  - [x] The body-carrying actions accept a body; the bodyless actions do not require one.
  - [x] The legacy cross-origin-script action is available and only proceeds when its destination is explicitly trusted (see 2.12); an untrusted destination is refused.

### 2.3 Describe a request with options

- A developer can describe a request with a set of options, including: the destination, the action, a body to send, query parameters (provided as a structured set of name/value pairs), per-request headers, a response-body interpretation hint, whether to include credentials on cross-origin calls, a time limit or cancellation signal, and a caching choice.
- **Acceptance Criteria:**
  - [x] A request can carry query parameters supplied as a structured set, a body, and per-request headers, and all three reach the outgoing request.
  - [x] A request can specify how the response body should be interpreted and whether credentials are included on cross-origin calls.
  - [x] Unspecified options fall back to the application-wide defaults (2.4).

### 2.4 Application-wide and per-action defaults

- A developer can set, once, defaults that apply to every request: common headers (including headers that apply only to body-carrying actions), the default query-parameter serialization, and the default JSON handling.
- Per-request options always override the application-wide defaults for that one request.
- **Acceptance Criteria:**
  - [x] A header set as an application-wide default is present on requests that don't override it.
  - [x] A header set only for body-carrying actions appears on those actions and not on bodyless ones.
  - [x] A per-request option overrides the matching application-wide default for that request only, leaving the default intact for others.

### 2.5 Query-parameter serialization

- The structured set of query parameters a developer provides is turned into a proper query string automatically, with correct escaping. Nested or repeated values follow a consistent, documented rule.
- A developer can replace the default serialization strategy with their own, both application-wide and per request.
- **Acceptance Criteria:**
  - [x] A structured set of parameters is converted into a correctly-escaped query string on the outgoing request.
  - [x] Repeated/array and structured values are serialized by a consistent, documented rule.
  - [x] A developer-supplied serialization strategy replaces the default when configured.

### 2.6 Automatic JSON handling

- By default, a structured (object/array) request body is automatically converted to JSON text and labeled as JSON, and a JSON response body is automatically parsed into structured data before it reaches the success follow-up.
- Sending a plain string body, or other non-structured content, is passed through unchanged.
- A developer can adjust or replace this automatic conversion (see 2.9).
- **Acceptance Criteria:**
  - [x] A structured request body is sent as JSON text with the appropriate content label, by default.
  - [x] A JSON response body is delivered to the success follow-up as already-parsed structured data, by default.
  - [x] A plain-string body is sent as-is without JSON conversion.
  - [x] A response that is not JSON is delivered without forced parsing.

### 2.7 Success and failure outcomes

- A response the server reports as **successful** settles the result as a success; a response the server reports as a **failure**, or a request that never reaches the server (network failure), settles the result as a failure. The failure bundle carries the same shape as the success bundle (body, status, status description, headers, request description) so a developer can inspect what happened.
- **Acceptance Criteria:**
  - [x] A server-reported success settles the result as a success with the full bundle.
  - [x] A server-reported failure settles the result as a failure with the full bundle (including the error body and status).
  - [x] A request that never reaches the server settles the result as a failure that is distinguishable from a server-reported failure.

### 2.8 Cancellation and time limits

- A developer can cancel an in-flight request, either by triggering a cancellation signal they supplied with the request, or by setting a time limit after which the request is abandoned automatically. A cancelled or timed-out request settles the result as a failure and stops the underlying work.
- **Acceptance Criteria:**
  - [x] Given a request was issued with a cancellation signal, when the developer triggers it, then the request is abandoned and the result fails.
  - [x] Given a request was issued with a time limit, when the limit elapses before a response, then the request is abandoned and the result fails.
  - [x] A response that already arrived is unaffected by a later cancellation attempt.

### 2.9 Adjust the request and response payloads (transforms)

- A developer can supply their own steps that adjust the outgoing body (and headers) before sending, and steps that adjust the incoming body after receiving — both application-wide and per request. These run in addition to, or in place of, the automatic JSON handling.
- **Acceptance Criteria:**
  - [x] A developer-supplied outgoing-body adjustment is applied before the request is sent.
  - [x] A developer-supplied incoming-body adjustment is applied before the success follow-up receives the data.
  - [x] These adjustments can be set application-wide and overridden per request.

### 2.10 Intercept all requests and responses in one place

- A developer can register **interceptors** that see every request before it is sent and every response (or failure) before it reaches the calling code. An interceptor can: read and modify the request; read and modify the response; handle or transform a failure (including recovering from it); short-circuit (e.g. serve a canned response); or trigger a side effect (e.g. redirect on "unauthorized").
- Multiple interceptors apply in a well-defined, documented order; request-side steps run outward-to-inward and response-side steps inner-to-outer (mirroring AngularJS).
- Interceptor steps may themselves be asynchronous (return a pending result), and the pipeline waits for them.
- **Acceptance Criteria:**
  - [x] A registered request interceptor sees and can modify every outgoing request before it is sent.
  - [x] A registered response interceptor sees and can modify every incoming response before the caller's success follow-up runs.
  - [x] A failure interceptor can observe a failure and either let it continue to fail or recover it into a success.
  - [x] With multiple interceptors registered, they apply in the documented order, and an asynchronous interceptor step is awaited before the pipeline continues.

### 2.11 Automatic cross-site-request-forgery (CSRF) protection

- For same-origin requests that change data, the service automatically reads a per-session anti-forgery token (left by the server) and echoes it back on the request, so the server can confirm the request is genuine. The token names are configurable, and the token is **not** sent to other origins.
- **Acceptance Criteria:**
  - [x] On a same-origin data-changing request, the anti-forgery token left by the server is automatically echoed back on the request.
  - [x] The token is not sent on cross-origin requests.
  - [x] The token's source and echo names are configurable application-wide.

### 2.12 Trusted-destination enforcement for the legacy cross-origin-script action

- The legacy cross-origin-script action only proceeds when its destination has been explicitly marked as trusted through the existing security mechanism; an untrusted destination is refused before any network activity.
- **Acceptance Criteria:**
  - [x] The legacy cross-origin-script action succeeds only for a destination explicitly trusted via the existing security mechanism.
  - [x] An untrusted destination is refused with a clear error and no network activity occurs.

### 2.13 Optional response caching

- A developer can opt a request into caching, so that a repeat of the same retrieval is served from an in-memory store instead of hitting the network. Caching is **off by default** and opt-in per request (or via an application-wide default cache). Concurrent identical retrievals while one is in flight share the single outstanding call.
- **Acceptance Criteria:**
  - [x] Given caching is enabled for a retrieval, when the same retrieval is issued again, then the result is served from the cache without a new network call.
  - [x] Caching is off unless explicitly enabled for that request (or via a configured default cache).
  - [x] Two identical cacheable retrievals issued before the first completes share a single outstanding network call.

### 2.14 Visibility into in-flight requests

- A developer can observe the set of requests currently in flight (for example, to show a busy indicator or to assert quiescence in a test).
- **Acceptance Criteria:**
  - [x] While a request is in flight, it appears in the observable set of pending requests; once it settles, it is removed.

### 2.15 Typed results

- The result and its delivered bundle are typed against the expected response body, so a developer reading the body gets a correctly typed value without manual type assertions; the request-description and configuration options are likewise typed.
- **Acceptance Criteria:**
  - [x] Reading the response body from a successful result yields a value of the expected type, with no manual type assertion required.
  - [x] The request-configuration options are typed so that misspelled or mistyped options are flagged.

---

## 3. Intentional additions and parity deviations

These differences from classic AngularJS are deliberate and should be treated as expected behavior (tested as intentional, not as parity bugs):

- **No `.success()` / `.error()` shorthands.** Classic AngularJS once offered promise-specific `.success`/`.error` callbacks (removed in its own later versions). This project ships only the standard success/failure follow-ups on the result — the modern, type-safe shape.
- **The legacy cross-origin-script action is hard-gated by the trusted-destination mechanism** (no opt-out), reflecting this project's security posture.
- **Acceptance Criteria:**
  - [x] Each deviation above is observable and behaves as described, and is covered by a test that marks it as intentional rather than a parity gap.

---

## 4. Scope and Boundaries

### In-Scope

- The single networking service with the general form and the concise per-action calls (fetch / create / replace / remove / partially-update / headers-only / legacy cross-origin-script).
- Request description options (destination, action, body, structured query parameters, headers, response-interpretation hint, credentials, time limit / cancellation, caching choice).
- Application-wide and per-action defaults; per-request override.
- Query-parameter serialization (default + replaceable).
- Automatic JSON handling (request + response), and developer-supplied payload adjustments.
- Digest-aware success/failure results; failure for server-reported errors and network failures.
- Cancellation and time limits.
- The interceptor pipeline (request / response / failure, ordered, asynchronous).
- Automatic CSRF protection with configurable names.
- Trusted-destination enforcement for the legacy cross-origin-script action.
- Opt-in response caching with shared in-flight retrievals.
- Visibility into in-flight requests.
- Typed results and configuration.
- The packaged area / registration so the service is retrievable as a standard framework service.

### Out-of-Scope

- **Higher-level data layers** (resource/ORM-style wrappers over the networking service) — not part of this item.
- **Forms & Validation, Routing, Animations** — separate roadmap items.
- **WebSockets / server-sent events / streaming bodies** — this item covers request/response networking only.
- Any global namespace object or classic-namespace surface — that is the separate Compatibility Layer phase.
- The following separate roadmap items, automatically out-of-scope: **Forms & Validation**, **Routing**, **Animations**, **Package & Distribution**, and the **AngularJS Compatibility Layer**.
