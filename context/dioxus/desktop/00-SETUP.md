# Desktop Initial Setup

Use this layer only when creating or enabling a desktop target.

Enable the renderer directly for a desktop-only crate, or through a crate feature in a multi-renderer crate:

```toml
[features]
default = ["desktop"]
desktop = ["dioxus/desktop"]
```

Use `dioxus::launch(App)` when the default window is sufficient. Use `dioxus::LaunchBuilder::desktop().with_cfg(...)` only when initial window configuration is required.

Add `Dioxus.toml` when packaging needs application or bundle metadata:

```toml
[application]
name = "application-name"

[bundle]
identifier = "com.example.application"
publisher = "Example"
```

Run:

```sh
dx serve --platform desktop
```
