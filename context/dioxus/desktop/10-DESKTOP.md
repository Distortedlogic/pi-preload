# Desktop Runtime

- Call Rust code in the same process directly. Do not add HTTP, server functions, or JavaScript IPC between local Rust components.
- Use `dioxus::desktop::window()` before Tao, Wry, or direct WebView APIs.
