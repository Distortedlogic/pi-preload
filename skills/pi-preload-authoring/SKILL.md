---
name: pi-preload-authoring
description: Use when creating, changing, or auditing a repository AGENTS.yml top-level pi-preload object. Applies the local repository-mapping, source-glob, exclusion, and preload-limit rules.
---

# Local AGENTS.yml preload procedure

## Map the repository

Start at the repository root:

```sh
ls -la
tree -a -L 3 -I '.git|node_modules|.venv|venv|__pycache__|dist|build|coverage|target'
```

Use another narrow `tree` command for a source area that needs more depth. Do not increase depth for the complete repository.

Identify the root files, workspace or package roots, primary source directories, and central test or standards files that an agent commonly needs for generic questions and tasks.

Do not read lock files while mapping.

## Build the configuration

Edit the top-level `pi-preload` section in the root `<cwd>/AGENTS.yml`. Do not replace the complete document. Preserve unrelated top-level keys and other extension-owned sections. Use `extends` and `files` with quoted string lists. Shared presets use the same inner format.

Name useful root files explicitly. Do not use `**/*` at the repository root.

Use directory and programming-language suffix globs for source code. This keeps renamed and new source files in context:

```yaml
pi-preload:
  extends:
    - "common"
  files:
    - "package.json"
    - "tsconfig.json"
    - "src/**/*.{py,ts,rs}"
pi-modes:
  review: "Review the changes."
pi-prompts:
  prompts:
    summarize:
      body: "Summarize the changes."
```

Use only suffixes found in the target source directory.

For selected monorepo packages, prefer narrow brace globs:

```yaml
pi-preload:
  extends: []
  files:
    - "packages/{core,extension}/{package.json,tsconfig.json}"
    - "packages/{core,extension}/src/**/*.{ts,tsx}"
```

Use explicit paths for suffixless files and selected root configuration. Use a parent or sibling glob only when it is commonly required for work in this repository.

Include tests or documentation only when they are small and commonly needed for general work. Target their narrow directories and useful suffixes.

## Exclusions

The manifest must not select:

- lock files
- `.env` files or credentials
- Git-ignored files
- dependency, cache, build, coverage, or generated directories
- binary assets or model weights
- large snapshots, fixtures, exports, or machine-generated JSON
- vendored source

The preload extension also applies Git ignore rules and default lockfile exclusions. Do not depend on those safeguards to justify a broad manifest.

## Validate

Run the actual preload collector. Inspect matched paths, file count, and total bytes without printing all file contents.

Current limits:

- 1,000 files
- 256 KiB per file
- 1 MiB total source bytes
- valid UTF-8 text only

Confirm that:

- important explicit root files match
- primary source files match through suffix globs
- a source-file rename would remain matched
- no lock, secret, ignored, generated, binary, or low-utility bulk file matches
- all limits pass

If the selection is too large, narrow source directories before removing useful explicit root files.
