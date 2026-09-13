# Mobile Initial Setup

Use this layer only when creating or enabling an iOS or Android target.

Enable the renderer through a crate feature:

```toml
[features]
default = ["mobile"]
mobile = ["dioxus/mobile"]
```

Use `dioxus::launch(App)` with shared Rust UI.

Create `Dioxus.toml` for native metadata:

```toml
[bundle]
identifier = "com.example.application"
publisher = "Example"

[ios]
deployment_target = "16.2"

[android]
min_sdk = 24
target_sdk = 34
```

Declare Dioxus-supported native permissions in the same manifest:

```toml
[permissions]
location = { precision = "fine", description = "Use location for this application feature" }
```

Add `src/ios/` or `src/android/` only for a required native module.

Run the selected target:

```sh
dx serve --platform ios
dx serve --platform android
```
