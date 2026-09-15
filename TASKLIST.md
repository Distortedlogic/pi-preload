# PRELOAD.md Implementation Plan

## Work unit 1: Define the snapshot format

- [ ] Add a `PRELOAD_FILE` constant with the value `PRELOAD.md` next to the existing `TREE_FILE` constant, and define the generated file as a snapshot of every final `PreloadBlock` in the same order that `collectPreload()` returns them.
- [ ] Add a small serializer that copies text block content without changing it, converts each image block to a Markdown data URL that keeps its MIME type and base64 payload, joins blocks with a stable blank-line delimiter, and appends a final newline.

## Work unit 2: Prevent recursive preload input

- [ ] Add `PRELOAD_FILE` to the ignore list in `collectFilesystemTree()` so the generated snapshot never appears in `TREE.txt`.
- [ ] Add `PRELOAD_FILE` to the selected-file `globby()` ignore list so no configuration pattern, including an explicit pattern, can load the generated snapshot into the next preload.

## Work unit 3: Save the completed preload

- [ ] Refactor the final part of `collectPreload()` to store the filesystem-tree block, append it to `blocks`, and complete the existing total-byte validation before snapshot serialization starts.
- [ ] Serialize the validated final `blocks` array and write it to `resolve(cwd, PRELOAD_FILE)` with UTF-8 encoding and the active abort signal before `collectPreload()` returns.
- [ ] Keep the existing return contract unchanged so `count` and `bytes` continue to report only selected source files, while `blocks` continues to contain the exact context sent through `pi.sendMessage()`.

## Work unit 4: Ignore the generated artifact

- [ ] Add `/PRELOAD.md` to the repository `.gitignore` so the root-level generated snapshot stays local and cannot be committed by accident.

## Work unit 5: Update existing test coverage

- [ ] Update `test/unit.test.ts` to verify that `collectPreload()` creates `PRELOAD.md` and that its serialized sections follow the returned block order for generated context, selected text files, and `TREE.txt`.
- [ ] Update `test/unit.test.ts` to run collection again after `PRELOAD.md` exists and verify that the file is overwritten, is absent from selected preload blocks, and is absent from the generated filesystem tree.
- [ ] Update the existing image preload case in `test/unit.test.ts` to verify that the snapshot stores the image block as a Markdown data URL with the correct MIME type and base64 payload.
- [ ] Update `test/e2e.test.ts` only where its current startup coverage can verify that a successful session preload leaves `PRELOAD.md` on disk without changing the hidden custom-message content or notification statistics.

## Work unit 6: Validate and finish

- [ ] Run `npm run check` and correct all type-check, lint, unit-test, and end-to-end test failures caused by the implementation.
- [ ] Review `git diff`, run `git diff --check`, confirm that no generated `PRELOAD.md` is tracked, and commit the completed implementation with a minimal accurate commit message.
