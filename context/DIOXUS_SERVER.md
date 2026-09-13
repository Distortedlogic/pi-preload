# Dioxus 0.7.10 Server Rules

Use this context for the server side of a Dioxus full-stack application.

## 1. Use Dioxus as the server entry point

Enable full-stack and server support through Cargo features:

```toml
[dependencies]
dioxus = { version = "=0.7.10", features = ["fullstack"] }

[features]
server = ["dioxus/server"]
```

Use `dioxus::launch` when the default Dioxus server is sufficient.

Use `dioxus::serve` with `dioxus::server::router(app)` only when the server needs required middleware, non-Dioxus routes, or injected state.

Do not build an Axum application first and attach Dioxus as a secondary system.

## 2. Use HTTP verb server-function macros

Use these macros as the default server API:

- `#[get]`
- `#[post]`
- `#[put]`
- `#[delete]`

Use the macro route to define path and query values. Put server-only extractors in the macro argument list.

Use `#[server]` only for an anonymous endpoint or a required compatibility case.

Let Dioxus generate the client function and register normal server functions automatically. Do not create duplicate Axum routes and client request functions.

## 3. Keep the server-function contract shared

Place serializable request types, response types, and typed errors where both client and server builds can use them.

Keep implementation details and server-only imports behind:

```rust
#[cfg(feature = "server")]
```

Call the generated function directly from Dioxus client code. Use `reqwest` for external services only.

## 4. Use Dioxus request and response types

Use Dioxus full-stack types before direct Axum types. These include:

- `Form<T>` for encoded forms
- `MultipartFormData` for multipart forms
- `FileStream` for file upload and download
- `ByteStream` for raw byte streams
- `SetHeader<T>` and `SetCookie` for response headers
- `TypedHeader<T>` and `HeaderMap` for request headers
- `Redirect` for redirects
- `WebSocketOptions` and `Websocket` for WebSockets
- `ServerEvents<T>` and `Streaming<T, E>` for streaming responses

Do not manually implement behavior that one of these types provides.

## 5. Use a strict server-state selection order

### Process-wide state with synchronous initialization

Use `std::sync::LazyLock<T>`:

```rust
use std::sync::LazyLock;

static STATE: LazyLock<State> = LazyLock::new(State::new);
```

When shared mutation is asynchronous, put an async-compatible lock inside the static value.

### Process-wide state with asynchronous initialization

Use `dioxus::fullstack::Lazy<T>` for resources such as asynchronously created database pools.

Do not create a custom router only to initialize a process-wide resource.

### Injected application state

Use typed state only when a server function requires a resource supplied by server setup. Add the resource once at the server boundary.

### Request-specific state

Create a request extension only when the resource is genuinely specific to the current request.

Do not use request extensions as the default global-state container.

## 6. Use Dioxus-native errors

Return Dioxus `Result<T>` for normal server-function work.

Use `HttpError` helpers for standard HTTP failures:

- `bad_request`
- `unauthorized`
- `not_found`
- `internal_server_error`

Use a serializable custom error with `AsStatusCode` when the client must distinguish error variants.

Do not expose database errors, credentials, stack traces, or other internal details to the client.

## 7. Use typed WebSockets

Define serializable client-event and server-event enums.

Return `Websocket<ClientEvent, ServerEvent>` from a server function. Accept `WebSocketOptions` and call `on_upgrade` to run the connection loop.

Use Dioxus encoding support when JSON is not suitable.

Do not use raw Axum WebSocket extraction or a manually parsed message protocol when the typed API is sufficient.

## 8. Use native streaming types

Use `ServerEvents<T>` for server-sent events.

Use `Streaming<T, E>` for typed streams. Use `TextStream`, `ByteStream`, or `FileStream` for their matching data forms.

Stop producer work when the receiver disconnects. Do not collect a large stream into memory before returning it.

## 9. Use native upload and download types

Use `MultipartFormData` for normal multipart forms. Use `FileStream` for file metadata and streamed file content. Use `ByteStream` for opaque streamed bytes.

Validate file names, paths, expected sizes, content types, and maximum sizes on the server.

Do not trust client-provided paths or file metadata.

## 10. Keep secrets and trusted operations on the server

External API keys, database credentials, signing keys, and protected business operations must stay in server-only code.

Expose the smallest necessary server-function contract. Do not send a secret to a web, desktop, or mobile client so that the client can call an external service directly.

## 11. Use Axum only at a required boundary

A custom router is valid for:

- required middleware
- a non-Dioxus route
- an existing Axum service integration
- a server-only extractor that Dioxus cannot supply automatically
- typed state that must be inserted during server setup

Use `dioxus::server::router(app)` as the base router. Keep the Axum-specific code at the outer server boundary.

Do not move ordinary server-function logic into Axum handlers.

## 12. Let Dioxus serve the application

Let Dioxus manage SSR, hydration data, generated server-function routes, static assets, logging, hot reload, and normal server startup.

Use the `IP` and `PORT` environment variables for binding configuration when applicable.

Do not add another static server, RPC framework, or application bootstrap layer without a specific requirement.
