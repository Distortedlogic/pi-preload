# pi-context-preload

Preload trusted project context from file globs and package-owned dynamic context sources.

## Configuration

Add `CONTEXT_PRELOAD.yml` to the project root.

- `files` selects project files with globs.
- `contexts` selects package-owned dynamic context sources by name.
- `extends` loads package presets before the local configuration.

The collector keeps the configured context order. It removes repeated context names at their first occurrence. Dynamic context blocks come before selected file blocks. `TREE.txt` is always the last block.

## Dioxus preset

The `dioxus-rust` preset enables the package-owned Dioxus context source. Use this minimal project configuration:

```yaml
extends:
  - "dioxus-rust"
files:
  - "Cargo.toml"
  - "Dioxus.toml"
  - "src/**/*.rs"
  - "tailwind.css"
```

You can also select the source directly:

```yaml
contexts:
  - "dioxus"
```

Cargo must be available when the `dioxus` source is selected. The source runs `cargo metadata --format-version 1 --no-deps`. It does not run a build or a build script.

Dioxus detection reports capabilities that repository Cargo files declare. It does not report features that a command line activates for one build.

## Dynamic context source convention

Each source is one self-contained package directory:

```text
context/<name>/
├── facts.ts
├── index.md.njk
└── <package-owned Markdown fragments>
```

`facts.ts` has one default loader with this contract:

```typescript
type ContextFactsLoader = (input: {
  cwd: string;
  signal: AbortSignal;
}) => Promise<Record<string, unknown> | undefined>;
```

The loader returns normalized facts when the source applies. It returns `undefined` when the source does not apply. The root template receives only `{ facts }`. It selects and orders static Markdown fragments below the package context root.

Context modules, templates, and fragments are package-owned. A project cannot provide executable context modules or templates.

To add a future source, add its self-contained `context/<name>/` directory. You can add an optional preset that selects the name. No central registration edit is necessary.
