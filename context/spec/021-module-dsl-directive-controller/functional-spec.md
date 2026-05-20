# Functional Specification: Module DSL — `.directive` and `.controller`

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Directives & DOM Compilation (Module DSL `.directive` / `.component` / `.controller` — `.component` carved out to a later spec)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Today, a developer using my-own-angularjs registers a directive or a controller by opening a configuration block and reaching for the relevant provider:

```js
createModule('app', ['ng']).config(['$compileProvider', $cp =>
  $cp.directive('myWidget', myWidgetFactory),
]);
```

Yet the same module builder already offers one-line shortcuts for every other registration kind — `.factory`, `.value`, `.constant`, `.service`, `.provider`, `.decorator`, and `.filter`. Directives and controllers are the conspicuous gap. A developer coming from classic AngularJS expects `module.directive(...)` and `module.controller(...)` to exist and to behave identically to the provider-based path.

This specification closes that gap by adding two registration shortcuts to the module builder:

- `.directive(name, factory)` — a shortcut for registering a directive.
- `.controller(name, factory)` — a shortcut for registering a controller.

Both also accept a bulk object form for registering several at once. Both are pure sugar: they write into the very same registries the providers use, so a directive or controller registered through the shortcut is indistinguishable from one registered through a configuration block.

The `.component` shortcut named in the roadmap is deliberately deferred — it depends on isolate scope, controller bindings, and component lifecycle hooks, none of which exist yet. It will land in its own specification once those foundations are in place.

**Success looks like:** a developer can write

```js
createModule('app', ['ng'])
  .directive('myWidget', () => ({ restrict: 'E', template: '<div>…</div>' }))
  .controller('HomeCtrl', ['$scope', $scope => { $scope.title = 'Home'; }]);
```

…and observe the directive matching elements during compilation and the controller being instantiable by name — with no configuration block written by hand.

---

## 2. Functional Requirements (The "What")

### 2.1 Registering a directive through the module builder

- **As a developer**, I want to register a directive directly on the module builder so I don't have to write a configuration block by hand.
  - **Acceptance Criteria:**
    - [ ] Calling `module.directive('myWidget', factory)` registers the directive and returns the module builder so the call can be chained.
    - [ ] A directive registered this way is matched and linked by the compiler exactly as if it had been registered through a configuration block on the directive provider — same element matching, priority, and linking behaviour.
    - [ ] Calling `module.directive({ widgetA: factoryA, widgetB: factoryB })` registers every entry in the object in a single call.
    - [ ] Registering two directives under the same name (whether through two shortcut calls, or one shortcut call and one configuration-block call) keeps BOTH — both run on a matching element, mirroring the existing directive-registration behaviour.
    - [ ] An invalid directive name or factory produces the same error a developer would see when registering through the configuration-block path — the shortcut neither adds nor hides validation.

### 2.2 Registering a controller through the module builder

- **As a developer**, I want to register a controller directly on the module builder so controller registration reads the same as every other registration kind.
  - **Acceptance Criteria:**
    - [ ] Calling `module.controller('HomeCtrl', factory)` registers the controller and returns the module builder so the call can be chained.
    - [ ] A controller registered this way can be instantiated by name through the controller service, and can be named in a directive's `controller` field, exactly as if it had been registered through a configuration block on the controller provider.
    - [ ] Calling `module.controller({ HomeCtrl: factoryA, AboutCtrl: factoryB })` registers every entry in the object in a single call.
    - [ ] Registering two controllers under the same name (whether through two shortcut calls, or one shortcut call and one configuration-block call) keeps only the most recently registered one — last-wins, mirroring the existing controller-registration behaviour.
    - [ ] An invalid controller name or factory produces the same error a developer would see when registering through the configuration-block path.

### 2.3 Shared registry and parity with the configuration-block path

- **As a developer**, I want the shortcut and the configuration-block path to be fully interchangeable so I can mix them freely and reason about one consistent behaviour.
  - **Acceptance Criteria:**
    - [ ] A directive or controller registered through the shortcut is stored in the same registry as one registered through a configuration block — there is no separate or duplicated registry.
    - [ ] Mixing the two paths within one module works: some directives/controllers registered via the shortcut and others via a configuration block all resolve correctly.
    - [ ] The accumulate-vs-last-wins behaviour is identical regardless of which path was used — directives accumulate, controllers are last-wins, across both paths uniformly.
    - [ ] Both shortcuts can be chained together with every other module-builder method (`.factory`, `.value`, `.filter`, `.config`, `.run`, …) in any order.

### 2.4 Registration timing

- **As a developer**, I want shortcut registrations to take effect at the same point in the module lifecycle as the configuration-block path so timing-sensitive code behaves predictably.
  - **Acceptance Criteria:**
    - [ ] A directive or controller registered through the shortcut is available as soon as the injector finishes its configuration phase — the same moment it would be available if registered through a configuration block.
    - [ ] Registration order between shortcut calls and configuration blocks on the same module follows the order they were written, consistent with how the existing `.filter` shortcut already behaves.

---

## 3. Scope and Boundaries

### In-Scope

- The `.directive(name, factory)` shortcut on the module builder, plus its bulk object form `.directive({ … })`.
- The `.controller(name, factory)` shortcut on the module builder, plus its bulk object form `.controller({ … })`.
- Full behavioural parity with the existing provider/configuration-block registration path: shared registry, identical accumulate/last-wins rules, identical validation and error messages.
- Chainability with every other module-builder method.

### Out-of-Scope

- **The `.component(name, definition)` shortcut** — deferred to its own specification. It depends on isolate scope, controller bindings (`bindToController`), and component lifecycle hooks, none of which exist yet. The roadmap item is being narrowed accordingly.
- **The `ng-controller` built-in directive** — separate "Built-in Directives" roadmap item.
- **Any new behaviour on the underlying directive or controller providers** — this specification only adds builder-level shortcuts over the providers exactly as they exist today.
- All other roadmap items in Phase 2 and beyond: built-in directives, application bootstrap, `$q`, `$http`, forms, routing, animations, and the `angular.*` compatibility layer.
