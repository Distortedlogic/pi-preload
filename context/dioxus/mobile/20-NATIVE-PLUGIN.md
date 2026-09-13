# Mobile Native Plug-Ins

Use a plug-in only after Dioxus and maintained Rust packages do not provide the native capability.

## Generated native bindings

Use Manganis FFI with the native package directory:

```rust
#[cfg(target_os = "ios")]
#[manganis::ffi("src/ios/plugin")]
extern "Swift" {
    pub type NativePlugin;
}

#[cfg(target_os = "android")]
#[manganis::ffi("src/android")]
extern "Kotlin" {
    pub type NativePlugin;
}
```

- Match generated Rust type and function declarations to native class names and signatures.
- Keep the application-facing API typed in Rust; decode any bridge JSON at that boundary.
- Use an Android Gradle library and an iOS Swift package in the paths consumed by the FFI attribute.
- Let the Dioxus CLI build and bundle these native modules.

## Manifest integration

- Put bundle identity, deployment targets, Android SDK values, background modes, native features, and supported permissions in `Dioxus.toml`.
- The Dioxus permission manifest maps unified permissions to platform metadata.
- `[[ios.widget_extensions]]` declares a bundled widget source, display name, bundle suffix, deployment target, and module name.
- An ActivityKit plug-in and widget must compile the same `ActivityAttributes` type under the same Swift module identity.

## Target boundaries

- Gate Swift and Kotlin bindings with `target_os`.
- Supply a typed fallback implementation for other renderers so shared Rust code reports an unsupported platform instead of failing to compile.
- Use `use_action` at the component boundary for user-triggered native calls.
