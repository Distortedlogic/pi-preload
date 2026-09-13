# Dioxus Dynamic Preload Task List

## Goal

Add one built-in `dioxus` dynamic context source. A project selects it through the `dioxus-rust` preset. The collector uses Cargo metadata to detect Dioxus 0.7 project facts, renders package-owned Markdown with Nunjucks, and prepends the result to the preload context.

The implementation must keep existing static file selection unchanged.

## Non-goals

- Do not add Python, Jinja2, or MDX.
- Do not add project-provided executable templates.
- Do not create a general detector plug-in system.
- Do not infer command-line Cargo features that are not present in repository metadata.
- Do not add broad Dioxus API reference content or niche example guidance.

## Work Unit 1: Define the configuration and data contracts

- [ ] Add an optional `contexts` string list to `PRELOAD_CONFIG`.
- [ ] Support only the registered context name `dioxus` in this change.
- [ ] Reject unknown context names with a clear configuration error.
- [ ] Replace `loadPatterns` with a configuration loader that returns both file patterns and context names.
- [ ] Preserve the current preset inheritance order.
- [ ] Deduplicate inherited context names while preserving their first position.
- [ ] Keep circular-preset detection unchanged.
- [ ] Keep the rule that inherited file patterns must be absolute.
- [ ] Add `presets/dioxus-rust.yml` with `contexts: ["dioxus"]` and no project file globs.

### Acceptance checks

- [ ] Existing `extends` and `files` configurations produce the same selected files.
- [ ] A project can select the dynamic context with `extends: ["dioxus-rust"]`.
- [ ] Repeated inheritance renders the Dioxus context once.
- [ ] Unknown configuration properties still fail schema validation.

## Work Unit 2: Add deterministic Cargo metadata detection

- [ ] Add a `DioxusProjectFacts` type with these fields:
  - workspace package names that declare Dioxus
  - Dioxus version requirements
  - direct Dioxus dependency features
  - forwarded Dioxus features declared by package feature tables
  - Dioxus features enabled by each package's default feature path
  - supported platform names from `web`, `desktop`, `mobile`, `native`, and `server`
  - booleans for `fullstack` and `router`
- [ ] Run `cargo metadata --format-version 1 --no-deps` with `execFileAsync`.
- [ ] Run Cargo in the preload project directory without a shell.
- [ ] Pass the collector abort signal to the Cargo process.
- [ ] Set a bounded stdout buffer for Cargo metadata.
- [ ] Parse only workspace packages from the metadata result.
- [ ] Detect normal, target-specific, workspace-inherited, optional, and renamed dependencies whose package name is `dioxus`.
- [ ] Read direct dependency features from Cargo metadata.
- [ ] Read forwarded feature entries such as `dioxus/web` and `dioxus/server` from each package feature table.
- [ ] Resolve local default-feature references recursively before deriving default Dioxus features.
- [ ] Sort every emitted package, version, feature, and platform list for deterministic output.
- [ ] Return no Dioxus facts when valid Cargo metadata contains no Dioxus dependency.
- [ ] Throw a clear error when the selected Dioxus context cannot run Cargo or cannot parse Cargo metadata.

### Detection limits

- [ ] Name facts as declared, forwarded, or default features. Do not call them active build features.
- [ ] Do not run a Cargo build or execute build scripts.
- [ ] Do not access the network directly from the extension.
- [ ] Do not parse Cargo TOML by hand when Cargo metadata already supplies the data.

### Acceptance checks

- [ ] A direct `dioxus = { features = [...] }` dependency is detected.
- [ ] A `dioxus = { workspace = true }` member dependency is detected.
- [ ] A renamed Dioxus dependency is detected by package name.
- [ ] Forwarded platform features and default feature paths are reported separately.
- [ ] The same metadata always produces byte-identical facts.

## Work Unit 3: Add the package-owned Nunjucks renderer

- [ ] Add `nunjucks` as an exact runtime dependency.
- [ ] Add `@types/nunjucks` as a development dependency if the runtime package does not provide sufficient types.
- [ ] Create one Nunjucks environment rooted at the package `context` directory.
- [ ] Disable HTML escaping because the output is Markdown.
- [ ] Enable undefined-value errors.
- [ ] Expose only the normalized `DioxusProjectFacts` object to templates.
- [ ] Do not expose filesystem, process, environment, command, or import helpers to templates.
- [ ] Keep all templates inside this package.
- [ ] Add a root `context/dioxus/index.md.njk` template.
- [ ] Include the existing general Dioxus architecture rules from a package-owned Markdown fragment.
- [ ] Add small conditional fragments for:
  - full-stack and server projects
  - web projects
  - desktop projects
  - mobile projects
  - router use
- [ ] Make the root template select fragments from declared and default Dioxus features.
- [ ] Add a short generated header that states detected packages, version requirements, and feature categories.
- [ ] Keep platform fragments focused on architectural corrections that differ from common model defaults.
- [ ] Avoid API catalog content and specialized integration examples.

### Acceptance checks

- [ ] General Dioxus rules guidance always appears for a detected Dioxus project.
- [ ] Server guidance appears only when full-stack or server support is declared.
- [ ] Web, desktop, mobile, and router guidance appears only for matching facts.
- [ ] The renderer produces deterministic UTF-8 Markdown.
- [ ] Missing template data fails with a clear template error.

## Work Unit 4: Integrate dynamic context into collection

- [ ] Add a small built-in context registry that maps `dioxus` to its detector and renderer.
- [ ] Run each selected context source once per `collectPreload` call.
- [ ] Do not run Cargo metadata when no selected preset requests the Dioxus context.
- [ ] Skip the Dioxus block when Cargo metadata is valid but no Dioxus dependency exists.
- [ ] Create one stable text block with the heading `Context: dioxus` followed by rendered Markdown.
- [ ] Place dynamic context blocks before selected project file blocks.
- [ ] Keep selected project files sorted by their current path rules.
- [ ] Keep the filesystem tree as the final block.
- [ ] Count generated Markdown and its heading against `MAX_TOTAL_BYTES`.
- [ ] Apply `MAX_FILE_BYTES` to each rendered dynamic context block.
- [ ] Keep `result.count` and `result.bytes` as selected project-file metrics.
- [ ] Preserve image blocks and current image byte accounting.
- [ ] Propagate cancellation through Cargo detection and rendering boundaries.

### Acceptance checks

- [ ] A static preload without `contexts` does not execute Cargo and has unchanged block order.
- [ ] A Dioxus preload has dynamic guidance, project files, and `TREE.txt` in that order.
- [ ] Dynamic Markdown cannot bypass existing context byte limits.
- [ ] A missing Dioxus dependency does not add irrelevant guidance.

## Work Unit 5: Write only the high-value Dioxus context fragments

- [ ] Keep the general fragment limited to these broad corrections:
  - Dioxus 0.7.10 patterns override older `Scope`, `cx.render`, and `use_state` knowledge.
  - Use Dioxus before direct Axum.
  - Use signals for simple reactive state and stores for nested domain state.
  - Use `use_memo` for derived values and `use_effect` for external side effects.
  - Select `use_loader`, `use_action`, `use_future`, and `use_resource` by operation semantics.
  - Use Suspense and error boundaries instead of duplicate loading-state plumbing.
  - Use HTTP verb server-function macros and generated Rust clients.
  - Use the strict server-state order: `std::sync::LazyLock`, Dioxus async `Lazy`, typed state, then request extensions.
  - Use typed Dioxus WebSockets instead of raw Axum WebSockets.
  - Use the Dioxus asset pipeline and Tailwind instead of Rust or TypeScript styling systems.
- [ ] Keep the full-stack fragment limited to server functions, server state, errors, and Dioxus-native request and response types.
- [ ] Keep the web fragment limited to SSR or hydration boundaries, assets, and Tailwind source scanning.
- [ ] Keep desktop and mobile fragments limited to feature-gated Dioxus launch and configuration patterns.
- [ ] Keep the router fragment limited to typed routes and reactive route parameters.
- [ ] Remove duplicated guidance between general and conditional fragments.

### Acceptance checks

- [ ] Each conditional fragment adds information that the general fragment does not contain.
- [ ] No fragment recommends direct Axum when a Dioxus-native API exists.
- [ ] No fragment contains WGPU, tray, native plug-in, custom window, or other niche guidance.

## Work Unit 6: Update the existing tests

- [ ] Update `test/unit.test.ts`; do not create a second unit-test suite.
- [ ] Add a helper that narrows text blocks before reading `.text` so image content remains type-safe.
- [ ] Add unit coverage for `contexts` inheritance, ordering, deduplication, and unknown names.
- [ ] Add pure detector tests with inline Cargo metadata objects for:
  - direct dependencies
  - workspace dependencies
  - renamed dependencies
  - target-specific dependencies
  - direct features
  - forwarded features
  - recursively enabled default features
  - no Dioxus dependency
- [ ] Add renderer tests for each conditional fragment and deterministic output.
- [ ] Add byte-limit tests for rendered dynamic context.
- [ ] Keep the existing invalid UTF-8 and image behavior tests valid after block narrowing.
- [ ] Update `test/e2e.test.ts`; do not create another end-to-end suite.
- [ ] Build the end-to-end fixture with a local path dependency named `dioxus` so the test does not need network access.
- [ ] Select `dioxus-rust` through `CONTEXT_PRELOAD.yml` in the fixture.
- [ ] Assert that the custom message contains:
  - the Dioxus context block first
  - selected project files next
  - `TREE.txt` last
  - only the conditional sections selected by fixture features
- [ ] Keep `PI_OFFLINE=1` in the end-to-end process.

### Acceptance checks

- [ ] Tests do not require a downloaded Dioxus crate.
- [ ] Tests do not execute a Cargo build or build script.
- [ ] Existing static preload tests remain unchanged except for safe text-block narrowing.

## Work Unit 7: Package and document the feature

- [ ] Add the `context` directory to the package `files` list.
- [ ] Ensure `presets/dioxus-rust.yml` is included through the existing `presets` package entry.
- [ ] Update the npm lock file after dependency changes.
- [ ] Document `contexts` and `dioxus-rust` in `README.md`.
- [ ] Add a minimal project example:

  ```yaml
  extends:
    - "dioxus-rust"
  files:
    - "Cargo.toml"
    - "Dioxus.toml"
    - "src/**/*.rs"
    - "tailwind.css"
  ```

- [ ] Document that detection reports declared capabilities, not command-line active features.
- [ ] Document that `cargo` must be available when the Dioxus context is selected.
- [ ] Document that templates are package-owned and cannot execute project code.
- [ ] Decide whether the additive configuration feature requires a package version increase, and apply it consistently to package metadata and lock data.

### Acceptance checks

- [ ] `npm pack --dry-run` lists the Dioxus preset and all required context templates.
- [ ] A production package install has every runtime template and dependency.

## Work Unit 8: Run final validation

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run check` as the final combined verification.
- [ ] Run `npm pack --dry-run` and inspect the included files.
- [ ] Run the collector against an isolated temporary Dioxus workspace with `web` and `server` forwarding.
- [ ] Confirm that no desktop or mobile context appears in that result.
- [ ] Confirm that context byte totals and selected-file metrics are correct.
- [ ] Confirm that the repository worktree contains only intended source, test, documentation, package, preset, and context changes.
- [ ] Commit the implementation with a minimal accurate message.

## Completion criteria

- [ ] `extends: ["dioxus-rust"]` enables feature-aware Dioxus guidance.
- [ ] Cargo metadata is the only repository detector source.
- [ ] Nunjucks renders package-owned Markdown from typed facts.
- [ ] Existing static preload behavior remains compatible.
- [ ] Dynamic context obeys abort and byte limits.
- [ ] All existing and new checks pass.
- [ ] The package contains the preset and templates required at runtime.
