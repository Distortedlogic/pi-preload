# Desktop Runtime

- Desktop components can call local Rust libraries directly. Do not insert a local HTTP or JavaScript IPC layer between the UI and Rust code in the same process.
- Use `LaunchBuilder::desktop().with_cfg(Config::new().with_window(...))` only for initial desktop configuration.
- In a multi-renderer entry point, use `LaunchBuilder::new().with_cfg(desktop! { ... }).with_cfg(native! { ... })` for renderer-specific launch configuration.
- Use `dioxus::desktop::window()` for window state and operations before using Tao or the WebView directly.
- Use `use_wry_event_handler` when a required Tao/Wry event has no higher-level Dioxus hook.
- Additional windows use a new `VirtualDom`; pass explicit root props or context to that virtual DOM.
- Dioxus desktop supplies native menu, tray, global-shortcut, and window-close behavior APIs. Do not recreate these through browser JavaScript.
- Use `use_asset_handler` only for runtime-generated or dynamically selected content. Static files remain `asset!` assets.
- A desktop full-stack client can require `dioxus::fullstack::set_server_url`; the web renderer normally does not.
