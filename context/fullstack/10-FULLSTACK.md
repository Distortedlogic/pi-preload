# Full-Stack Runtime

## Generated server functions

- Prefer `#[get]`, `#[post]`, `#[put]`, and `#[delete]`. Use `#[server]` only when its anonymous or compatibility form is required.
- Path values, query values, request bodies, and server-only extractors are declared by the verb macro.
- Server-only extractors are not part of the generated client signature.
- Normal server functions register automatically.
- Call the generated Rust function directly from client code. `reqwest` is for external endpoints.
- Shared request, response, and error types remain visible to both builds; server implementation details use the `server` feature.

## Render data and actions

- `use_loader(...)?` suspends required render data, participates in SSR, serializes its result, and reuses that result during hydration.
- `use_action` owns explicit operation state through `call`, `pending`, `value`, `reset`, and `cancel`.
- `Loading::Pending` and `Loading::Failed` are available when loader state must be matched instead of propagated with `?`.

## Request and response conversion

- Arguments sent by generated clients implement serialization or Dioxus `IntoRequest`.
- Return values implement deserialization or Dioxus `FromResponse`.
- Use `FromResponse` with a matching server `IntoResponse` implementation for a custom wire response. Do not create a duplicate client API.
- Use Dioxus wrappers such as `Form`, `SetHeader`, `TypedHeader`, `Redirect`, and stream types before raw Axum extraction.

## HTTP failures

- Dioxus `Result<T>` provides the normal anyhow-style server-function path.
- Use `HttpError` helpers for explicit HTTP status and message behavior.
- A serializable custom error can implement `AsStatusCode` so its variant survives on the client with the correct status.
- In an SSR error layout, `FullstackContext::commit_error_status` converts a captured error into the response status before rendering the error page.

Web clients normally use the current origin. Desktop and mobile clients can require `dioxus::fullstack::set_server_url`.
