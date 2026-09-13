# Desktop Runtime

- Desktop components can call local Rust libraries directly. Do not insert a local HTTP or JavaScript IPC layer between the UI and Rust code in the same process.
- Use `dioxus::desktop::window()` for window state and operations before using Tao or the WebView directly.
