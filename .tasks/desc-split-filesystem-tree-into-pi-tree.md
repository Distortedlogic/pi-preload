# Split Filesystem Tree Into pi-tree Implementation Plan

## Work unit 1: Create the pi-tree package

- [ ] Generate `/home/entropybender/pi-extensions/pi-tree` from the Copier template at `/home/entropybender/pi-extensions` with `project_name=pi-tree` and `project_description=Preload a bounded filesystem tree into Pi context`, initialize its `main` Git branch, and install the template pre-commit and pre-push hooks.
- [ ] Update `pi-tree/package.json` to add `globby` version `16.2.4` to `dependencies`, keep `@earendil-works/pi-coding-agent` as the only peer dependency used by the extension, and remove unused template peer dependencies.
- [ ] Run `npm install` in `pi-tree` to install dependencies and create `package-lock.json`.

## Work unit 2: Implement pi-tree

- [ ] Implement `pi-tree/src/index.ts` with the tree-specific Node imports, `LOCK_FILE_GLOBS`, `MAX_TREE_BYTES`, `TREE_FILE`, `PRELOAD_FILE`, `TREE_BLOCK_HEADING`, `MAX_TREE_OUTPUT_BYTES`, `ON_DEMAND_TREE_DIRECTORIES`, `DEADLINE_MS`, and the promisified `execFile` setup extracted from `pi-context-preload/index.ts`.
- [ ] Move `exceededTreeAllocation()`, `renderFilesystemTree()`, and `collectFilesystemTree()` into `pi-tree/src/index.ts`, export `collectFilesystemTree(cwd, signal)`, and preserve the current temporary-file cleanup, abort handling, depth reduction, top-level directory expansion, 16 KiB output limit, `TREE.txt` write, and returned `File: TREE.txt` text block.
- [ ] Configure the `collectFilesystemTree()` `globby` call to preserve the current dot-file, Git-ignore, uniqueness, directory, and symbolic-link behavior while excluding Git data, `AGENTS.yml`, `PRELOAD.md`, `TREE.txt`, lock files, and entries below `test`, `tests`, or `__tests__` directories.
- [ ] Register a `session_start` handler with custom type `pi-tree` that exits for an untrusted project or an active branch that already contains a `custom_message` entry with that custom type, runs collection with a 30-second timeout, sends the returned block with `display: false` and `triggerTurn: false`, reports collection errors, and clears its status in `finally`.

## Work unit 3: Remove tree handling from pi-context-preload

- [ ] Remove the `execFile`, temporary-directory, `tmpdir`, and `promisify` imports; remove the tree-size constants, `ON_DEMAND_TREE_DIRECTORIES`, `execFileAsync`, `exceededTreeAllocation()`, `renderFilesystemTree()`, and `collectFilesystemTree()`; and retain `TREE_FILE` only for preload input exclusion.
- [ ] Remove the filesystem-tree collection and block append from `collectPreload()`, remove the combined preload-plus-tree byte check, and write `PRELOAD.md` from the validated context and selected-file blocks before returning the existing `{ blocks, count, bytes }` result.
- [ ] Keep preload negation patterns in the selected-file `globby` ignore list and keep `TREE.txt` unconditionally excluded from selected preload files without passing preload patterns to `pi-tree`.

## Work unit 4: Update the existing tests

- [ ] Replace the template `pi-tree/test/unit.test.ts` with a real-temporary-directory test for `collectFilesystemTree()` that verifies the returned block matches `TREE.txt`, visible source and dot files remain, existing `PRELOAD.md` and `TREE.txt` are excluded, Git data, Git-ignored files, lock files, and `AGENTS.yml` are excluded, and a root test directory remains while its descendants are omitted.
- [ ] Replace the template `pi-tree/test/e2e.test.ts` with `RpcClient` startup tests that load only `pi-tree`, verify a trusted project without `AGENTS.yml` receives one hidden `pi-tree` message and `TREE.txt`, and verify an untrusted project receives neither.
- [ ] Update `pi-context-preload/test/unit.test.ts` to remove tree assertions and tree-position slicing, make `PRELOAD.md` expectations contain only dynamic-context and selected-file blocks, change the undefined-facts case to expect no blocks, change the image case to expect two blocks, and pre-create `TREE.txt` in the generated-file exclusion case to verify that it cannot become preload input.
- [ ] Update `pi-context-preload/test/e2e.test.ts` so the valid preload and Dioxus cases expect no tree block and no `TREE.txt`, while the absent, invalid, and untrusted configuration cases retain their existing preload behavior.

## Work unit 5: Validate and commit

- [ ] Run `pre-commit run --all-files`, `npm run check`, and `PI_OFFLINE=1 npm run test:e2e` in `pi-tree`, then run `npm run check` in `pi-context-preload` and correct failures caused by the split.
- [ ] Verify each package with a clean `npm ci`, a clean `npm ci --omit=dev`, and a production Pi extension-load check without provider credentials.
- [ ] Run `git diff --check` in both repositories, commit the `pi-context-preload` changes with `Remove filesystem tree preload`, and commit the new `pi-tree` repository with `Add filesystem tree extension`.
