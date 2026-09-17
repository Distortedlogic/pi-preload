---
name: preload-ignore-authoring
description: Use when creating, changing, or auditing a repository .preloadignore file for pi-preload.
---

# Preload Ignore Authoring

Edit only the `.preloadignore` file at the repository root.

## Rules

- Use gitignore pattern syntax.
- Make each pattern relative to the repository root.
- Use a leading `/` when a pattern must match only at the root.
- Use a trailing `/` to ignore a directory.
- Use `!` only when a file below an ignored path must be included.
- Keep rules short and specific.
- Do not put preload selection rules in `AGENTS.yml`.

## Procedure

1. Read the existing `.preloadignore` file if it exists.
2. Identify generated, private, binary, or large files that must not enter preload context.
3. Add the smallest set of patterns that excludes those files.
4. Remove duplicate, obsolete, and ineffective patterns.
5. Check that required source and reference files are not excluded.
