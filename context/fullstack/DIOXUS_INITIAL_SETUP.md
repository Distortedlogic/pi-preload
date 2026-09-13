# Dioxus 0.7.10 Full-Stack Initial Setup

Use this context when a task creates a Dioxus full-stack application or converts a client-only Dioxus project to full-stack operation.

## 1. Select the client renderers

A full-stack project needs the server target and at least one client renderer.

Configure shared full-stack and routing support, then select renderers through crate features:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["fullstack", "router"] }
serde = { version = "1", features = ["derive"] }

[features]
default = ["web"]
web = ["dioxus/web"]
desktop = ["dioxus/desktop"]
mobile = ["dioxus/mobile"]
server = ["dioxus/server"]
```

Keep only the client features that the product supports. Keep server-only dependencies optional and attach them to `server`.

## 2. Use one shared Rust application

```rust
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        Router::<Route> {}
    }
}
```

Keep shared components, routes, request types, response types, errors, and server-function signatures in Rust.

Do not create a separate TypeScript frontend or duplicate REST model.

## 3. Add the first server function with an HTTP verb macro

```rust
#[get("/api/greeting/{name}")]
async fn greeting(name: String) -> Result<String> {
    Ok(format!("Hello, {name}"))
}
```

Call it directly from client code. Dioxus generates the client operation and registers the normal server endpoint.

Do not create a `reqwest` client for an internal server function. Use `#[server]` only for an anonymous endpoint or compatibility requirement.

## 4. Use `use_loader` and `use_action`

Use `use_loader` for data required during rendering:

```rust
let greeting = use_loader(|| greeting("world".to_string()))?;
```

Put loader content under `SuspenseBoundary` and `ErrorBoundary` where necessary.

Use `use_action` for user-triggered calls and mutations:

```rust
let mut save = use_action(save_item);
```

Do not build custom pending, result, and cancellation state when the action already provides it.

## 5. Separate server-only implementation

Use feature guards for secrets, databases, process-wide state, and server-only dependencies:

```rust
#[cfg(feature = "server")]
```

Keep the shared server-function signature visible to the client build while Dioxus replaces its implementation with the generated client call.

Do not leak server configuration into browser or native client artifacts.

## 6. Use Dioxus-native state and responses

Use `std::sync::LazyLock` for synchronously initialized process state. Use `dioxus::fullstack::Lazy` for asynchronously initialized process state.

Use Dioxus types for forms, headers, cookies, redirects, files, streams, WebSockets, and HTTP errors.

Create request extensions only for request-specific resources.

Do not add a custom Axum router unless required middleware, injected state, or a non-Dioxus route makes it necessary.

## 7. Configure client server URLs by renderer

Web full-stack builds normally use the current origin.

Desktop and mobile clients can require an explicit server URL. Supply it through build or deployment configuration with `dioxus::fullstack::set_server_url`.

Do not hard-code local development addresses into production clients.

## 8. Set up the selected client feature

Follow the matching feature setup file:

- web: `context/web/DIOXUS_INITIAL_SETUP.md`
- desktop: `context/desktop/DIOXUS_INITIAL_SETUP.md`
- mobile: `context/mobile/DIOXUS_INITIAL_SETUP.md`
- server: `context/server/DIOXUS_INITIAL_SETUP.md`

Use the selected client feature's asset, styling, manifest, and CLI conventions.

## 9. Keep the default server path

Use `dioxus::launch` for standard full-stack startup.

Use `dioxus::serve` and `dioxus::server::router(App)` only when required server integration needs a custom router.

Do not start from raw Axum by default.

## 10. Complete the setup check

Confirm that:

- the project enables `dioxus/fullstack`
- one or more intended client renderers are configured
- the server target enables `dioxus/server`
- shared API types remain in Rust
- internal calls use generated server functions
- render data uses `use_loader`
- explicit operations use `use_action`
- server-only code and secrets are feature-gated
- desktop and mobile server URLs use deployment configuration
- no unnecessary Axum, JavaScript, TypeScript, or duplicate HTTP layer was added
