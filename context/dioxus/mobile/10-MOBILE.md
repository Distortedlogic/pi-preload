# Mobile Runtime

- Keep normal UI and state in shared Rust. Isolate native calls behind `target_os` guards instead of duplicating the application model in Swift or Kotlin.
- Put Dioxus-supported permissions in `Dioxus.toml`; the Dioxus CLI maps them into native platform metadata.
