# Web Initial Setup

Use this layer only when creating or enabling a web target.

Enable the renderer directly for a web-only crate, or through a crate feature in a multi-renderer crate:

```toml
[features]
default = ["web"]
web = ["dioxus/web"]
```

Use `dioxus::launch(App)` as the entry point. Add `router` only when the application has routes.

The usual source layout is:

```text
Cargo.toml
src/main.rs
assets/
tailwind.css
```

Add `Dioxus.toml` only for web CLI settings such as the application name, output directory, public asset directory, base path, custom HTML, or watcher configuration.

Run:

```sh
dx serve --platform web
```

Do not add another web bundler or development server.
