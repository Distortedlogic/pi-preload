# Split Filesystem Tree Into pi-tree Implementation Plan

## Work unit 1: Set the extension boundary

- [ ] Make `pi-context-preload` responsible only for loading configured context sources and files, enforcing the 1 MiB preload limit, sending the hidden `context-preload` message, and writing `PRELOAD.md`.
- [ ] Make `pi-tree` responsible only for collecting the bounded filesystem tree, sending one hidden `pi-tree` message, and writing `TREE.txt` for every trusted project without reading or requiring `AGENTS.yml`.
- [ ] End the current coupling between preload negation patterns and tree exclusions so `pi-context-preload` keeps applying `!` patterns to selected preload files while `pi-tree` uses only its fixed exclusions.

## Work unit 2: Create the pi-tree package

- [ ] Create `/home/entropybender/pi-extensions/pi-tree` as a single-file Pi extension package with `index.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `biome.json`, `.gitignore`, `README.md`, and `LICENSE`, using the local Pi extension authoring conventions.
- [ ] Define `package.json` with the name `pi-tree`, version `0.1.0`, Node `>=22.19.0`, `./index.ts` as both the package export and Pi extension entry, the standard typecheck, lint, test, and check scripts, and only the files required by the installed package.
- [ ] Add `globby` as the only non-Pi runtime dependency, add `@earendil-works/pi-coding-agent` as a peer dependency, add the existing Node, TypeScript, and Biome development tools, and generate a reproducible `package-lock.json`.
- [ ] Add root `TREE.txt` to the new repository `.gitignore` so the runtime artifact cannot be committed.

## Work unit 3: Extract the filesystem tree collector

- [ ] Move the tree-specific constants and process setup from `pi-context-preload/index.ts` into `pi-tree/index.ts`, including `MAX_TREE_BYTES`, `TREE_FILE`, `TREE_BLOCK_HEADING`, `MAX_TREE_OUTPUT_BYTES`, `ON_DEMAND_TREE_DIRECTORIES`, and the promisified `execFile` function.
- [ ] Copy `LOCK_FILE_GLOBS` into `pi-tree/index.ts` because both extensions need the list for different operations and a shared package would create unnecessary coupling.
- [ ] Move `exceededTreeAllocation()`, `renderFilesystemTree()`, and `collectFilesystemTree()` into `pi-tree/index.ts`, export `collectFilesystemTree()` for direct tests, and change its public parameters to only `cwd` and `signal`.
- [ ] Keep the existing `globby` scan behavior with dot entries, `.gitignore` support, unique results, no symbolic-link traversal, directory entries, and fixed exclusions for Git data, lock files, `AGENTS.yml`, `PRELOAD.md`, and `TREE.txt`.
- [ ] Keep the existing test-directory behavior that shows a root test directory but omits entries below any `test`, `tests`, or `__tests__` ancestor.
- [ ] Keep the existing bounded rendering algorithm that calls the system `tree` program through `execFile`, accepts complete depth levels while output fits, attempts top-level folder expansion at the next depth, treats `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` as the size boundary, and propagates all other failures.
- [ ] Keep abort support on filesystem writes and the child process, remove the temporary directory in `finally`, write the accepted raw tree with one final newline to `<cwd>/TREE.txt`, and return one text block with the `File: TREE.txt` heading.

## Work unit 4: Register the pi-tree lifecycle behavior

- [ ] Add a default extension factory with `CUSTOM_TYPE` set to `pi-tree` and a 30-second deadline, then register one `session_start` handler that exits before filesystem access when the project is not trusted.
- [ ] Detect an existing tree message in the active compaction-aware branch by matching current `custom_message` entries with `customType === "pi-tree"` and legacy `message` entries whose message has role `custom` and the same custom type, then skip collection when either form exists.
- [ ] Set a `pi-tree` status while collection runs, create the timeout signal, call `collectFilesystemTree(ctx.cwd, signal)`, and send its returned block through `pi.sendMessage()` with `display: false` and `triggerTurn: false`.
- [ ] Report successful collection with one concise information notification, report failures with the original error detail and rethrow them, and always clear the `pi-tree` status in `finally`.

## Work unit 5: Remove tree ownership from pi-context-preload

- [ ] Remove the tree-only Node imports, constants, process setup, and helper functions from `pi-context-preload/index.ts` while retaining `TREE_FILE` as the generated filename that preload selection must always ignore.
- [ ] Remove the `collectFilesystemTree()` call and tree block append from `collectPreload()`, then serialize and write `PRELOAD.md` immediately after the existing context-and-heading byte validation succeeds.
- [ ] Remove `MAX_TREE_BYTES` and the final `MAX_TOTAL_BYTES + MAX_TREE_BYTES` check so the returned preload blocks are governed only by the existing 1 MiB preload limit.
- [ ] Keep `TREE_FILE` in the selected-file `globby()` ignore list so broad or explicit preload patterns cannot load the artifact owned by `pi-tree`.
- [ ] Keep `ignorePatterns` in the preload candidate scan but stop passing them to tree code, and preserve the current `collectPreload()` return contract where `count` and `bytes` describe selected source files only.
- [ ] Update the preload duplicate check to recognize current `custom_message` entries as well as legacy custom messages so reload and resume do not append another `context-preload` message.
- [ ] Update the `pi-context-preload` package description and bump its pre-1.0 minor version from `0.2.0` to `0.3.0` to mark removal of the built-in tree feature.

## Work unit 6: Move and adjust existing tests

- [ ] Move the existing filesystem-tree cases from `pi-context-preload/test/unit.test.ts` into the `pi-tree` Node test suite instead of rewriting them around a new test framework or a private Pi harness.
- [ ] Make the `pi-tree` unit coverage call the exported collector with real temporary directories and verify normal output, fixed exclusions, `.gitignore` handling, nested test-directory filtering, symbolic-link behavior, the 16 KiB allocation behavior, abort propagation, command failures, and temporary-directory cleanup.
- [ ] Add a small `pi-tree` end-to-end case through the public Pi extension API or `pi --mode rpc --no-session` that verifies trusted startup writes `TREE.txt`, appends one hidden `pi-tree` message, and does not require provider credentials.
- [ ] Update `pi-context-preload/test/unit.test.ts` so expected blocks and `PRELOAD.md` snapshots no longer contain `File: TREE.txt`, tree-only fixtures and command setup are removed, and `TREE.txt` remains impossible to select as a preload input.
- [ ] Update the existing preload end-to-end test only where needed to verify that startup still sends one hidden `context-preload` message and writes `PRELOAD.md` without invoking the system `tree` program.
- [ ] Add one integration assertion that loading both extensions produces exactly one preload message and one tree message, keeps `TREE.txt` out of `PRELOAD.md`, keeps `PRELOAD.md` out of `TREE.txt`, and does not duplicate either message after reload or resume.

## Work unit 7: Update focused documentation

- [ ] Write the `pi-tree` README with its trusted-project startup behavior, `TREE.txt` output, hidden context block format, fixed exclusions, 16 KiB limit, system `tree` requirement, and remote installation source.
- [ ] Remove filesystem-tree claims from the `pi-context-preload` README and point users who need that behavior to the separate `pi-tree` package without changing unrelated preload documentation.
- [ ] Update only the tree-related text in `skills/context-preload-authoring/SKILL.md` so the skill no longer states that preload negation patterns control the filesystem tree.

## Work unit 8: Validate and deliver both packages

- [ ] Run `npm run check` in `pi-context-preload` and `pi-tree`, then correct all typecheck, Biome, unit-test, and end-to-end failures without weakening checks or adding compatibility workarounds.
- [ ] Run a clean full install and a clean `--omit=dev` production install for each package, then perform a production extension-load check without provider credentials and confirm that the system reports a clear error when the external `tree` executable is unavailable.
- [ ] Run a final trusted-project check with both extensions enabled and confirm that `PRELOAD.md` contains only preload context, `TREE.txt` contains only the filesystem tree, and the active session contains one hidden message from each extension.
- [ ] Review both repository diffs, run `git diff --check`, confirm that no generated `PRELOAD.md`, `TREE.txt`, temporary file, credential, or local installation path is tracked, and confirm that both working trees contain only the intended split changes.
- [ ] Commit `pi-context-preload` with the minimal message `Remove filesystem tree preload`, commit `pi-tree` with the minimal message `Add filesystem tree extension`, push the new package to its remote, and install it only from that remote if installation is part of the delivery.
