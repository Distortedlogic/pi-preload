# Dynamic Context Sources Task List

## Goal

Add a convention-based system for package-owned dynamic context sources. A configured context name must resolve directly to one self-contained directory under `context/`. The directory must collect project facts, render a package-owned Nunjucks template, and produce zero or one preload block.

Implement `dioxus` as the first source. Move all current Dioxus context Markdown under `context/dioxus/` and let its template select only the applicable fragments.

Keep existing static file selection, file ordering, image handling, tree generation, and result metrics unchanged.

## Required convention

A dynamic context source has this package layout:

```text
context/<name>/
├── facts.ts
├── index.md.njk
└── <package-owned Markdown fragments>
```

For `contexts: ["dioxus"]`, the collector must resolve these fixed paths:

```text
context/dioxus/facts.ts
context/dioxus/index.md.njk
```

The directory is the source definition. Do not add a registry, manifest, switch statement, central allow-list, source-specific renderer map, or duplicate template path.

`facts.ts` must have one default export with this contract:

```typescript
type ContextFactsLoader = (input: {
	cwd: string;
	signal: AbortSignal;
}) => Promise<Record<string, unknown> | undefined>;
```

- Return normalized facts when the source applies.
- Return `undefined` when the source does not apply.
- Pass the abort signal to blocking work.
- Keep source-specific detection inside the source directory.
- Do not select or assemble Markdown in `facts.ts`.

`index.md.njk` receives only `facts`. It must select and order package-owned Markdown fragments.

## Non-goals

- Do not add a context registry or registration API.
- Do not scan the project for context implementations.
- Do not load project-owned templates or executable context modules.
- Do not add a template manifest, class hierarchy, lifecycle API, command DSL, or general plug-in framework.
- Do not expose filesystem, process, environment, command, or import helpers to Nunjucks.
- Do not make the generic collector aware of Cargo or Dioxus.
- Do not add dynamic image output before a real source requires it.
- Do not remove existing Dioxus guidance only because it is not selected automatically in the first implementation.
- Do not add new test suites. Update the existing unit and end-to-end suites.

## Work Unit 1: Extend the preload configuration contract

- [x] Add an optional `contexts` list of non-empty strings to `PRELOAD_CONFIG`.
- [x] Replace `loadPatterns` with a configuration loader that returns `{ files, contexts }`.
- [x] Keep the current preset recursion and circular-preset error.
- [x] Preserve the current inherited-file order and local-file order exactly.
- [x] Keep the rule that inherited file patterns must be absolute.
- [x] Merge inherited context names before local context names.
- [x] Deduplicate context names by first occurrence without sorting them.
- [x] Require each context name to be one safe package-directory slug.
- [x] Reject absolute names, separators, `.` segments, `..` segments, and empty names before path resolution.
- [x] Keep `additionalProperties: false` so unknown configuration properties still fail.
- [x] Add `presets/dioxus-rust.yml` with only `contexts: ["dioxus"]`.
- [x] Do not add project file globs to `dioxus-rust`; projects continue to select their own files.

### Acceptance checks

- [x] Configurations that use only `extends` and `files` produce the same patterns and selected files as before.
- [x] Context inheritance follows preset order and then local order.
- [x] Repeated inherited and local names run once at their first position.
- [x] Unsafe names fail before any module load or template render.
- [ ] `extends: ["dioxus-rust"]` selects the package directory `context/dioxus/`.

## Work Unit 2: Add convention-based source resolution

- [x] Define `DEFAULT_CONTEXT_DIRECTORY` from `new URL("./context/", import.meta.url)`.
- [x] Resolve each selected name directly as `context/<name>/`; do not enumerate context directories.
- [x] Require `facts.ts` and `index.md.njk` at their fixed paths.
- [x] Verify that both entry paths remain inside the package context root.
- [x] Report a clear `Unknown context source: <name>` error when either required entry is absent or is not a regular file.
- [x] Load the package-owned `facts.ts` module through the extension runtime by its resolved file URL.
- [x] Validate that the module default export is a function before calling it.
- [x] Call each selected facts loader once per `collectPreload` call with `{ cwd, signal }`.
- [x] Skip template rendering and block creation when the loader returns `undefined`.
- [x] Wrap import and execution failures with the context name while preserving the original error detail.
- [x] Do not import any context module when `contexts` is absent or empty.
- [x] Add `context/**/*.ts` to `tsconfig.json` so facts loaders receive normal project type checking.
- [ ] Verify source loading in both the unit-test Node runtime and the Pi extension runtime.

### Acceptance checks

- [x] Adding a valid `context/<name>/` directory needs no edit to `index.ts` source-specific logic.
- [x] Removing a source directory makes its configured name fail without a stale registry entry.
- [x] An unselected source module is not imported and cannot perform work.
- [x] A selected source that returns `undefined` adds no heading and no empty block.
- [x] Source import, export-contract, and execution errors identify the context name.

## Work Unit 3: Add the shared Nunjucks renderer

- [x] Add `nunjucks` as an exact runtime dependency.
- [x] Add `@types/nunjucks` as a development dependency only if `nunjucks` does not provide sufficient types.
- [x] Update `package-lock.json` through npm after dependency changes.
- [x] Create one Nunjucks environment rooted at `DEFAULT_CONTEXT_DIRECTORY`.
- [x] Disable HTML escaping because output is Markdown.
- [x] Enable undefined-value errors.
- [x] Do not register command, filesystem, process, environment, import, or project-data helpers.
- [x] Render the fixed template `<name>/index.md.njk` with `{ facts }` and no other project state.
- [x] Let templates use normal package-owned includes below the context root.
- [x] Normalize rendered output to deterministic UTF-8 text with one final newline.
- [x] Treat an empty rendered result for an applicable source as a source error instead of adding an empty block.
- [x] Check cancellation immediately before and after synchronous template rendering.
- [x] Add the shared heading `Context: <name>\n\n` outside the template.
- [x] Keep source-specific headings and rendering code out of the collector.

### Acceptance checks

- [x] The same facts and package files produce byte-identical output.
- [x] Missing template data fails with a clear source-scoped rendering error.
- [x] Includes cannot resolve project files.
- [x] Templates receive no executable helper or host object.
- [x] Every source gets the same heading and output normalization rules.

## Work Unit 4: Integrate dynamic blocks without changing static collection

- [x] Collect selected dynamic sources in deduplicated configuration order.
- [x] Keep all existing static candidate discovery, binary checks, path sorting, file limits, decoding, and image block creation unchanged.
- [x] Place dynamic text blocks before all selected project-file blocks.
- [x] Keep selected project-file blocks in their current order.
- [x] Keep the filesystem tree as the final block.
- [x] Apply `MAX_FILE_BYTES` to each complete dynamic block, including its heading.
- [x] Count every complete dynamic block against `MAX_TOTAL_BYTES` with project-file context blocks.
- [x] Preserve the separate `MAX_TREE_BYTES` allowance for the final tree block.
- [x] Keep `result.count` as the selected project-file count.
- [x] Keep `result.bytes` as the loaded project-file byte count.
- [x] Keep current base64 image byte accounting.
- [x] Pass the collector signal through source loading and detection boundaries.
- [x] Check the signal between source collection, static collection, and tree collection.

### Acceptance checks

- [x] A preload with no `contexts` does not import a facts module, execute Cargo, or change block order.
- [x] A dynamic preload has context blocks, project-file blocks, and `TREE.txt` in that order.
- [x] Context names run once and keep configuration order.
- [x] Generated Markdown cannot bypass per-block or total context limits.
- [x] Dynamic output does not change selected-file metrics.
- [x] Existing static image and invalid UTF-8 behavior remains valid.

## Work Unit 5: Move the Dioxus context into one source directory

- [x] Create `context/dioxus/`.
- [x] Move `context/CORE.md` to `context/dioxus/CORE.md`.
- [x] Move `context/desktop/` to `context/dioxus/desktop/`.
- [x] Move `context/fullstack/` to `context/dioxus/fullstack/`.
- [x] Move `context/mobile/` to `context/dioxus/mobile/`.
- [x] Move `context/server/` to `context/dioxus/server/`.
- [x] Move `context/web/` to `context/dioxus/web/`.
- [x] Preserve file contents during the move unless a section must be split for independent conditional selection.
- [x] Update package-owned references to the moved paths.
- [x] Remove the now-empty top-level platform directories.
- [x] Make an inclusion matrix for every moved Markdown file.
- [x] For each specialized file, choose one explicit policy: include by a reliable fact, include with its parent capability, or keep packaged but do not auto-include yet.
- [x] Do not delete authentication, streaming, PWA, custom-rendering, or native-plug-in guidance only because no reliable first-pass signal exists.
- [x] Split mixed Markdown only when an existing section needs a different template condition, such as router guidance inside `CORE.md`.
- [x] Avoid broad Dioxus content rewrites during the infrastructure change.

### Inclusion matrix

| Fragment | Policy | Selection condition |
| --- | --- | --- |
| `context/dioxus/CORE.md` | Include by a reliable fact | Any workspace package declares a Dioxus dependency. |
| `context/dioxus/ROUTER.md` | Include by a reliable fact | Authoritative dependency or feature metadata declares router use. |
| `context/dioxus/desktop/00-SETUP.md` | Include with its parent capability | Desktop is declared or reached through a default-feature path. |
| `context/dioxus/desktop/10-DESKTOP.md` | Include with its parent capability | Desktop is declared or reached through a default-feature path. |
| `context/dioxus/desktop/20-CUSTOM-RENDERING.md` | Include with its parent capability | Desktop is declared or reached through a default-feature path. |
| `context/dioxus/fullstack/00-SETUP.md` | Include with its parent capability | Full-stack is declared or reached through a default-feature path. |
| `context/dioxus/fullstack/10-FULLSTACK.md` | Include with its parent capability | Full-stack is declared or reached through a default-feature path. |
| `context/dioxus/fullstack/20-AUTH.md` | Include with its parent capability | Full-stack is declared or reached through a default-feature path. |
| `context/dioxus/fullstack/30-REALTIME-STREAMING.md` | Include with its parent capability | Full-stack is declared or reached through a default-feature path. |
| `context/dioxus/mobile/00-SETUP.md` | Include with its parent capability | Mobile is declared or reached through a default-feature path. |
| `context/dioxus/mobile/10-MOBILE.md` | Include with its parent capability | Mobile is declared or reached through a default-feature path. |
| `context/dioxus/mobile/20-NATIVE-PLUGIN.md` | Include with its parent capability | Mobile is declared or reached through a default-feature path. |
| `context/dioxus/server/00-SETUP.md` | Include with its parent capability | Server is declared or reached through a default-feature path. |
| `context/dioxus/server/10-SERVER.md` | Include with its parent capability | Server is declared or reached through a default-feature path. |
| `context/dioxus/web/00-SETUP.md` | Include with its parent capability | Web is declared or reached through a default-feature path. |
| `context/dioxus/web/10-WEB.md` | Include with its parent capability | Web is declared or reached through a default-feature path. |
| `context/dioxus/web/20-PWA.md` | Include with its parent capability | Web is declared or reached through a default-feature path. |

### Acceptance checks

- [x] Every existing Dioxus Markdown file is present below `context/dioxus/` or has an explicit recorded merge target.
- [x] Every retained fragment has one documented template-selection policy.
- [x] General Dioxus guidance is separate from platform and optional-capability guidance.
- [x] No old top-level Dioxus platform path remains in package references.

## Work Unit 6: Implement Dioxus project facts

- [x] Add `context/dioxus/facts.ts` with the standard default facts-loader export.
- [x] Keep the Dioxus facts type and pure metadata parser in the same source module.
- [x] Include only fields used by the generated header or template conditions.
- [x] Start with these facts unless the final inclusion matrix proves that fewer or more are required:
  - workspace package names that declare Dioxus
  - declared Dioxus version requirements
  - direct dependency features
  - forwarded Dioxus features
  - Dioxus features reached through each package default-feature path
  - supported platforms from `web`, `desktop`, `mobile`, `native`, and `server`
  - booleans for `fullstack` and `router`
- [x] Run `cargo metadata --format-version 1 --no-deps` with `execFile` and no shell.
- [x] Run Cargo in the preload project directory.
- [x] Pass the source abort signal to Cargo.
- [x] Set a bounded stdout buffer for metadata.
- [x] Do not run Cargo unless the `dioxus` source is selected.
- [x] Do not run a Cargo build or execute build scripts.
- [x] Parse only workspace packages from valid metadata.
- [x] Detect normal, target-specific, optional, workspace-inherited, and renamed dependencies whose package name is `dioxus`.
- [x] Track the local dependency key for renamed dependencies so forwarded entries such as `<alias>/web` are recognized.
- [x] Read direct dependency features from Cargo metadata.
- [x] Read forwarded feature entries for the Dioxus dependency key, including weak dependency-feature syntax when Cargo reports it.
- [x] Resolve local feature references recursively from `default` before deriving default Dioxus features.
- [x] Prevent cycles during recursive local-feature resolution.
- [x] Detect router use from authoritative dependency or feature metadata, not from a name guess.
- [x] Sort every emitted package, requirement, feature, and platform list.
- [x] Return `undefined` when valid Cargo metadata contains no Dioxus dependency.
- [x] Distinguish declared, forwarded, and default features; do not call them active build features.
- [x] Add another repository signal only when a retained fragment has a clear need and that signal is reliable.
- [x] Report clear Cargo start, Cargo exit, output-limit, and JSON-parse failures.

### Acceptance checks

- [x] Direct, workspace-inherited, renamed, target-specific, and optional Dioxus dependencies are detected.
- [x] Renamed dependency feature forwarding is detected through its local alias.
- [x] Direct, forwarded, and recursively reached default features remain separate.
- [x] Valid non-Dioxus Cargo metadata returns `undefined`.
- [x] Equal metadata produces byte-identical facts.
- [x] Detection does not claim command-line feature activation.

## Work Unit 7: Build the Dioxus template and selection policy

- [x] Add `context/dioxus/index.md.njk`.
- [x] Add a short generated header with detected packages, version requirements, declared features, and default features.
- [x] Always include `context/dioxus/CORE.md` after Dioxus is detected.
- [x] Include full-stack guidance only when full-stack capability is declared or reached through the selected default path.
- [x] Include server guidance only when server capability is declared or reached through the selected default path.
- [x] Include web guidance only when web capability is declared or reached through the selected default path.
- [x] Include desktop guidance only when desktop capability is declared or reached through the selected default path.
- [x] Include mobile guidance only when mobile capability is declared or reached through the selected default path.
- [x] Include router guidance only when router use is detected.
- [x] Apply the inclusion matrix from Work Unit 5 to authentication, streaming, PWA, custom-rendering, and native-plug-in fragments.
- [x] Use static package-relative include paths in the template.
- [x] Keep condition logic in the root template and guidance in Markdown fragments.
- [x] Remove duplicate guidance only when conditional splitting creates an exact duplicate.
- [x] Do not add broad API catalog content while moving or splitting fragments.

### Acceptance checks

- [x] Core guidance appears for every detected applicable Dioxus project.
- [x] Each platform section appears only for its matching declared or default capability.
- [x] Router guidance does not appear without router use.
- [x] Every specialized document follows its recorded inclusion policy.
- [x] The root template is readable as the complete context-selection policy.
- [x] No context appears when the facts loader finds no Dioxus dependency.

## Work Unit 8: Update the existing unit tests

- [x] Update `test/unit.test.ts`; do not create another unit-test file.
- [x] Add one helper that narrows text blocks before `.text` access so image blocks remain type-safe.
- [x] Preserve existing static preload assertions except where safe text-block narrowing is required.
- [x] Add configuration tests for context inheritance, first-position deduplication, and ordering.
- [x] Add tests for unsafe context names and missing convention entry files.
- [x] Add a temporary package-owned context fixture with `facts.ts`, `index.md.njk`, and Markdown includes to test the generic convention without a registry.
- [x] Test that an unselected temporary source is not imported.
- [x] Test that a source returning `undefined` adds no block.
- [x] Test invalid default exports and source-scoped import, execution, and render errors.
- [x] Test strict undefined handling and deterministic final-newline normalization.
- [x] Test dynamic block order before files and tree.
- [x] Test per-dynamic-block and combined-context byte limits.
- [x] Add pure Dioxus parser tests with inline Cargo metadata objects for direct, workspace, renamed, optional, and target-specific dependencies.
- [x] Add parser tests for direct features, alias-based forwarded features, recursive default features, feature cycles, platforms, full-stack, router, and no Dioxus dependency.
- [x] Add Dioxus renderer tests for every condition in the inclusion matrix.
- [x] Keep invalid UTF-8, binary image, selected-file sorting, tree, and metrics tests valid.

### Acceptance checks

- [x] Generic source tests do not depend on the Dioxus implementation.
- [x] Dioxus parser tests do not execute Cargo.
- [x] Renderer tests prove both inclusion and exclusion for each conditional section.
- [x] Existing static behavior remains covered.

## Work Unit 9: Update the existing end-to-end test

- [ ] Update `test/e2e.test.ts`; do not create another end-to-end file.
- [ ] Keep the existing static preload case.
- [ ] Add an isolated Cargo workspace fixture.
- [ ] Add a local path package whose package name is `dioxus` so the test needs no registry download.
- [ ] Give the local package only the minimal feature declarations needed by Cargo metadata.
- [ ] Configure the fixture with `extends: ["dioxus-rust"]` and at least one selected project file.
- [ ] Select a clear capability set, such as web plus server/full-stack, through forwarded and default features.
- [ ] Keep `PI_OFFLINE=1` in the Pi process environment.
- [ ] Ensure Cargo metadata cannot require a network request.
- [ ] Assert that the hidden custom message contains the Dioxus context block first, selected files next, and `TREE.txt` last.
- [ ] Assert that selected Dioxus sections are present.
- [ ] Assert that desktop, mobile, and every other unselected optional section are absent.
- [ ] Assert that selected-file count and byte metrics remain file-only where accessible.

### Acceptance checks

- [ ] The end-to-end test does not download Dioxus.
- [ ] It does not run a Cargo build or build script.
- [ ] It proves convention-based source loading through the real Pi extension runtime.
- [ ] It proves dynamic, static, and tree block ordering.

## Work Unit 10: Package and document the convention

- [ ] Confirm that the existing `package.json` `files` entry for `context` includes facts loaders, templates, and Markdown fragments.
- [ ] Do not add a duplicate package-files entry for `context`.
- [ ] Confirm that the existing `presets` entry includes `presets/dioxus-rust.yml`.
- [ ] Update dependency and development-dependency metadata with exact runtime versions where required by repository policy.
- [ ] Update `package-lock.json` consistently.
- [ ] Update `README.md` with the `contexts` field and `dioxus-rust` preset.
- [ ] Add this minimal project example:

  ```yaml
  extends:
    - "dioxus-rust"
  files:
    - "Cargo.toml"
    - "Dioxus.toml"
    - "src/**/*.rs"
    - "tailwind.css"
  ```

- [ ] State that Dioxus detection reports repository-declared capabilities, not command-line active features.
- [ ] State that Cargo must be available when `dioxus` is selected.
- [ ] State that context modules, templates, and fragments are package-owned and cannot come from the project.
- [ ] Document the `context/<name>/facts.ts` and `context/<name>/index.md.njk` convention for future package maintainers.
- [ ] State that a future source needs only its self-contained directory and an optional preset, with no central registration edit.
- [ ] Apply one consistent package version increase to `package.json` and `package-lock.json` if this additive feature is released.

### Acceptance checks

- [ ] `npm pack --dry-run` lists `presets/dioxus-rust.yml`, `context/dioxus/facts.ts`, `context/dioxus/index.md.njk`, and all included Markdown.
- [ ] A production package install contains Nunjucks and all source runtime files.
- [ ] Documentation does not describe a registry or project-provided executable template.

## Work Unit 11: Run final validation

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run check` as the final combined code verification.
- [ ] Run `npm pack --dry-run` and inspect the package file list.
- [ ] Run `collectPreload` against an isolated Dioxus workspace with selected web and server/full-stack facts.
- [ ] Confirm that desktop and mobile guidance is absent from that result.
- [ ] Run a static-only preload and confirm that no context module or Cargo process runs.
- [ ] Confirm dynamic block bytes, total context bytes, selected-file count, and selected-file bytes.
- [ ] Confirm that `TREE.txt` remains the final block.
- [ ] Confirm that the worktree contains only intended source, context, preset, test, documentation, dependency, and lock changes.
- [ ] Commit the implementation with a minimal accurate message.

## Completion criteria

- [ ] A configured context name resolves directly to `context/<name>/` with no registry or central source-specific branch.
- [ ] A future package-owned context source can be added without changing generic collector code.
- [ ] `extends: ["dioxus-rust"]` enables facts-based Dioxus context generation.
- [ ] The Dioxus template is the readable source of fragment-selection policy.
- [ ] All current Dioxus Markdown is accounted for under `context/dioxus/`.
- [ ] Static preload behavior remains compatible.
- [ ] Dynamic context obeys cancellation and byte limits.
- [ ] Project code and project templates are never loaded as context implementations.
- [ ] Unit, end-to-end, combined, and package checks pass.
