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

- [x] Inventory every rendered rule from:
  - `context/dioxus/CORE.md`
  - `context/dioxus/ROUTER.md`
  - `context/dioxus/*/00-SETUP.md`
  - `context/dioxus/*/10-*.md`
  - `context/dioxus/*/20-*.md`
  - `context/dioxus/fullstack/30-REALTIME-STREAMING.md`
- [x] Classify each rule as `preload`, `skill`, or `delete` by the admission policy.
- [x] Record representative rendered byte counts in an existing test file for:
  - a core-only Dioxus package;
  - a router package;
  - a web and server full-stack package;
  - a multi-package workspace with unrelated Dioxus capabilities.
- [x] Define the permitted preload matrix:
  - core rules for every selected Dioxus 0.7.10 package;
  - a small router delta only when router use is certain;
  - a small full-stack delta only when full-stack use is certain;
  - small renderer deltas only when the selected package enables that renderer on its default path;
  - no setup or specialist integration content.
- [x] Set rendered byte budgets from the accepted minimal text. Use byte limits in existing tests. Do not add a tokenizer dependency.

### Work Unit 1 Record

Each semicolon-separated item below identifies one current rule or code example. A heading stays with its retained rules. A heading is removed when no rules remain under it.

#### Rule Inventory

- `context/dioxus/index.md.njk`
  - `delete`: detected-project heading; package names; version requirements; declared features; forwarded features; default-path features.
  - `preload`: conditional assembly only, as specified in the permitted matrix.
- `context/dioxus/CORE.md`
  - `preload`: Dioxus 0.7.10 target; rejection of `Scope`, `cx.render`, `use_state`, and old component-context APIs; copyable signal handles without clone work; `ReadSignal<T>` for reactive read access; `WriteSignal<T>` or `Signal<T>` only for mutation; `use_loader(...)?` for render data and SSR transfer; `use_action` for explicit operations; Dioxus APIs before lower-level platform APIs.
  - `skill` → `state-store.md`: Store selection for large nested state; Store derive and `use_store` example; generated lenses; `#[store]` domain operations; Store versus signal selection.
  - `skill` → `assets-tailwind.md`: reusable `asset!` values; CSS modules; Tailwind detection and source scan; dynamic asset and class selection.
  - `delete`: signal read and write syntax; plain-value prop conversion; memo and effect teaching; context-provider and global-state teaching; `use_future`; `use_resource`; async-handler `Result`; component return type; callback props; prop-builder attributes; extended attributes; children; general RSX control flow; list keys; document-element list; general styling advice; `MountedData` and file-data examples that the lower-level API rule covers.
- `context/dioxus/ROUTER.md`
  - `preload`: route values must be `ReadSignal<T>` when reactive hooks must restart after navigation.
  - `skill` → `advanced-routing.md`: typed `Routable`, `Router`, `Link`, and `Outlet`; typed path, query, hash, catch-all, layout, nest, and redirect declarations.
- `context/dioxus/desktop/00-SETUP.md`
  - `skill` → `project-setup.md`: setup-only scope; desktop feature table; `launch` versus configured `LaunchBuilder`; desktop `Dioxus.toml` fields; desktop `dx serve` command.
- `context/dioxus/desktop/10-DESKTOP.md`
  - `preload`: call local Rust directly without local HTTP or JavaScript IPC; use Dioxus window APIs before Tao or the WebView.
  - `skill` → `project-setup.md`: initial window configuration; multi-renderer launch configuration; remote full-stack server URL.
  - `skill` → `desktop-integration.md`: Wry event fallback; extra-window `VirtualDom` data; menu, tray, shortcut, and close APIs.
  - `skill` → `assets-tailwind.md`: `use_asset_handler` only for runtime-generated or selected content.
- `context/dioxus/desktop/20-CUSTOM-RENDERING.md`
  - `skill` → `desktop-integration.md`: integration-level selection; child-surface host callback, root context, child window, and event bridge; `CustomPaintSource` lifecycle; device-bound renderer state; texture registration; `use_wgpu`; typed renderer-update channel; external `DioxusDocument`, viewport, waker, polling, painting, and input translation; limit custom paint to the required surface.
- `context/dioxus/fullstack/00-SETUP.md`
  - `skill` → `project-setup.md`: setup-only scope; full-stack renderer feature table; shared launch entry point; remote server URL for desktop or mobile.
  - `preload`: current HTTP verb macro for a generated operation; shared wire types and server-feature boundary. These rules move to the small full-stack block.
  - `delete`: greeting implementation and other placeholder code.
- `context/dioxus/fullstack/10-FULLSTACK.md`
  - `preload`: current HTTP verb macros; macro positions for path, query, body, and server-only extractor values; server-only extractors stay out of the client signature; automatic registration; direct Rust client calls and `reqwest` only for external endpoints; shared wire types and server-only implementation boundaries; loader SSR transfer and hydration reuse; normal `Result<T>` path; `HttpError` status behavior; `AsStatusCode`; SSR error-status commit.
  - `skill` → `server-integration.md`: `IntoRequest`; `FromResponse`; matching custom `IntoResponse`; custom response conversion.
  - `skill` → `fullstack-auth.md`, `fullstack-streaming.md`, or `server-integration.md`: forms, headers, redirects, streams, and raw Axum boundary selection.
  - `skill` → `project-setup.md`: current-origin and remote-server URL selection.
  - `delete`: repeated `use_action` details; optional `Loading` matching details.
- `context/dioxus/fullstack/20-AUTH.md`
  - `skill` → `fullstack-auth.md`: actions for authentication operations; typed forms; `SetHeader<SetCookie>`; `TypedHeader<Cookie>`; extractor position; login and account signatures; Axum session and auth layers; generated server-function boundary; package session extractor.
  - `delete`: placeholder implementation comments; general advice to select a maintained authentication package.
- `context/dioxus/fullstack/30-REALTIME-STREAMING.md`
  - `skill` → `fullstack-streaming.md`: operation-to-wire-type table; WebSocket handle, reactive reconnect, upgrade, operations, Serde events, and encoding; SSE and typed stream adapters; stream aliases and encodings; disconnected producer behavior; file and byte conversion; streamed download; incremental consumption.
- `context/dioxus/mobile/00-SETUP.md`
  - `skill` → `project-setup.md`: setup-only scope; mobile feature table; shared launch; native metadata; target commands.
  - `preload`: supported native permissions belong in `Dioxus.toml`. This rule moves to the small mobile block.
  - `skill` → `mobile-native.md`: add native source directories only for a required native module.
- `context/dioxus/mobile/10-MOBILE.md`
  - `preload`: shared Rust UI and state; `target_os` boundaries; manifest-owned supported permissions and CLI mapping.
  - `skill` → `project-setup.md`: bundle and platform metadata; remote full-stack server URL.
  - `skill` → `mobile-native.md`: permission-state requests; native-module fallback; optional widget, Live Activity, background, and native layers.
  - `delete`: general safe-area CSS advice.
- `context/dioxus/mobile/20-NATIVE-PLUGIN.md`
  - `skill` → `mobile-native.md`: native fallback test; Manganis declarations; generated signature matching; typed Rust boundary; Android library and Swift package paths; CLI build; manifest integration; permission mapping; widget extension fields; ActivityKit module identity; target guards; cross-renderer fallback; action boundary.
- `context/dioxus/server/00-SETUP.md`
  - `skill` → `project-setup.md`: setup-only scope; server feature table; optional server dependency setup; shared launch setup.
  - `preload`: use custom serve only for middleware, injected state, or non-Dioxus routes; current verb macro; server-feature boundary. These rules move to the small server or full-stack block.
  - `delete`: sample endpoint implementation.
- `context/dioxus/server/10-SERVER.md`
  - `preload`: default launch services; custom `dioxus::serve` and outer-router boundary; automatic server-function registration and typed-state exception; keep custom Axum code at the outer boundary.
  - `skill` → `project-setup.md`: server-only renderer configuration.
  - `skill` → `server-integration.md`: endpoint middleware; process-wide state choices; async initialization choices; injected `State<T>`; `FromRef<FullstackContext>`; request extensions.
  - `delete`: repeated server-only extractor position.
- `context/dioxus/web/00-SETUP.md`
  - `skill` → `project-setup.md`: setup-only scope; web feature table; launch entry point; router selection; web `Dioxus.toml` fields; `dx serve`; no extra bundler or development server.
  - `delete`: standard source layout.
- `context/dioxus/web/10-WEB.md`
  - `preload`: loader hydration reuse; browser-only work after mount or behind a target boundary; Dioxus event, mount, and document APIs before `web_sys` or direct DOM code.
  - `skill` → `project-setup.md`: renderer selection and current-origin server URL.
  - `skill` → `web-pwa.md`: custom HTML only when document components cannot express required behavior.
  - `delete`: detailed `document::eval` channel teaching.
- `context/dioxus/web/20-PWA.md`
  - `skill` → `web-pwa.md`: public file layout; pre-mount manifest and worker registration; deployment base path; built public URL; stable public URLs versus fingerprinted assets; ordinary Rust assets.
  - `delete`: general advice to keep application state and UI out of service-worker JavaScript.

No rule has an unresolved destination. A moved code example stays only when its exact syntax prevents a likely Dioxus 0.7.10 error.

#### Permitted Preload Matrix

| Selected package fact | Permitted automatic content |
| --- | --- |
| Dioxus 0.7.10 package selected | Core block |
| Direct normal `dioxus-router` dependency or active selected-package router feature | Core and router delta |
| Active selected-package full-stack feature | Core and full-stack delta |
| Active selected-package default-path `web` feature | Core and web runtime delta |
| Active selected-package default-path `server` feature | Core and server runtime delta |
| Active selected-package default-path `desktop` feature | Core and desktop runtime delta |
| Active selected-package default-path `mobile` feature | Core and mobile runtime delta |
| `native` feature | No native block; use the specialist skill |
| Ambiguous workspace package selection | Core block only |

Setup files, Store details, auth, streaming, custom server work, PWA work, desktop integration, and mobile native integration are never automatic content.

#### Baselines and Budgets

The values are UTF-8 bytes from the raw Nunjucks body render. Thus, the values include headings and conditional whitespace. `test/unit.test.ts` stores these values and limits.

| Scenario | Baseline bytes | Final byte limit |
| --- | ---: | ---: |
| Core-only package | 3,861 | 1,200 |
| Router package | 4,168 | 1,400 |
| Web and server full-stack package | 14,634 | 3,000 |
| Ambiguous workspace with unrelated capabilities | 22,008 | 1,200 |

The limits cover the accepted core rules and only the permitted deltas. The ambiguous workspace limit is the core limit. No tokenizer is required.

### Exit Criteria

- Every current rule has one destination.
- Baseline output sizes are recorded.
- The preload admission policy and capability matrix have no unresolved cases.

---

## Work Unit 2: Scope Cargo Facts to the Applicable Package

**Depends on:** Work Unit 1

- [x] Extend the internal Cargo metadata types in `context/dioxus/facts.ts` with the package manifest path, workspace root, and workspace default members needed for package selection.
- [x] Replace workspace-wide capability aggregation with this deterministic selection order:
  1. Select the Dioxus package whose manifest directory is the deepest ancestor of `cwd`.
  2. If no package contains `cwd`, select the only Dioxus package in `workspace_default_members`.
  3. If that is not unique, select the only Dioxus workspace package.
  4. If selection is still ambiguous, emit core-only facts and do not infer router, full-stack, or renderer capabilities.
- [x] Keep direct normal `dioxus-router` dependency detection for the selected package.
- [x] Treat only these Dioxus features as active facts:
  - features declared directly on the selected package's normal `dioxus` dependency;
  - forwarded features reachable from the selected package's `default` feature graph.
- [x] Do not treat every forwarded feature declaration as active.
- [x] Remove rendered-data fields that only describe the project:
  - `packageNames`;
  - `versionRequirements` when it does not control compatibility;
  - `declaredFeatures`;
  - `forwardedFeatures`;
  - `defaultFeatures`.
- [x] Keep only the facts required by template conditions, such as `router`, `fullstack`, and conservative default-path renderers.
- [x] Preserve abort handling, bounded Cargo output, and actionable Cargo errors.
- [x] Update parser cases in the existing unit test suite before and with the implementation. Cover nested packages, one default member, one workspace member, ambiguous workspaces, direct features, default-forwarded features, and inactive forwarded features.

### Exit Criteria

- An unrelated workspace member cannot add context.
- Optional renderer declarations do not act as active renderer facts.
- Ambiguous workspaces receive core rules only.
- Existing fact-loader error and cancellation behavior remains intact.

---

## Work Unit 3: Move Task-Dependent Coverage to One Router Skill

**Depends on:** Work Unit 1

- [x] Add `skills/dioxus-specialized/SKILL.md` as a small routing skill.
- [x] Give the skill a precise description. Trigger it for Dioxus project setup, Store state, advanced routing, full-stack auth or streaming, custom server integration, PWA work, desktop platform integration, or mobile native integration. State that ordinary component edits do not need it.
- [x] Make `SKILL.md` select only the reference required by the current task. Do not load all references by default.
- [x] Create and prune task-specific references under `skills/dioxus-specialized/references/`:
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
- [x] Move useful specialist facts from the current context files into the matching references before removing any preload include.
- [x] Remove basic teaching, repeated rationale, and generic examples from the references too.
- [x] Keep exact code only where syntax is easy to generate incorrectly, such as server-only extractors, Manganis declarations, Store extensions, and custom response conversion.
- [x] Do not duplicate a rule between preload content and a skill reference.
- [x] Verify that the existing `package.json` skill manifest already discovers the new skill. Change the manifest only if discovery requires it.

### Exit Criteria

- All useful task-dependent coverage has an on-demand location.
- The skill reads only the reference that matches the task.
- Setup and specialist guidance is absent from automatic context.
- No guidance is duplicated.

---

## Work Unit 4: Rebuild the Minimal Preload Content

**Depends on:** Work Units 2 and 3

- [x] Reduce `context/dioxus/CORE.md` to compact rules for:
  - the Dioxus 0.7.10 target;
  - rejection of `Scope`, `cx.render`, `use_state`, and old component-context APIs;
  - copyable signal handles without clone scaffolding;
  - `ReadSignal<T>` for reactive read access and `WriteSignal<T>` or `Signal<T>` only for mutation;
  - `use_loader(...)?` for render-required data and `use_action` for explicit operations;
  - use of lower-level platform APIs only when Dioxus has no suitable operation.
- [x] Remove general component, RSX, signal syntax, iterator, effect, memo, callback, children, asset, CSS, and document-element instruction from `CORE.md`.
- [x] Reduce `context/dioxus/ROUTER.md` to the route-value reactivity fact that prevents stale reactive hooks. Move all route construction guidance to the skill.
- [x] Reduce `context/dioxus/fullstack/10-FULLSTACK.md` to stable generated-server-function facts:
  - current HTTP verb macros;
  - server-only extractor position;
  - direct Rust client calls;
  - server feature boundaries;
  - loader SSR transfer and hydration reuse;
  - automatic registration and the typed-state exception;
  - explicit HTTP error status behavior.
- [x] Reduce each retained renderer runtime file to rules that apply to nearly every task for that renderer:
  - `context/dioxus/web/10-WEB.md`: hydration reuse, browser-only work after mount, and Dioxus APIs before `web_sys`;
  - `context/dioxus/server/10-SERVER.md`: default serving and the narrow boundary for custom outer-router code;
  - `context/dioxus/desktop/10-DESKTOP.md`: direct local Rust and Dioxus window APIs before Wry or Tao;
  - `context/dioxus/mobile/10-MOBILE.md`: shared Rust logic, target guards, and manifest-owned supported permissions.
- [x] Do not add a native preload block unless there is a stable native fact that passes the admission policy. Keep native specialist guidance in the skill.
- [x] Remove introductions, tutorials, standard project layouts, ordinary commands, placeholder implementations, long API lists, and repeated rationale.
- [x] Use short imperative rules. Prefer `Use X when Y. Do not use Z.`
- [x] Remove redundant headings and all excess internal or trailing blank lines.

### Exit Criteria

- Every retained sentence passes the admission policy.
- Core context is useful for ordinary component and bug-fix tasks.
- No retained block teaches standard Rust or standard application development.
- No retained block depends on the current task being about a specialist integration.

---

## Work Unit 5: Simplify Template Assembly

**Depends on:** Work Unit 4

- [x] Remove the detected-project inventory from `context/dioxus/index.md.njk`.
- [x] Do not render package names or declared, forwarded, and default feature lists.
- [x] Render `CORE.md` unconditionally after Dioxus detection.
- [x] Render only the small router, full-stack, and conservative renderer deltas selected by facts.
- [x] Remove automatic includes for:
  - every `00-SETUP.md` file;
  - `fullstack/20-AUTH.md`;
  - `fullstack/30-REALTIME-STREAMING.md`;
  - `web/20-PWA.md`;
  - `desktop/20-CUSTOM-RENDERING.md`;
  - `mobile/20-NATIVE-PLUGIN.md`.
- [x] Delete or move context files that no longer have a preload purpose after their useful content is present in skill references.
- [x] Control include spacing so that disabled sections add no blank-line cost.
- [x] Do not shorten `facts.ts` implementation only to reduce context size. Its source is not rendered.

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
