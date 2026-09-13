# Dioxus Context Optimization Task List

## Objective

Reduce the automatically rendered `context/dioxus` content to stable Dioxus 0.7.10 facts that apply to nearly every task for a detected capability. Move setup, specialist integrations, and task-dependent decisions to an on-demand skill. Preserve useful coverage without paying its token cost on unrelated turns.

## Admission Policy

A rule can remain in preload context only when all statements are true:

- It is specific to Dioxus 0.7.10 or corrects a likely version error.
- An agent is likely to make a material mistake without it.
- It applies to nearly every task for the capability that selects it.
- It changes an implementation choice.
- A user task is not needed to establish its relevance.

Move a rule to a skill when the current task must concern setup, a specialist API, an integration, or an uncommon workflow before the rule is useful. Delete basic Rust, RSX, UI, web, and server knowledge that does not need Dioxus-specific correction.

---

## Work Unit 1: Lock the Content Contract and Baseline

**Depends on:** None

- [ ] Inventory every rendered rule from:
  - `context/dioxus/CORE.md`
  - `context/dioxus/ROUTER.md`
  - `context/dioxus/*/00-SETUP.md`
  - `context/dioxus/*/10-*.md`
  - `context/dioxus/*/20-*.md`
  - `context/dioxus/fullstack/30-REALTIME-STREAMING.md`
- [ ] Classify each rule as `preload`, `skill`, or `delete` by the admission policy.
- [ ] Record representative rendered byte counts in an existing test file for:
  - a core-only Dioxus package;
  - a router package;
  - a web and server full-stack package;
  - a multi-package workspace with unrelated Dioxus capabilities.
- [ ] Define the permitted preload matrix:
  - core rules for every selected Dioxus 0.7.10 package;
  - a small router delta only when router use is certain;
  - a small full-stack delta only when full-stack use is certain;
  - small renderer deltas only when the selected package enables that renderer on its default path;
  - no setup or specialist integration content.
- [ ] Set rendered byte budgets from the accepted minimal text. Use byte limits in existing tests. Do not add a tokenizer dependency.

### Exit Criteria

- Every current rule has one destination.
- Baseline output sizes are recorded.
- The preload admission policy and capability matrix have no unresolved cases.

---

## Work Unit 2: Scope Cargo Facts to the Applicable Package

**Depends on:** Work Unit 1

- [ ] Extend the internal Cargo metadata types in `context/dioxus/facts.ts` with the package manifest path, workspace root, and workspace default members needed for package selection.
- [ ] Replace workspace-wide capability aggregation with this deterministic selection order:
  1. Select the Dioxus package whose manifest directory is the deepest ancestor of `cwd`.
  2. If no package contains `cwd`, select the only Dioxus package in `workspace_default_members`.
  3. If that is not unique, select the only Dioxus workspace package.
  4. If selection is still ambiguous, emit core-only facts and do not infer router, full-stack, or renderer capabilities.
- [ ] Keep direct normal `dioxus-router` dependency detection for the selected package.
- [ ] Treat only these Dioxus features as active facts:
  - features declared directly on the selected package's normal `dioxus` dependency;
  - forwarded features reachable from the selected package's `default` feature graph.
- [ ] Do not treat every forwarded feature declaration as active.
- [ ] Remove rendered-data fields that only describe the project:
  - `packageNames`;
  - `versionRequirements` when it does not control compatibility;
  - `declaredFeatures`;
  - `forwardedFeatures`;
  - `defaultFeatures`.
- [ ] Keep only the facts required by template conditions, such as `router`, `fullstack`, and conservative default-path renderers.
- [ ] Preserve abort handling, bounded Cargo output, and actionable Cargo errors.
- [ ] Update parser cases in the existing unit test suite before and with the implementation. Cover nested packages, one default member, one workspace member, ambiguous workspaces, direct features, default-forwarded features, and inactive forwarded features.

### Exit Criteria

- An unrelated workspace member cannot add context.
- Optional renderer declarations do not act as active renderer facts.
- Ambiguous workspaces receive core rules only.
- Existing fact-loader error and cancellation behavior remains intact.

---

## Work Unit 3: Move Task-Dependent Coverage to One Router Skill

**Depends on:** Work Unit 1

- [ ] Add `skills/dioxus-specialized/SKILL.md` as a small routing skill.
- [ ] Give the skill a precise description. Trigger it for Dioxus project setup, Store state, advanced routing, full-stack auth or streaming, custom server integration, PWA work, desktop platform integration, or mobile native integration. State that ordinary component edits do not need it.
- [ ] Make `SKILL.md` select only the reference required by the current task. Do not load all references by default.
- [ ] Create and prune task-specific references under `skills/dioxus-specialized/references/`:
  - `project-setup.md` for renderer features, `Dioxus.toml`, commands, and initial target setup;
  - `state-store.md` for Store derivation, lenses, and `#[store]` domain operations;
  - `advanced-routing.md` for nests, layouts, redirects, query or hash state, catch-all routes, and scroll restoration;
  - `assets-tailwind.md` for CSS modules, Tailwind source scanning, and dynamic asset handling;
  - `fullstack-auth.md` for forms, cookies, typed headers, sessions, and auth layers;
  - `fullstack-streaming.md` for SSE, typed streams, WebSockets, files, bytes, and multipart forms;
  - `server-integration.md` for custom Axum routers, middleware, injected state, custom extractors, and custom responses;
  - `web-pwa.md` for manifests, service workers, stable public assets, base paths, and custom HTML;
  - `desktop-integration.md` for menus, trays, windows, Wry events, child surfaces, WGPU, and externally driven documents;
  - `mobile-native.md` for permissions, Manganis FFI, Gradle, Swift packages, widgets, Live Activities, and platform fallbacks.
- [ ] Move useful specialist facts from the current context files into the matching references before removing any preload include.
- [ ] Remove basic teaching, repeated rationale, and generic examples from the references too.
- [ ] Keep exact code only where syntax is easy to generate incorrectly, such as server-only extractors, Manganis declarations, Store extensions, and custom response conversion.
- [ ] Do not duplicate a rule between preload content and a skill reference.
- [ ] Verify that the existing `package.json` skill manifest already discovers the new skill. Change the manifest only if discovery requires it.

### Exit Criteria

- All useful task-dependent coverage has an on-demand location.
- The skill reads only the reference that matches the task.
- Setup and specialist guidance is absent from automatic context.
- No guidance is duplicated.

---

## Work Unit 4: Rebuild the Minimal Preload Content

**Depends on:** Work Units 2 and 3

- [ ] Reduce `context/dioxus/CORE.md` to compact rules for:
  - the Dioxus 0.7.10 target;
  - rejection of `Scope`, `cx.render`, `use_state`, and old component-context APIs;
  - copyable signal handles without clone scaffolding;
  - `ReadSignal<T>` for reactive read access and `WriteSignal<T>` or `Signal<T>` only for mutation;
  - `use_loader(...)?` for render-required data and `use_action` for explicit operations;
  - use of lower-level platform APIs only when Dioxus has no suitable operation.
- [ ] Remove general component, RSX, signal syntax, iterator, effect, memo, callback, children, asset, CSS, and document-element instruction from `CORE.md`.
- [ ] Reduce `context/dioxus/ROUTER.md` to the route-value reactivity fact that prevents stale reactive hooks. Move all route construction guidance to the skill.
- [ ] Reduce `context/dioxus/fullstack/10-FULLSTACK.md` to stable generated-server-function facts:
  - current HTTP verb macros;
  - server-only extractor position;
  - direct Rust client calls;
  - server feature boundaries;
  - loader SSR transfer and hydration reuse;
  - automatic registration and the typed-state exception;
  - explicit HTTP error status behavior.
- [ ] Reduce each retained renderer runtime file to rules that apply to nearly every task for that renderer:
  - `context/dioxus/web/10-WEB.md`: hydration reuse, browser-only work after mount, and Dioxus APIs before `web_sys`;
  - `context/dioxus/server/10-SERVER.md`: default serving and the narrow boundary for custom outer-router code;
  - `context/dioxus/desktop/10-DESKTOP.md`: direct local Rust and Dioxus window APIs before Wry or Tao;
  - `context/dioxus/mobile/10-MOBILE.md`: shared Rust logic, target guards, and manifest-owned supported permissions.
- [ ] Do not add a native preload block unless there is a stable native fact that passes the admission policy. Keep native specialist guidance in the skill.
- [ ] Remove introductions, tutorials, standard project layouts, ordinary commands, placeholder implementations, long API lists, and repeated rationale.
- [ ] Use short imperative rules. Prefer `Use X when Y. Do not use Z.`
- [ ] Remove redundant headings and all excess internal or trailing blank lines.

### Exit Criteria

- Every retained sentence passes the admission policy.
- Core context is useful for ordinary component and bug-fix tasks.
- No retained block teaches standard Rust or standard application development.
- No retained block depends on the current task being about a specialist integration.

---

## Work Unit 5: Simplify Template Assembly

**Depends on:** Work Unit 4

- [ ] Remove the detected-project inventory from `context/dioxus/index.md.njk`.
- [ ] Do not render package names or declared, forwarded, and default feature lists.
- [ ] Render `CORE.md` unconditionally after Dioxus detection.
- [ ] Render only the small router, full-stack, and conservative renderer deltas selected by facts.
- [ ] Remove automatic includes for:
  - every `00-SETUP.md` file;
  - `fullstack/20-AUTH.md`;
  - `fullstack/30-REALTIME-STREAMING.md`;
  - `web/20-PWA.md`;
  - `desktop/20-CUSTOM-RENDERING.md`;
  - `mobile/20-NATIVE-PLUGIN.md`.
- [ ] Delete or move context files that no longer have a preload purpose after their useful content is present in skill references.
- [ ] Control include spacing so that disabled sections add no blank-line cost.
- [ ] Do not shorten `facts.ts` implementation only to reduce context size. Its source is not rendered.

### Exit Criteria

- A core-only render contains only `CORE.md` rules.
- Specialist project files do not cause specialist guidance to preload.
- Conditional sections add no empty headings or repeated whitespace.
- The rendered output stays within the Work Unit 1 byte budgets.

---

## Work Unit 6: Update Existing Tests and Package Documentation

**Depends on:** Work Units 2 through 5

- [ ] Update `test/unit.test.ts` and `test/e2e.test.ts` only. Do not add a new test file or suite.
- [ ] Verify exact inclusion and exclusion for core, router, full-stack, and each conservative renderer delta.
- [ ] Verify that the following never enter preload output:
  - setup instructions;
  - Store guidance;
  - auth guidance;
  - streaming guidance;
  - PWA guidance;
  - custom desktop rendering guidance;
  - mobile native plug-in guidance.
- [ ] Verify selected-package behavior in nested and virtual workspaces.
- [ ] Verify core-only fallback for ambiguous workspaces.
- [ ] Add regression assertions for rendered byte budgets.
- [ ] Verify that the packaged skill and all referenced files are included by the existing package manifest and `files` list.
- [ ] Update `README.md` only where it describes Dioxus context selection or packaged skills. Do not add tutorial content.
- [ ] Remove documentation that claims specialist guidance is automatically preloaded.

### Exit Criteria

- Existing tests prove both retained steering and removed token cost.
- Package installation includes the on-demand skill references.
- Documentation matches actual selection behavior.

---

## Work Unit 7: Validate the Final Result

**Depends on:** Work Unit 6

- [ ] Render all representative fixtures and compare their byte counts with the baseline.
- [ ] Confirm that every rendered sentence passes the admission policy.
- [ ] Confirm that every moved specialist subject remains reachable through the skill.
- [ ] Search the preload and skill references for duplicated rules.
- [ ] Run `npm run check`.
- [ ] Review the final diff for unrelated edits, added comments, duplicated examples, and unnecessary dependencies.
- [ ] Commit the completed implementation with one minimal, accurate message.

### Exit Criteria

- `npm run check` passes.
- All byte-budget assertions pass.
- Automatic context contains only stable, broadly applicable steering.
- Task-dependent guidance loads only through the skill.
- The final diff contains no unrelated changes.
