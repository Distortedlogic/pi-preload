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

## HTTP failures

- Dioxus `Result<T>` provides the normal anyhow-style server-function path.
- Use `HttpError` helpers for explicit HTTP status and message behavior.
- A serializable custom error can implement `AsStatusCode` so its variant survives on the client with the correct status.
- In an SSR error layout, `FullstackContext::commit_error_status` converts a captured error into the response status before rendering the error page.

