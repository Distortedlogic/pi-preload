---
name: pi-preload-authoring
description: Use when creating, changing, or auditing the top-level pi-preload object in a repository AGENTS.yml. Do not use for other AGENTS.yml sections.
---

# AGENTS.yml pi-preload section

## Keys

`pi-preload/agents.ts` accepts only `presets`, `extends`, `includes`, `signatures`, `excludes`, and `contexts`.

- `extends` takes paths to other project directories.
- `includes` selects complete file content.
- `signatures` selects source with callable bodies folded. It supports `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`, `.py`, `.rs`, and `.go`.
- `contexts` takes packaged context sources that generate Markdown from the project. `dioxus` is the only source.
- Presets are `pi-extension` and `dioxus-rust`.

A preset cannot use `extends`, and each preset pattern must be absolute.

## Selection

Edit only the `pi-preload` section. Keep the other top-level keys.

Name root files explicitly. Use a directory and suffix glob for source, so a renamed file stays matched. Use only the suffixes that the directory holds.

For a repository from the Copier template, start from `pi-extensions/template/AGENTS.yml`.

Preset patterns merge before the current project patterns. Extended project scopes merge before the scope that names them. If `includes` and `signatures` select the same resolved file, `includes` wins and loads the complete file.

```yaml
pi-preload:
  presets:
    - pi-extension
  extends:
    - ../shared
  includes:
    - package.json
  signatures:
    - src/**/*.ts
  excludes:
    - src/generated/**
```

Do not select lock files, secrets, generated or vendored directories, binary assets, or large fixtures. The extension also ignores Git-ignored files, lock files, `AGENTS.yml`, `PRELOAD.md`, and `TREE.txt`. Do not use that safeguard to justify a wide glob.

## Limits

`pi-preload/src/index.ts` sets 1,000 unique files, 256 KiB for each original file and emitted block, and 2 MiB for all emitted context. A full-mode file must be UTF-8 text unless an explicit path selects an image. A signature-mode file must be supported UTF-8 source and cannot be binary. Original source bytes and emitted context bytes are counted separately.

The extension collects at session start and writes `PRELOAD.md`. The current session shows no result. Check `PRELOAD.md` at the next session.
