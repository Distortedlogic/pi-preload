---
name: pi-preload-authoring
description: Use when creating, changing, or auditing the top-level pi-preload object in a repository AGENTS.yml. Do not use for other AGENTS.yml sections.
---

# AGENTS.yml pi-preload section

## Keys

`pi-preload/agents.ts` accepts only `presets`, `extends`, `includes`, `excludes`, and `contexts`.

- `extends` takes paths to other project directories.
- `contexts` takes packaged context sources that generate Markdown from the project. `dioxus` is the only source.
- Presets are `pi-extension` and `dioxus-rust`.

A preset cannot use `extends`, and each preset pattern must be absolute.

## Selection

Edit only the `pi-preload` section. Keep the other top-level keys.

Name root files explicitly. Use a directory and suffix glob for source, so a renamed file stays matched. Use only the suffixes that the directory holds.

For a repository from the Copier template, start from `pi-extensions/template/AGENTS.yml`.

Do not select lock files, secrets, generated or vendored directories, binary assets, or large fixtures. The extension also ignores Git-ignored files, lock files, `AGENTS.yml`, `PRELOAD.md`, and `TREE.txt`. Do not use that safeguard to justify a wide glob.

## Limits

`pi-preload/src/index.ts` sets 1,000 files, 256 KiB for each file and each context block, and 2 MiB total. A file must be UTF-8 text. A binary file is accepted only as an image that an explicit path names.

The extension collects at session start and writes `PRELOAD.md`. The current session shows no result. Check `PRELOAD.md` at the next session.
