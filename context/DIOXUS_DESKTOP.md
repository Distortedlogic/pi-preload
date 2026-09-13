# Dioxus 0.7.10 Desktop Rules

Use this context only for Dioxus desktop targets.

## 1. Use the Dioxus desktop renderer

Enable desktop support through Cargo features:

```toml
[features]
desktop = ["dioxus/desktop"]
```

Use:

```sh
dx serve --platform desktop
```

Launch with `dioxus::launch` when default desktop behavior is sufficient. Use `dioxus::LaunchBuilder::desktop()` only when desktop configuration is required.

Do not add Electron, a TypeScript shell, or a custom IPC layer.

## 2. Use Rust directly for local capabilities

Desktop components can use normal Rust crates and operating-system APIs for files, databases, networking, and other local work.

Keep this work in Rust. Use Dioxus signals and actions to connect it to the UI.

Do not create a local HTTP server only to let the Dioxus desktop UI call Rust code in the same process.

## 3. Use Dioxus desktop configuration

Configure the window through `dioxus::desktop::Config` and `WindowBuilder` when necessary:

```rust
use dioxus::desktop::{Config, WindowBuilder};
use dioxus::prelude::*;

fn main() {
    dioxus::LaunchBuilder::desktop()
        .with_cfg(Config::new().with_window(WindowBuilder::new()))
        .launch(App);
}
```

Use the smallest configuration that meets the requirement. Do not create a custom event loop for normal desktop applications.

## 4. Use Dioxus window APIs

Use `dioxus::desktop::window()` for normal window operations such as:

- title changes
- minimize, maximize, and fullscreen state
- window dragging
- decorations and always-on-top state
- closing or hiding a window
- zoom

Use Dioxus desktop hooks for window events, menus, tray icons, global shortcuts, and additional windows only when the product requires them.

Do not call the underlying WebView or Tao API when a Dioxus desktop operation exists.

## 5. Use Dioxus async state

Use `use_action` for user-triggered local or remote work. Use `use_future` for long-running background tasks. Use signals or stores for results that affect UI.

Do not block the UI thread with filesystem, database, or network work. Do not build a custom message bus when a Dioxus hook is sufficient.

## 6. Use the Dioxus asset pipeline

Use `asset!` for files known at build time.

Use `use_asset_handler` only for content that must be produced or selected at runtime, such as a dynamic local stream.

Do not use an asset handler for ordinary CSS, images, fonts, or other static files.

## 7. Use Tailwind and CSS assets for styling

Use Tailwind classes for normal application styling. Use CSS assets for rules that belong in a stylesheet.

Do not generate desktop CSS in Rust. Do not add TypeScript to style the desktop WebView.

## 8. Configure full-stack desktop clients correctly

A desktop client cannot always infer the server location. Set it when the application calls remote Dioxus server functions:

```rust
#[cfg(not(feature = "server"))]
dioxus::fullstack::set_server_url("http://127.0.0.1:8080");
```

Use configuration for production URLs. Do not hard-code a development URL into a production build.

Call generated server functions directly. Do not replace them with a manual REST client.

## 9. Keep platform-specific code narrow

Guard desktop-only imports and behavior with the desktop feature or target configuration when the crate supports more than one renderer.

Keep shared components and domain state platform-independent where possible.

Transparent overlays, child WebViews, custom WGPU rendering, multi-window systems, and tray applications are specialized designs. Do not introduce them into an ordinary desktop application.
