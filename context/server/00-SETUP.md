# Dioxus 0.7.10 Server Initial Setup

Use this context when a task adds or configures the server target of a Dioxus full-stack application.

## 1. Treat the server feature as the Dioxus backend target

Configure Dioxus full-stack support and a server feature:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["fullstack"] }
serde = { version = "1", features = ["derive"] }

[features]
server = ["dioxus/server"]
```

Keep server-only dependencies optional and connect them to the `server` feature.

Do not create a separate Axum service for ordinary Dioxus server functions.

## 2. Keep one shared application entry point

Use `dioxus::launch(App)` when the default Dioxus server is sufficient:

```rust
use dioxus::prelude::*;

fn main() {
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    rsx! { main { "Full-stack application" } }
}
```

Use `dioxus::serve` only when required server setup must add middleware, non-Dioxus routes, or injected state.

## 3. Add server functions through HTTP verb macros

```rust
#[get("/api/message")]
async fn get_message() -> Result<String> {
    Ok("Hello from the server".to_string())
}
```

Prefer `#[get]`, `#[post]`, `#[put]`, and `#[delete]`. Let Dioxus register normal server functions.

Use `#[server]` only for an anonymous endpoint or compatibility requirement.

Do not create duplicate router handlers or a manual client request function.

## 4. Separate shared contracts from server implementation

Keep request types, response types, typed errors, and server-function signatures available to both builds.

Guard server-only imports, statics, database code, credentials, and implementation details:

```rust
#[cfg(feature = "server")]
```

Do not expose server secrets to client compilation.

## 5. Select server state by initialization and scope

Use `std::sync::LazyLock<T>` for process-wide state with synchronous initialization.

Use `dioxus::fullstack::Lazy<T>` when initialization itself is asynchronous, such as database pool creation.

Use injected typed state only when server setup must supply a resource. Create a request extension only for data specific to one request.

Do not use request extensions as the default process-wide state container.

## 6. Use Dioxus server errors

Use Dioxus `Result<T>` for normal functions. Use `HttpError` for standard HTTP failures. Use a serializable error with `AsStatusCode` when the client must distinguish variants.

Do not return internal database, filesystem, credential, or stack-trace details.

## 7. Use Dioxus request and response types

Use Dioxus full-stack wrappers for forms, headers, cookies, redirects, files, streams, and WebSockets.

Do not add low-level Axum extraction when Dioxus has the required typed wrapper.

## 8. Configure the runtime through normal deployment inputs

Use `IP` and `PORT` for the default server bind configuration where applicable.

Keep database URLs, keys, and other secrets in runtime secret storage. Do not put them in tracked source or `Dioxus.toml`.

## 9. Start through the application platform flow

Use the Dioxus CLI command selected by the full-stack application. Let it build the server feature and the selected client renderer together.

Do not add a second server development command unless the project has a required custom host architecture.

## 10. Complete the setup check

Confirm that:

- `dioxus/fullstack` and `dioxus/server` are configured correctly
- server-only dependencies are optional and feature-gated
- the default entry point uses `dioxus::launch`
- normal endpoints use HTTP verb server-function macros
- normal server functions remain auto-registered
- server state uses the narrowest correct scope
- secrets compile only into server code
- no unnecessary Axum router, REST client, static server, or duplicate API model was added
