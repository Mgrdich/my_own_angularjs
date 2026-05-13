# Functional Specification: Controllers and the `$controller` Service

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Directives & DOM Compilation (Controllers `$controller`)
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Today, a developer using my-own-angularjs can define scopes, parse expressions, render templates, and write directives — but there is no canonical home for the JavaScript that powers a region of a page. A directive that needs behavior must either inline it inside a link function or attach loose helpers directly to the scope; both approaches blur boundaries and scale poorly as views grow.

This specification adds **controllers**, the AngularJS-canonical answer to *"where does the per-view JavaScript live?"* A controller is an ordinary function (typically used as a constructor) that receives an injected scope — and any other services it asks for — and exposes the properties and methods that a template consumes. The new `$controller` service instantiates them on demand; the new `$controllerProvider` lets developers register them by name during the application's configuration phase.

Together, this lets directive authors (and, eventually, `ng-controller` users) do four concrete things they cannot do today:

1. Register a controller once by name and reuse it from many places by that name.
2. Have controllers instantiated with the right dependencies wired in automatically.
3. Expose a controller instance to its template under a chosen alias (`controller as vm`) instead of writing properties directly onto the scope.
4. Attach a controller to a directive so that each match of the directive on the page gets its own controller instance, running before the directive's link phase.

**Success looks like**: a developer can write

```js
module.config(['$controllerProvider', $cp =>
  $cp.register('Greeter', ['$scope', function ($scope) {
    $scope.greeting = 'hi';
  }]),
]);
```

…then ask the framework for a `Greeter` instance and receive one with the scope already wired; or attach `controller: 'Greeter'` to a directive and observe that controller running once per matched element, before any pre-link or post-link code on that element.

---

## 2. Functional Requirements (The "What")

### 2.1 Controller registration

- **As a developer**, I want to register a named controller during the configuration phase so I can refer to it by name later.
  - **Acceptance Criteria:**
    - [ ] Calling `$controllerProvider.register('MyCtrl', function () {})` inside a `config(...)` block succeeds.
    - [ ] Calling `$controllerProvider.register('MyCtrl', ['$scope', function ($scope) {}])` accepts the array-style annotation.
    - [ ] Calling `$controllerProvider.register({ FooCtrl: fnA, BarCtrl: fnB })` registers both controllers in a single call.
    - [ ] Calling `$controllerProvider.register(...)` after the configuration phase has ended throws a clear, human-readable error explaining that controller registration is configuration-phase-only — mirroring the `$provide` family's wording.
    - [ ] Registering two controllers under the same name keeps only the most recently registered one (last-wins, matching how services / filters behave).

- **As a developer**, I want to ask whether a controller name is registered.
  - **Acceptance Criteria:**
    - [ ] `$controllerProvider.has('MyCtrl')` returns `true` after registration and `false` otherwise.

### 2.2 Controller instantiation

- **As a developer**, I want to ask the framework to instantiate a registered controller by name and receive a fully wired instance.
  - **Acceptance Criteria:**
    - [ ] `$controller('MyCtrl', { $scope: someScope })` returns a new instance produced by invoking the registered constructor with the scope plus any other declared dependencies.
    - [ ] Each call to `$controller('MyCtrl', ...)` returns a distinct, independent instance.
    - [ ] Asking for an unregistered name throws a clear, human-readable error that names the missing controller.

- **As a developer**, I want to pass an inline function in place of a name when I have no need for a registration step.
  - **Acceptance Criteria:**
    - [ ] `$controller(function ($scope) {}, { $scope: someScope })` returns an instance produced from that function.
    - [ ] `$controller(['$scope', function ($scope) {}], { $scope: someScope })` accepts the array-style annotation.

- **As a developer**, I want services my controller declares to be injected from the framework, and the values I pass as locals to override matching service names.
  - **Acceptance Criteria:**
    - [ ] A controller that lists `'$scope'` and another registered service receives both — the scope from the locals I supplied and the service from the framework's registry.
    - [ ] If a local has the same name as a registered service, the local value wins inside that controller's constructor.

### 2.3 "Controller as alias" syntax

- **As a developer**, I want to expose the controller instance on its scope under a chosen alias so templates can read `vm.greeting` instead of polluting the scope with bare names.
  - **Acceptance Criteria:**
    - [ ] `$controller('MyCtrl as vm', { $scope: someScope })` assigns the new instance to `someScope.vm` and returns the same instance.
    - [ ] If no `$scope` is supplied in locals, the alias is silently ignored (no error), and the instance is still returned.
    - [ ] A malformed alias suffix (empty alias, missing identifier after `as`, or an alias that is not a valid identifier) throws a clear, human-readable error explaining the expected `Name as alias` format.
    - [ ] The alias suffix works equally with a registered name (`'MyCtrl as vm'`) and is supported via the directive's `controllerAs` field for inline-function controllers.

### 2.4 Directive integration

- **As a directive author**, I want my directive's definition to declare a controller and have the framework instantiate that controller once per matched element, so I can put the directive's behavior in a dedicated place.
  - **Acceptance Criteria:**
    - [ ] A directive whose definition includes `controller: 'MyCtrl'` causes `$controller('MyCtrl', ...)` to run once for every element the directive matches.
    - [ ] A directive whose definition includes `controller: function ($scope, $element, $attrs) {}` receives those three values from the matched element's compile context.
    - [ ] The controller for an element runs **before** any pre-link function on that element, and therefore before any post-link function.
    - [ ] A directive whose definition includes both `controller` and `controllerAs: 'vm'` exposes the new instance on the controller's scope under the alias `vm`.
    - [ ] If two directives on the same element both declare a `controller`, each runs independently against the same compile context (`$scope`, `$element`, `$attrs`); the controllers do not see one another in this slice.
    - [ ] A directive declaring `controllerAs` without a `controller` is treated as an error with a clear, human-readable message.

### 2.5 Lifecycle and error guarantees

- **As a developer**, I want predictable, framework-consistent error messages when I misuse the registration or lookup APIs.
  - **Acceptance Criteria:**
    - [ ] `$controllerProvider.register` is reachable only during the configuration phase, mirroring the `$provide` family.
    - [ ] `$controller` is reachable only during the run phase, after the injector finishes configuration.
    - [ ] An unregistered-controller lookup, a malformed alias, and a `controllerAs`-without-`controller` directive each produce distinct, human-readable error messages.
    - [ ] An exception thrown inside a controller's constructor when invoked **through the compiler** is routed through `$exceptionHandler` and the surrounding compile / link pass continues, consistent with how the compiler handles other directive-author errors today.
    - [ ] An exception thrown inside a controller's constructor when invoked **directly** via `$controller(...)` propagates to the caller (no `$exceptionHandler` interception).

---

## 3. Scope and Boundaries

### In-Scope

- The `$controller` service: lookup by registered name **and** invocation against an inline constructor function (or array-annotated form).
- The `$controllerProvider` configuration-phase API: `register(name, fn)`, `register({ ... })`, `has(name)`.
- Dependency injection of services and locals into controllers, with locals winning on name collision.
- The `'Name as alias'` string-suffix syntax on controller names, plus alias support via the directive `controllerAs` field.
- Directive integration: the `controller` and `controllerAs` fields on a directive definition object are honored by `$compile`; the controller instance is created once per matched element and runs before that element's pre-link.

### Out-of-Scope

- The `ng-controller` built-in directive — lands separately under the "Built-in Directives" roadmap item.
- The `.controller(name, fn)` shortcut on `createModule(...)` — lands separately under the "Module DSL `.directive` / `.component` / `.controller`" roadmap item.
- Inter-directive controller wiring via the `require:` field (a directive asking for another directive's controller, including the `^` / `?` / `^^` flag combinations).
- Lifecycle hooks on controllers (`$onInit`, `$onChanges`, `$onDestroy`, `$postLink`).
- The `bindToController` directive field — depends on isolate scope, which is rejected at registration today.
- Global controller lookup (`window.MyCtrl`) and the `$controllerProvider.allowGlobals()` opt-in — deliberately and permanently out, on security and modernization grounds.
- The internal deferred-instantiation `later` flag historically used by `$compile` to support `require:` — only needed once `require:` ships.
- All other roadmap items in Phase 2 and beyond (built-in directives, application bootstrap, `$q`, `$http`, forms, routing, animations, the `angular.*` compatibility layer).
