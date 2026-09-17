# Implement the Hierarchical `.preloadignore` Policy While Preserving Contexts

## Work Unit 1: Complete the Rename and Separate File Policy from Extra Behavior

- [ ] Complete the hard rename to `pi-preload` across package metadata, source constants, custom message types, errors, tests, fixtures, skills, documentation, workflows, schemas, remotes, package references, and active installation state, with no alias, fallback reader, compatibility path, or tracked legacy identifier left behind.

- [ ] Keep `agents.ts`, YAML loading, strict AGENTS section validation, `extends`, preset inheritance, explicit `contexts` selection, and future non-file preload capabilities while removing only the `files` field, configured file globs, and AGENTS-owned file ignore behavior from the schema and runtime pipeline.

- [ ] Keep preset loading for contexts and other non-file behavior, retain `presets/dioxus-rust.yml`, migrate file-selection behavior out of presets and into project `.preloadignore` files, remove only presets that become empty after that migration, and retain every YAML, TypeBox, Nunjucks, or mapping dependency still used by AGENTS extras or contexts.

- [ ] Make `<cwd>/.preloadignore` the sole activation gate and file-selection policy while treating the `pi-preload` AGENTS section as optional extra configuration, so an absent AGENTS file or absent `pi-preload` section yields empty `extends` and `contexts` rather than disabling file preload.

## Work Unit 2: Implement Root Activation and Hierarchical File Selection

- [ ] Add exact dependency `@secretlint/walker@13.0.5`, create `defaults/.preloadignore` from the current built-in file exclusions, include it in the package manifest, and add a repository-root `.preloadignore` that acts as this project’s activation and override file.

- [ ] At `session_start`, preserve the existing trust and duplicate-message checks, test only `<ctx.cwd>/.preloadignore`, and return before status, context loading, file traversal, or snapshot generation when that exact root activation file is absent.

- [ ] Replace configured Globby candidates and Git-aware filtering with `walk` rooted at `ctx.cwd`, load `defaults/.preloadignore` as the first rule layer, use `.preloadignore` as the root and nested project ignore filename, disable symbolic-link following, and keep untracked child extension repositories reachable in the meta workspace.

- [ ] Convert every admitted file to stable CWD-relative metadata and pass it through the existing regular-file, UTF-8 text, binary-image, deterministic ordering, concurrency, file-count, per-file byte, and total-context byte pipeline without restoring AGENTS-owned file globs.

- [ ] Define admitted binary handling for the ignore-policy model so project rules can select supported images without weakening the existing rejection of unsupported binary content, and cover the retained behavior in the existing tests.

## Work Unit 3: Preserve AGENTS Extras and Preload Contexts

- [ ] Preserve the `context/` loaders, templates, reference assets, Nunjucks rendering, per-context byte checks, context block serialization, and context tests as production capabilities independent from file selection.

- [ ] Resolve `extends` through the existing preset pipeline after root `.preloadignore` activation, merge inherited and project `contexts` in deterministic order, validate context names, and load only the contexts explicitly selected by the resolved AGENTS extras.

- [ ] Preserve the Dioxus facts loader’s Cargo metadata analysis, platform, full-stack, and router facts, retain `presets/dioxus-rust.yml` as an explicit context-selection preset, and do not replace explicit selection with automatic execution in unrelated projects.

- [ ] Keep rendered context blocks in the preload result and serialized snapshot with stable ordering, preserve the combined context byte limit, and keep the Dioxus specialized skill registered separately from context rendering.

## Work Unit 4: Move the Snapshot and Finish Runtime Integration

- [ ] Create `<ctx.cwd>/.pi` after activation, write the single validated snapshot to `<ctx.cwd>/.pi/PRELOAD.md`, update generated snapshot exclusions to `.pi/PRELOAD.md` and `.pi/TREE.md`, and remove all root `PRELOAD.md` and `TREE.txt` constants, writes, ignores, and tracked snapshots.

- [ ] Rename the hidden custom message type and status identity to `pi-preload`, send the preserved context and file blocks without triggering a turn, and keep the existing notification count and byte reporting accurate for the new walker-backed result.

## Work Unit 5: Migrate Repository Policy, Skills, Documentation, and Tests

- [ ] Remove only the `files` policy from this repository’s `pi-preload` AGENTS section, keep `extends` and explicit `contexts`, update schemas and fixtures to the reduced non-file configuration, replace the legacy authoring skill with guidance for both `.preloadignore` file policy and AGENTS extras, retain `dioxus-specialized`, and revise the existing signatures task so signature mode remains an AGENTS-managed extra over files admitted by `.preloadignore`.

- [ ] Update `README.md`, package metadata, repository examples, and integration fixtures to describe exact-root activation, packaged defaults, project override order, nested subtree rules, CWD file collection, AGENTS-managed `extends` and `contexts`, meta-workspace child repositories, and `.pi/PRELOAD.md` without documenting AGENTS-owned file globs.

- [ ] Update `test/unit.test.ts` to cover missing and present root activation, optional AGENTS extras, strict `extends` and `contexts` validation, preset merge order, explicit context selection, packaged-default precedence, project overrides, nested inheritance, sibling isolation, walker file metadata, retained text and image handling, Dioxus context rendering, ordering, and all existing byte and file-count limits.

- [ ] Update `test/e2e.test.ts` to cover inactive sessions, file preload with no AGENTS extras, direct repository activation, independent activation from `pi-tree`, a meta-workspace with nested child `.preloadignore` files, explicitly selected rendered contexts, untracked child repositories, no traversal outside the session CWD, the exact `.pi/PRELOAD.md` snapshot, and the `pi-preload` hidden message type.

## Work Unit 6: Validate, Publish, and Activate

- [ ] Run `npm run check`, a clean full install, a clean production-only install, a credential-free production extension-load check, and `git diff --check`, then correct every failure without adding a new test suite.

- [ ] Rename and verify the Forgejo and GitHub repositories and local remotes, commit the `pi-preload` repository with a minimal accurate message, push the commit to Forgejo before GitHub, remove the active legacy package through Pi package management, install only the pushed `pi-preload` remote, reload Pi, and verify root activation, nested meta-workspace policy, retained Dioxus context output, `.pi/PRELOAD.md`, and absence of every active legacy identifier.
