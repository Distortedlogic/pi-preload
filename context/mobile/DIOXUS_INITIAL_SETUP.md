# Dioxus 0.7.10 Mobile Initial Setup

Use this context when a task creates a Dioxus iOS or Android application or adds mobile targets to an existing Rust project.

## 1. Configure the mobile renderer

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["router"] }

[features]
default = ["mobile"]
mobile = ["dioxus/mobile"]
```

Enable only the Dioxus features that the project uses. Keep optional platform dependencies behind the matching target or feature configuration.

Do not add React Native, a TypeScript UI, SwiftUI, or Jetpack Compose for the main application surface.

## 2. Create the shared Rust entry point

```rust
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        main { "Mobile application" }
    }
}
```

Keep normal components and domain state shared between iOS and Android. Isolate native behavior at platform boundaries.

## 3. Create `Dioxus.toml`

Set bundle identity and platform requirements:

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

Use values that match the product and supported toolchains. Do not copy example identifiers into a real application.

## 4. Declare required permissions

Put supported permission metadata in `Dioxus.toml`:

```toml
[permissions]
location = { precision = "fine", description = "Use location for the requested application feature" }
```

Add only permissions that implemented features require. Give each permission a clear user-facing reason.

Do not add duplicate Android or iOS permission metadata unless Dioxus cannot generate a required platform entry.

## 5. Use the normal mobile project layout

```text
Cargo.toml
Dioxus.toml
src/
  main.rs
assets/
tailwind.css
```

Add `src/android/` or `src/ios/` only when a required native plug-in needs platform source.

## 6. Set up assets and responsive styling

Use `asset!` for static assets.

Create a root Tailwind source:

```css
@import "tailwindcss";
@source "./src/**/*.{rs,html,css}";
```

Use Tailwind and CSS media rules for small screens and safe-area insets.

Do not generate CSS in Rust or TypeScript. Do not edit generated Tailwind output.

## 7. Configure remote server functions when used

A mobile client cannot infer a remote server in all deployments. Supply the correct full-stack server URL through build or environment configuration.

Call generated Dioxus server functions directly. Do not create a second REST client for internal application APIs.

Do not hard-code a local development URL into a release build.

## 8. Install and verify platform toolchains

For iOS, verify the required Xcode, simulator, signing, and deployment-target setup.

For Android, verify the required SDK, NDK, Java, emulator, minimum SDK, and target SDK setup.

Use the Dioxus CLI to create and run platform builds. Do not add a second native build pipeline without a required unsupported artifact.

## 9. Start the selected mobile target

```sh
dx serve --platform ios
dx serve --platform android
```

Run the command for the target under development.

## 10. Complete the setup check

Confirm that:

- the active Cargo feature enables `dioxus/mobile`
- the Rust entry point uses current Dioxus APIs
- bundle identifiers and platform targets are correct
- permissions are minimal and declared in `Dioxus.toml`
- assets use `asset!`
- styling supports mobile size and safe areas
- server URLs come from deployment configuration
- native source exists only for a required plug-in
- no unnecessary JavaScript, TypeScript, or second UI framework was added
