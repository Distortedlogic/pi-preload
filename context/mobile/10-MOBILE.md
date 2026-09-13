# Mobile Runtime

- Keep normal UI and state in shared Rust. Isolate native calls behind `target_os` guards instead of duplicating the application model in Swift or Kotlin.
- `Dioxus.toml` is the source for bundle identity, iOS deployment and background settings, Android SDK and hardware features, and Dioxus-supported permissions.
- The unified `[permissions]` entries are mapped by the Dioxus CLI into native platform metadata.
- Request and inspect native permission state through Dioxus or the typed native boundary; declaration alone does not grant access.
- Add Swift or Kotlin modules only when Dioxus and maintained Rust packages do not expose the capability.
- A mobile full-stack client can require `dioxus::fullstack::set_server_url`; supply it from deployment configuration.
- Keep safe-area handling in CSS, including `env(safe-area-inset-*)`, rather than platform-specific component duplication.
- Widgets, Live Activities, background modes, and native modules are manifest-driven optional layers, not default mobile structure.
