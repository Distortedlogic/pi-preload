# Dioxus 0.7.10 Web Initial Setup

Use this context when a task creates a Dioxus web application or adds the web renderer to an existing Rust project.

## 1. Configure the web renderer

For a web-only application:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["web", "router"] }
```

For a project that selects renderers through crate features:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["router"] }

[features]
default = ["web"]
web = ["dioxus/web"]
```

Enable only the Dioxus features that the application uses. Do not add desktop, mobile, server, or Axum dependencies to a web-only application.

## 2. Create the web entry point

```rust
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        Router::<Route> {}
    }
}
```

Use current Dioxus APIs. Do not generate `Scope`, `cx.render`, or `use_state` code from older Dioxus versions.

## 3. Use the normal web project layout

```text
Cargo.toml
Dioxus.toml
src/
  main.rs
assets/
tailwind.css
```

A small web-only application can omit `Dioxus.toml` when it does not need custom CLI, output, public asset, bundle, or HTML settings.

## 4. Configure web metadata only when required

Use `Dioxus.toml` for the application name, output directory, public asset directory, title, base path, and web watcher settings.

Use a custom `index.html` only when the task requires PWA registration or other document behavior that Dioxus document components cannot provide.

## 5. Set up assets

Use `asset!` for static files known at build time:

```rust
const MAIN_CSS: Asset = asset!("/assets/main.css");

#[component]
fn App() -> Element {
    rsx! {
        Stylesheet { href: MAIN_CSS }
    }
}
```

Use `document::Title`, `document::Meta`, `document::Link`, and `document::Script` for document-head content.

Do not create a static-file endpoint for normal bundled assets.

## 6. Set up Tailwind

Create `tailwind.css` at the project root:

```css
@import "tailwindcss";
@source "./src/**/*.{rs,html,css}";
```

Dioxus 0.7 manages the Tailwind watcher during development. Use Tailwind classes in `rsx!`.

Do not add TypeScript for styling. Do not generate CSS in Rust. Do not edit generated Tailwind output.

## 7. Start the web application

```sh
dx serve --platform web
```

Do not add another frontend development server or bundler.

## 8. Complete the setup check

Confirm that:

- the active Cargo feature enables `dioxus/web`
- the entry point uses `dioxus::launch`
- the project uses current signal and component APIs
- routing uses a typed `Routable` enum when routing is required
- assets use `asset!`
- Tailwind scans Rust source
- browser secrets and server-only dependencies are absent
- no unnecessary JavaScript, TypeScript, Axum, or manual HTTP layer was added
