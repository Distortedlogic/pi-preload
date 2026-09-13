# Dioxus 0.7.10 Desktop Initial Setup

Use this context when a task creates a Dioxus desktop application or adds the desktop renderer to an existing Rust project.

## 1. Configure the desktop renderer

For a desktop-only application:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["desktop", "router"] }
```

For a project that selects renderers through crate features:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["router"] }

[features]
default = ["desktop"]
desktop = ["dioxus/desktop"]
```

Enable only the features that the application uses. Do not add a browser framework, Electron, or TypeScript shell.

## 2. Create the desktop entry point

Use the default launch path when no window configuration is necessary:

```rust
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        main { "Desktop application" }
    }
}
```

Use `LaunchBuilder::desktop()` only when the task requires explicit desktop configuration.

## 3. Add window configuration only when required

```rust
use dioxus::desktop::{Config, WindowBuilder};
use dioxus::prelude::*;

fn main() {
    dioxus::LaunchBuilder::desktop()
        .with_cfg(Config::new().with_window(WindowBuilder::new()))
        .launch(App);
}
```

Keep the configuration small. Do not create a custom event loop for a normal desktop application.

## 4. Use the normal desktop project layout

```text
Cargo.toml
Dioxus.toml
src/
  main.rs
assets/
tailwind.css
```

Use `Dioxus.toml` for application and bundle metadata when packaging requires it:

```toml
[application]
name = "application-name"

[bundle]
identifier = "com.example.application"
publisher = "Example"
```

## 5. Set up assets and styling

Use `asset!` for files known at build time. Attach styles with `Stylesheet`.

Create a root `tailwind.css` file:

```css
@import "tailwindcss";
@source "./src/**/*.{rs,html,css}";
```

Use Tailwind classes or CSS assets. Do not generate CSS in Rust. Do not add TypeScript to style the desktop WebView.

## 6. Use Rust for local capabilities

Call filesystem, database, networking, and operating-system libraries directly from Rust.

Use `use_action` for user-triggered work and `use_future` for background work. Do not block the UI thread.

Do not create a local HTTP or IPC layer only to call Rust code in the same process.

## 7. Start the desktop application

```sh
dx serve --platform desktop
```

Use the Dioxus CLI for development and packaging. Do not add a separate desktop frontend toolchain.

## 8. Complete the setup check

Confirm that:

- the active Cargo feature enables `dioxus/desktop`
- the entry point uses `dioxus::launch` or the necessary desktop `LaunchBuilder`
- bundle metadata is in `Dioxus.toml`
- static assets use `asset!`
- application styling uses Tailwind or CSS assets
- local work remains in Rust
- no unnecessary WebView, event-loop, IPC, Axum, Electron, or TypeScript layer was added
