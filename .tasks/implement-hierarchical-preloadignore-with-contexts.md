# Implement the Hierarchical `.preloadignore` Policy While Preserving Contexts

## Work Unit 1: Complete the Rename and Remove AGENTS-Based Preload Configuration

- [ ] Complete the hard rename to `pi-preload` across package metadata, source constants, custom message types, errors, tests, fixtures, skills, documentation, workflows, schemas, remotes, package references, and active installation state, with no alias, fallback reader, compatibility path, or tracked legacy identifier left behind.

- [ ] Remove `agents.ts`, YAML configuration loading, AGENTS section lookup, file and context configuration schemas, preset inheritance, configured include globs, and AGENTS-specific validation while preserving file decoding, images, ordering, byte limits, trust checks, timeout behavior, context facts loading, context rendering, context assets, and the independently registered Dioxus skill.

- [ ] Remove configuration-only presets after migrating their retained behavior, convert the Dioxus preset’s context selection into automatic context applicability, and remove only the YAML, TypeBox, Globby, or other dependencies that have no remaining production use.

## Work Unit 2: Implement Root Activation and Hierarchical File Selection

- [ ] Add exact dependency `@secretlint/walker@13.0.5`, create `defaults/.preloadignore` from the current built-in file exclusions, include it in the package manifest, and add a repository-root `.preloadignore` that acts as this project’s activation and override file.

- [ ] At `session_start`, preserve the existing trust and duplicate-message checks, test only `<ctx.cwd>/.preloadignore`, and return before status, context loading, file traversal, or snapshot generation when that exact root activation file is absent.

- [ ] Replace configured Globby candidates and Git-aware filtering with `walk` rooted at `ctx.cwd`, load `defaults/.preloadignore` as the first rule layer, use `.preloadignore` as the root and nested project ignore filename, disable symbolic-link following, and keep untracked child extension repositories reachable in the meta workspace.

- [ ] Convert every admitted file to stable CWD-relative metadata and pass it through the existing regular-file, UTF-8 text, binary-image, deterministic ordering, concurrency, file-count, per-file byte, and total-context byte pipeline without restoring include globs or AGENTS configuration.

- [ ] Define admitted binary handling for the ignore-policy model so project rules can select supported images without weakening the existing rejection of unsupported binary content, and cover the retained behavior in the existing tests.

## Work Unit 3: Preserve and Decouple Preload Contexts

- [ ] Preserve the `context/` loaders, templates, reference assets, Nunjucks rendering, per-context byte checks, context block serialization, and context tests as production capabilities independent from file selection.

- [ ] Replace the AGENTS-provided context-name list with deterministic discovery of packaged context sources, evaluate each source after root `.preloadignore` activation, and require each facts loader to return `undefined` when the current CWD is not applicable rather than removing the context capability.

- [ ] Update the Dioxus facts loader so non-Dioxus projects are a clean non-match while valid Dioxus projects retain Cargo metadata analysis, platform, full-stack, and router facts, and retain descriptive failures for actual metadata execution or decoding errors.

- [ ] Keep rendered context blocks in the preload result and serialized snapshot with stable ordering, preserve the combined context byte limit, and keep the Dioxus specialized skill registered separately from automatic context rendering.

## Work Unit 4: Move the Snapshot and Finish Runtime Integration

- [ ] Create `<ctx.cwd>/.pi` after activation, write the single validated snapshot to `<ctx.cwd>/.pi/PRELOAD.md`, update generated snapshot exclusions to `.pi/PRELOAD.md` and `.pi/TREE.md`, and remove all root `PRELOAD.md` and `TREE.txt` constants, writes, ignores, and tracked snapshots.

- [ ] Rename the hidden custom message type and status identity to `pi-preload`, send the preserved context and file blocks without triggering a turn, and keep the existing notification count and byte reporting accurate for the new walker-backed result.

## Work Unit 5: Migrate Repository Policy, Skills, Documentation, and Tests

- [ ] Remove preload policy from this repository’s `AGENTS.yml`, delete obsolete preload schemas and fixtures, replace the legacy AGENTS authoring skill with `pi-preload` `.preloadignore` authoring guidance, retain `dioxus-specialized`, and rewrite or remove the stale AGENTS-based signatures task so it cannot direct later work toward the deleted configuration model.

- [ ] Update `README.md`, package metadata, repository examples, and integration fixtures to describe exact-root activation, packaged defaults, project override order, nested subtree rules, CWD collection, automatic applicable contexts, meta-workspace child repositories, and `.pi/PRELOAD.md` without documenting an AGENTS configuration key.

- [ ] Update `test/unit.test.ts` to cover missing and present root activation, packaged-default precedence, project overrides, nested inheritance, sibling isolation, walker file metadata, retained text and image handling, deterministic context discovery, non-applicable contexts, Dioxus context rendering, ordering, and all existing byte and file-count limits.

- [ ] Update `test/e2e.test.ts` to cover inactive sessions, direct repository activation, independent activation from `pi-tree`, a meta-workspace with nested child `.preloadignore` files, preserved rendered contexts, untracked child repositories, no traversal outside the session CWD, the exact `.pi/PRELOAD.md` snapshot, and the `pi-preload` hidden message type.

## Work Unit 6: Validate, Publish, and Activate

- [ ] Run `npm run check`, a clean full install, a clean production-only install, a credential-free production extension-load check, and `git diff --check`, then correct every failure without adding a new test suite.

- [ ] Rename and verify the Forgejo and GitHub repositories and local remotes, commit the `pi-preload` repository with a minimal accurate message, push the commit to Forgejo before GitHub, remove the active legacy package through Pi package management, install only the pushed `pi-preload` remote, reload Pi, and verify root activation, nested meta-workspace policy, retained Dioxus context output, `.pi/PRELOAD.md`, and absence of every active legacy identifier.
