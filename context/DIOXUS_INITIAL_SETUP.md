# Dioxus 0.7.10 Initial Setup

Use this context when a task creates a Dioxus project or adds Dioxus to an existing Rust project.

## 1. Select the application shape first

Choose these items before you add dependencies:

1. Select the target platforms: web, desktop, mobile, or more than one.
2. Decide whether the application is client-only or full-stack.
3. Decide whether typed routing is required.
4. Decide whether Tailwind is required. Use Tailwind for normal application styling.

Do not add all platform features by default. Enable only the platforms that the project uses.

## 2. Use Dioxus 0.7.10 APIs

Use current Dioxus APIs from `dioxus::prelude::*`.

Do not generate old Dioxus patterns such as:

- `Scope`
- `cx.render(...)`
- `use_state(cx, ...)`
- old component context arguments
- a default `#[server]` RPC design when an HTTP verb macro is suitable

## 3. Configure Cargo by application type

For a single-platform client application, enable the platform and required framework features directly:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["web", "router"] }
```

For a full-stack or multi-platform application, keep renderer selection in crate features:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["fullstack", "router"] }
serde = { version = "1", features = ["derive"] }

[features]
default = ["web"]
web = ["dioxus/web"]
desktop = ["dioxus/desktop"]
mobile = ["dioxus/mobile"]
server = ["dioxus/server"]
```

Add dependencies only when source code uses them. Keep server-only dependencies optional and connect them to the `server` feature.

Do not add Axum for ordinary Dioxus full-stack operation.

## 4. Use the standard project layout

Use this layout unless the existing repository has another convention:

```text
Cargo.toml
Dioxus.toml
src/
  main.rs
assets/
tailwind.css
```

Add only the files that the selected platforms need. A small client-only application does not always need `Dioxus.toml`.

## 5. Start with the current component form

```rust
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        main {
            h1 { "Dioxus application" }
        }
    }
}
```

Use `LaunchBuilder` only when launch or platform configuration is necessary.

## 6. Configure Dioxus metadata in `Dioxus.toml`

Use `Dioxus.toml` for Dioxus CLI and bundle configuration. Put these items there when required:

- application and bundle names
- bundle identifier and publisher
- web output and public asset settings
- iOS deployment and background settings
- Android SDK and feature settings
- mobile permissions

Do not move this metadata into custom Rust build code without a technical requirement.

## 7. Set up assets through Dioxus

Put static application files under `assets/` or the repository's selected public asset directory.

Declare compiled assets with `asset!`:

```rust
const MAIN_CSS: Asset = asset!("/assets/main.css");
```

Attach styles through Dioxus:

```rust
rsx! {
    Stylesheet { href: MAIN_CSS }
}
```

Do not create a static-file server for normal bundled assets.

## 8. Set up Tailwind at the project root

Use this root `tailwind.css` file:

```css
@import "tailwindcss";
@source "./src/**/*.{rs,html,css}";
```

Dioxus 0.7 detects this file and manages the Tailwind watcher during development.

Use Tailwind classes in `rsx!`. Rust can select classes from reactive state. Do not generate CSS in Rust or TypeScript. Do not edit generated Tailwind output.

## 9. Use the Dioxus CLI for the selected platform

Use the platform-specific Dioxus command:

```sh
dx serve --platform web
dx serve --platform desktop
dx serve --platform ios
dx serve --platform android
```

Use the command that matches the Cargo feature and project configuration. Do not add another frontend development server.

## 10. Complete the initial architecture check

Before feature work, confirm that:

- the project uses Dioxus 0.7.10 APIs
- only required platform features are enabled
- client and server code have clear feature boundaries
- normal RPC uses Dioxus server functions
- assets use `asset!`
- application styling uses Tailwind or CSS assets
- no unnecessary Axum, JavaScript, TypeScript, or manual HTTP layer was added
