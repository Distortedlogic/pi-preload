# Server Runtime

- `dioxus::launch` supplies normal server startup, server-function registration, SSR, assets, logging, and the `IP` and `PORT` bind path.
- Use `server_only! { ServeConfig::builder()... }` for renderer configuration that must exist only in the server build.
- Use `dioxus::serve` with `dioxus::server::router(app)` only when startup must add middleware, injected application state, or non-Dioxus routes.
- Normal server functions register automatically. A function that requires typed injected state needs that state attached at the router boundary.
- Apply endpoint-specific Tower middleware with `#[middleware(...)]` on the server function instead of rebuilding the endpoint as an Axum route.
- Put server-only extractors after the route in the HTTP verb macro. They remain absent from the generated client signature.

## State selection

1. Use `std::sync::LazyLock<T>` for synchronous process-wide initialization.
2. Put an async lock inside it when shared mutation is asynchronous.
3. Use `dioxus::fullstack::Lazy<T>` when initialization itself is asynchronous.
4. Use typed `State<T>` only when router setup must inject application state.
5. Implement `FromRef<FullstackContext>` when a custom extractor or state type must resolve from Dioxus full-stack context.
6. Use an extension only for a value inserted into request context. Do not use an extension for ordinary process-wide state.

Keep custom Axum code at the outer router boundary; keep application operations as Dioxus server functions.




















