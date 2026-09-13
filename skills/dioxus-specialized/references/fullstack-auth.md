# Full-stack authentication

Use `Form<T>` for a typed form request. Use `FormEvent::parsed_values<T>()` when a Dioxus form event must become that request. A login server function can return `SetHeader<SetCookie>`.

Put a cookie, session, identity, or permission extractor after the route in the HTTP verb macro. This position keeps the extractor out of the generated client signature:

```rust
#[get("/api/account", cookie: TypedHeader<Cookie>)]
```

Use `TypedHeader<Cookie>` for a typed cookie extractor. Keep login, logout, identity, and permission operations as generated Dioxus server functions.

When the selected authentication package needs Axum session or authentication layers, attach the layers to `dioxus::server::router(app)` inside `dioxus::serve`. Its package-specific session type can then be a server-only extractor in a generated function.
