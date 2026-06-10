# Functional Specification: Pluralization Directive (`ng-pluralize`)

- **Roadmap Item:** Built-in Directives — Pluralization / i18n: `ng-pluralize`
- **Status:** Approved
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Template authors constantly display messages whose wording depends on a number: "You have **1 new message**" but "You have **3 new messages**"; "**Nobody** is viewing" but "**John, Mary and 2 others** are viewing". Without dedicated support, authors hand-write chains of conditional markup for every such sentence — verbose, repetitive, easy to get grammatically wrong, and impossible to adapt to languages whose plural rules differ from English (many languages have more than two plural forms).

This feature adds the classic AngularJS pluralization directive: the author writes one element that declares a **count** and a set of **message variants**, and the framework displays the variant that grammatically fits the current count — keeping the displayed text up to date as the count changes.

This is the second-to-last batch in the project's "Built-in Directives" roadmap item and a required piece of the drop-in AngularJS 1.x compatibility story.

**Success criteria:**

- A template author can reproduce every example from the official AngularJS `ngPluralize` documentation and see identical on-screen results.
- Which plural form is chosen follows the app's configured locale; apps that swap in a non-English locale get that language's plural rules with no change to their templates.
- Behavior is covered by the project's standard test suite at its usual coverage bar.

---

## 2. Functional Requirements (The "What")

### 2.1. Choosing a message by count

- **As a** template author, **I want to** declare several message variants keyed by plural category, **so that** the page always shows the grammatically correct sentence for the current count.
- The author provides:
  - a **count** — an expression evaluated against the surrounding data; and
  - a **when** mapping — message texts keyed either by an **exact number** (e.g. `0`, `1`) or by a **plural category name** (e.g. `one`, `other`).
- An exact-number key always wins over a category key: if the count is 1 and messages exist for both `"1"` and `"one"`, the `"1"` message is shown.
- If no exact-number key matches, the count's plural category (per the app's locale — see 2.5) selects the message.

**Acceptance Criteria:**

- [ ] Given messages `{'0': "You have no new messages.", 'one': "You have one new message.", 'other': "You have {} new messages."}`, when the count is 0, the element displays "You have no new messages."
- [ ] With the same messages, when the count is 1, the element displays "You have one new message."
- [ ] With the same messages, when the count is 3, the element displays "You have 3 new messages."
- [ ] Given messages for both `"1"` and `"one"`, when the count is 1, the `"1"` message is displayed (exact match wins).

### 2.2. The number placeholder

- Inside any message, the two-character placeholder `{}` stands for the current count and is replaced with the actual number when the message is displayed.
- When an **offset** is in effect (see 2.4), the placeholder shows the count **minus the offset**.

**Acceptance Criteria:**

- [ ] Given the message `"You have {} new messages."` and a count of 42, the element displays "You have 42 new messages."
- [ ] A message may use the placeholder more than once; every occurrence is replaced.

### 2.3. Messages may embed live expressions

- Message texts may contain the framework's standard `{{expression}}` bindings, evaluated against the surrounding data. These update on screen like any other binding.

**Acceptance Criteria:**

- [ ] Given the message `"{{person1}} is viewing."` and `person1` is "Igor", the element displays "Igor is viewing."
- [ ] When `person1` later changes to "Misko" (with the count unchanged), the displayed text updates to "Misko is viewing."

### 2.4. Offset

- The author may declare a numeric **offset**.
- **Exact-number keys** are matched against the count **as written** (no offset applied).
- **Category selection** and the `{}` placeholder use the count **minus the offset**.
- This enables the classic pattern: with offset 2 and a count of 4 — "John, Mary and 2 others are viewing."

**Acceptance Criteria:**

- [ ] Given offset 2 and messages `{'0': "Nobody is viewing.", '1': "{{person1}} is viewing.", '2': "{{person1}} and {{person2}} are viewing.", 'one': "{{person1}}, {{person2}} and one other person are viewing.", 'other': "{{person1}}, {{person2}} and {} other people are viewing."}`:
  - [ ] count 0 → "Nobody is viewing." (exact key `0`, raw count)
  - [ ] count 1 → "Igor is viewing." (exact key `1`, raw count)
  - [ ] count 2 → "Igor and Misko are viewing." (exact key `2`, raw count)
  - [ ] count 3 → "Igor, Misko and one other person are viewing." (3 − 2 = 1 → category `one`)
  - [ ] count 4 → "Igor, Misko and 2 other people are viewing." (4 − 2 = 2 → category `other`; `{}` shows 2)

### 2.5. Locale-driven plural categories

- Which category a number belongs to is decided by the app's configured locale, not hard-coded.
- The default (English) locale ships with two categories: exactly 1 → `one`; every other value (including decimals like 1.5 and negative numbers) → `other`.
- An app that swaps in another locale automatically gets that language's category rules with no template changes.

**Acceptance Criteria:**

- [ ] Under the default locale, a count of 1 selects the `one` message; counts of 0, 2, 1.5, and −1 select the `other` message.
- [ ] After the app replaces the locale with one whose rules differ (e.g. a locale that maps both 1 and 2 to a special category), the same template picks messages per the new rules.

### 2.6. Live updates

- Whenever the count changes, the displayed message updates automatically — switching variants when the count crosses a category or exact-match boundary, and refreshing the `{}` placeholder.

**Acceptance Criteria:**

- [ ] Given a page displaying "You have one new message." (count 1), when the count changes to 2, the text changes to "You have 2 new messages." without any other action.
- [ ] When the count changes between two values in the same category (e.g. 2 → 5), the placeholder number updates accordingly.

### 2.7. Authoring forms

Three equivalent ways to write the directive are supported:

1. **Element form:** a dedicated `<ng-pluralize count="…" when="…">` element.
2. **Attribute form:** `ng-pluralize` as an attribute on any element, e.g. `<span ng-pluralize count="…" when="…">`.
3. **Individual per-category attributes:** instead of (or in addition to) the single `when` mapping, each variant may be written as its own attribute — `when-0="Nobody is viewing."`, `when-one="{} person is viewing."`, `when-other="{} people are viewing."`. These are convenient when a message contains quote characters.

- The two styles may be combined; if the same key appears in both the `when` mapping and an individual `when-…` attribute, the individual attribute wins.

**Acceptance Criteria:**

- [ ] The same count and messages produce identical displayed text whether written as the element form or the attribute form.
- [ ] A directive written purely with `when-0` / `when-one` / `when-other` attributes (no `when` mapping) behaves identically to the equivalent `when` mapping.
- [ ] When `when` declares `'one': "A"` and the element also carries `when-one="B"`, a count of 1 displays "B".

### 2.8. Unusable count

- If the count expression does not produce a usable number (missing value, blank, or non-numeric text like "abc"), the element displays **nothing** — its text is blank.
- If a previously valid count becomes unusable, any previously displayed message is cleared.

**Acceptance Criteria:**

- [ ] Given a count bound to a value that is missing, the element shows no text.
- [ ] Given a count bound to the text "abc", the element shows no text.
- [ ] Given a displayed message for count 2, when the count becomes unusable, the element's text clears to blank.
- [ ] A count provided as numeric text (e.g. the text "3") behaves the same as the number 3.

### 2.9. Missing message for a matched category

- If the count is a valid number but **no message exists** for its exact value or its plural category, the element displays nothing, and the problem is reported through the framework's standard error-reporting channel so the author can notice it during development. The rest of the page continues to work normally.

**Acceptance Criteria:**

- [ ] Given only a `one` message and a count of 5, the element shows no text and a report describing the missing category is delivered to the app's configured error handler.
- [ ] The page around the element keeps updating normally after such a report.

---

## 3. Scope and Boundaries

### In-Scope

- The `ng-pluralize` directive in both element and attribute form.
- The `count`, `when`, and `offset` inputs; individual `when-…` per-category attributes.
- Exact-number matching, locale-driven category matching, and their precedence rule.
- The `{}` placeholder (offset-aware) and embedded `{{expression}}` bindings inside messages.
- Automatic display updates when the count or embedded expressions change.
- Blank-on-unusable-count behavior and reported-warning-on-missing-category behavior.

### Out-of-Scope

- **Other roadmap items** (separate specifications): the CSP / template-cache / element-override directive batch (`ng-csp`, `ng-jq`, `ng-ref`, template `<script>` registration, anchor safety), Service Text Diagrams, Application Bootstrap, all of Phase 3 (forms, HTTP, promises) and Phase 4 (routing, animations, packaging).
- **Animation hooks** for message transitions — animations are a Phase 4 roadmap item.
- **Shipping additional locale packs** — only the default English rules ship; apps supply their own locale.
- **Richer message formatting** beyond pluralization (e.g. gender/select-style messages, as in AngularJS's optional MessageFormat extension).
