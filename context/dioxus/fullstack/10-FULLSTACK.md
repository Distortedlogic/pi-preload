# Full-Stack Runtime

- Prefer `#[get]`, `#[post]`, `#[put]`, and `#[delete]`. Use `#[server]` only for its anonymous or compatibility form.
- Put server-only extractors after the route in the verb macro. Do not add them to the generated client signature.
- Call a generated function directly from client Rust. Use `reqwest` only for an external endpoint.
- Keep shared request, response, and error types visible to both builds. Put server implementation details behind the `server` feature.
- Use `use_loader(...)?` to transfer required SSR data and reuse it during hydration.
- Let normal server functions register automatically. Attach typed injected state at the outer router only for a function that needs it.
- Use Dioxus `Result<T>` for normal server-function errors. Use `HttpError` for an explicit HTTP status and message.
- Implement `AsStatusCode` when a serializable custom error must keep its client variant and status. In an SSR error layout, call `FullstackContext::commit_error_status` before rendering the error page.

