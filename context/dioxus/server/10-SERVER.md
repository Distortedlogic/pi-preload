# Server Runtime

- `dioxus::launch` supplies normal server startup, server-function registration, SSR, assets, logging, and the `IP` and `PORT` bind path.
- Use `dioxus::serve` with `dioxus::server::router(app)` only when startup must add middleware, injected application state, or non-Dioxus routes.
- Normal server functions register automatically. A function that requires typed injected state needs that state attached at the router boundary.

Keep custom Axum code at the outer router boundary; keep application operations as Dioxus server functions.

