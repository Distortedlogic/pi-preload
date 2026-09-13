# Dioxus 0.7.10 Native Plug-In Rules

Use this context only when a Dioxus mobile or desktop task requires a native Swift or Kotlin API that Dioxus and available Rust packages do not expose.

## 1. Confirm that a plug-in is necessary

Check these options in order:

1. A Dioxus API.
2. A maintained Rust package with target support.
3. A maintained Dioxus-compatible native plug-in.
4. A new native plug-in.

Do not write a native plug-in when an existing package covers the requirement.

## 2. Keep the public API in Rust

Define one typed Rust interface for the application. Keep Swift and Kotlin details behind that interface.

Use Rust structs and enums for inputs, outputs, permission states, and errors. Derive Serde traits only for values that cross the native boundary.

Do not let platform-specific JSON shapes spread into components.

## 3. Use Manganis FFI

Use `#[manganis::ffi]` to generate native bindings.

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

Match Rust declarations to native names and signatures exactly. Keep the binding surface small.

Do not create a JavaScript bridge or hand-written JNI layer when Manganis supports the interface.

## 4. Use the expected native project structure

Keep Android code in a Gradle library structure under the plug-in source directory. Keep package names, namespace, SDK levels, and native class names consistent.

Keep iOS code in a Swift package structure. Keep package, product, target, module, and exposed class names consistent.

Do not scatter generated native projects through the Rust source tree.

## 5. Put bundle and permission metadata in `Dioxus.toml`

Declare bundle identifiers, deployment targets, SDK levels, platform features, background modes, and permissions in `Dioxus.toml` when Dioxus supports them.

Let the Dioxus CLI map unified permissions to Android and iOS metadata.

Do not maintain duplicate permission declarations unless the native platform requires an additional entry that Dioxus cannot generate.

## 6. Keep permission flow explicit

Expose separate operations to:

- inspect permission state
- request permission
- perform the protected native operation

Return granted, denied, and prompt states to Rust. Show these states in the Dioxus UI.

Do not trigger a native permission prompt without a user action and a clear application reason.

## 7. Keep serialization narrow and validated

When the FFI transport requires text, serialize a small typed request and response. Deserialize it immediately at the Rust boundary.

Convert native failures into a Rust error enum. Validate missing fields, invalid JSON, null native results, and unsupported states.

Do not pass arbitrary JSON through the application after the boundary.

## 8. Do not block the UI thread

Native permission, location, file, sensor, and network work can be asynchronous.

Use the platform callback or asynchronous API and expose a Dioxus-compatible operation. Use `use_action` for user-triggered calls.

Do not wait on a semaphore or busy loop on the UI thread. If the generated FFI interface is synchronous, move blocking work off the UI thread or redesign the boundary.

## 9. Provide unsupported-platform behavior

Use target guards for native implementations. Provide a clear Rust error for targets that do not support the plug-in.

```rust
#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod fallback {
    // Return a typed unsupported-platform error.
}
```

Do not silently return empty data on an unsupported platform.

## 10. Keep shared platform types consistent

When an iOS plug-in and widget share an ActivityKit type, keep one source of truth for the attributes and content state.

Keep Android and Rust field names aligned through an explicit serialization convention such as camel case.

Do not define similar but incompatible protocol types in each platform module.

## 11. Let the Dioxus CLI own native bundling

Use the project paths and metadata that `dx` expects. Let the CLI build and bundle native modules with the application.

Do not add a second native packaging pipeline unless a required platform artifact cannot use the Dioxus flow.

## 12. Test each native boundary

Test these cases on each supported platform:

- plug-in initialization
- permission not determined
- permission granted
- permission denied
- successful native response
- native error
- timeout or cancellation
- unsupported platform fallback

Keep native unit tests in the native package when the repository already has native test support. Test the Rust boundary separately from the UI.
