# pi-context-preload

Preload trusted project context from file globs and package-owned dynamic context sources.

## Configuration

Edit `pi.extensions.pi-context-preload` in the root `<cwd>/AGENTS.yml`. Preserve unrelated top-level keys and other `pi.extensions` entries.

```yaml
pi:
  extensions:
    pi-context-preload:
      extends:
        - "common"
      files:
        - "src/**/*.ts"
      contexts:
        - "dioxus"
    pi-modes:
      review: "Review the changes."
    pi-prompts:
      prompts:
        summarize:
          body: "Summarize the changes."
```

- `pi.extensions.pi-context-preload.files` selects project files with globs.
- `pi.extensions.pi-context-preload.contexts` selects package-owned dynamic context sources by name.
- `pi.extensions.pi-context-preload.extends` loads package presets before the local configuration.

The collector keeps the configured context order. It removes repeated context names at their first occurrence. Dynamic context blocks come before selected file blocks. `TREE.txt` is always the last block.

## Dioxus preset

The `dioxus-rust` preset enables the package-owned Dioxus context source. Use this minimal project configuration:

```yaml
pi:
  extensions:
    pi-context-preload:
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
pi:
  extensions:
    pi-context-preload:
      contexts:
        - "dioxus"
```

Cargo must be available when the `dioxus` source is selected. The source runs `cargo metadata --format-version 1 --no-deps`. It does not run a build or a build script.

The source first selects the Dioxus package whose manifest directory is the deepest parent of the current directory. Outside a package directory, it selects the only Dioxus workspace default member, then the only Dioxus workspace package. An ambiguous workspace receives core rules only.

Capability selection uses features on the selected package's normal `dioxus` dependency and forwarded features that its `default` feature graph reaches. Features from unrelated workspace packages and inactive feature declarations do not add context.

Automatic context contains core rules and only certain router, full-stack, and default-path renderer deltas. Project setup, Store state, advanced routing, authentication, streaming, custom server work, PWA work, desktop integration, and mobile native integration are in the packaged `dioxus-specialized` skill. Ordinary component edits do not need that skill.

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
