# Dioxus 0.7.10 Mobile Rules

Use this context only for Dioxus iOS and Android targets.

## 1. Use the Dioxus mobile renderer

Enable mobile support through Cargo features:

```toml
[features]
mobile = ["dioxus/mobile"]
```

Use the Dioxus CLI for the target platform:

```sh
dx serve --platform ios
dx serve --platform android
```

Do not add a separate SwiftUI, Jetpack Compose, React Native, or TypeScript UI unless the product explicitly requires a separate native surface.

## 2. Keep application UI and state in shared Rust

Use the same Dioxus components, signals, stores, loaders, actions, and routing model as other targets.

Keep domain logic and most UI code platform-independent. Isolate platform-specific imports and calls behind target configuration.

Do not duplicate the application state model in Swift or Kotlin.

## 3. Put mobile metadata in `Dioxus.toml`

Use `Dioxus.toml` for bundle and mobile configuration.

Typical sections include:

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

Add only settings that the application needs. Do not move this configuration into custom scripts without a technical requirement.

## 4. Declare permissions in the Dioxus manifest

Declare mobile permissions in `Dioxus.toml` through the unified permission configuration.

```toml
[permissions]
location = { precision = "fine", description = "Use location for the requested application feature" }
```

Let the Dioxus CLI map permissions to Android and iOS metadata.

Request and inspect permission state through Dioxus or the native plug-in interface. Do not silently assume that a permission is granted.

## 5. Use native plug-ins only when Dioxus has no native API

First check for an existing Dioxus mobile API or supported Rust crate.

When native integration is necessary, use `#[manganis::ffi]` to connect Rust to Swift or Kotlin. Keep native source in the platform project structure expected by the Dioxus CLI.

Keep the Rust interface typed. Serialize only the data that must cross the FFI boundary.

Do not add a JavaScript bridge when Dioxus native FFI is available. Do not add a native plug-in for functionality already exposed by Dioxus.

## 6. Keep platform implementations separate

Use target guards for native bindings:

```rust
#[cfg(target_os = "ios")]
```

```rust
#[cfg(target_os = "android")]
```

Provide a clear unsupported-platform result when shared code can run on web or desktop without the native implementation.

Do not spread target checks through ordinary components. Keep them at platform boundaries.

## 7. Use Dioxus assets and mobile-safe layout

Bundle static assets with `asset!`.

Use Tailwind or CSS assets for styling. Account for safe-area insets and small screens in CSS.

Do not generate mobile CSS in Rust or TypeScript. Do not load known bundled assets from arbitrary filesystem paths.

## 8. Keep mobile work asynchronous

Permission prompts, location work, files, network calls, and native operations must not block the UI thread.

Use `use_action` for user-triggered operations and `use_future` for lifecycle background work. Store results in signals or stores.

Show pending, denied, unsupported, and failed states in the UI.

## 9. Configure remote server functions

Set the full-stack server URL for mobile clients when it cannot be inferred:

```rust
#[cfg(not(feature = "server"))]
dioxus::fullstack::set_server_url("https://api.example.com");
```

Use environment or build configuration for different deployments. Do not hard-code local development addresses into release builds.

Call generated Dioxus server functions directly. Do not build a second mobile REST client for them.

## 10. Keep advanced native features optional

Background modes, widgets, Live Activities, custom Gradle modules, and custom Swift packages are specialized requirements.

Add them only when the task explicitly requires them. They are not part of the default Dioxus mobile application structure.
