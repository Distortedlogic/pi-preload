# Mobile native integration

Use a native plug-in only when Dioxus and maintained Rust packages do not provide the required capability. Request and inspect permission state through Dioxus or the typed native boundary; manifest declaration does not grant access.

Use Manganis FFI with the native package directories:

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

Match generated Rust declarations to native class names and signatures. Keep the application-facing API typed in Rust, and decode bridge JSON at that boundary. Use an Android Gradle library and an iOS Swift package in the paths used by the FFI attribute. Let the Dioxus CLI build and bundle them.

Keep bundle identity, deployment targets, Android SDK values, background modes, native features, and plug-in configuration in `Dioxus.toml`. Use `[[ios.widget_extensions]]` for a bundled widget source, display name, bundle suffix, deployment target, and module name. An ActivityKit plug-in and its widget must compile the same `ActivityAttributes` type under the same Swift module identity.

Supply a typed fallback for other renderers so shared Rust reports an unsupported platform instead of failing to compile.
