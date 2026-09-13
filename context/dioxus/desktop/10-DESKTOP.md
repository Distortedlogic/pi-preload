# Desktop Runtime

- Call local Rust libraries directly. Do not add local HTTP or JavaScript IPC between the desktop UI and Rust in the same process.
- Use `dioxus::desktop::window()` before Tao, Wry, or direct WebView APIs.
