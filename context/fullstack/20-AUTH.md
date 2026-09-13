# Full-Stack Authentication

- Use `use_action` for login, logout, and other explicit authentication operations.
- A Dioxus form can become a typed request with `Form<T>` and `FormEvent::parsed_values<T>()`.
- A login server function can return `SetHeader<SetCookie>`; a protected function can receive `TypedHeader<Cookie>` as a server-only extractor.
- Put session or identity extractors after the route in the verb macro so generated clients do not provide them.

```rust
#[post("/api/login")]
async fn login(form: Form<LoginForm>) -> Result<SetHeader<SetCookie>> {
    // Use the selected authentication package.
}

#[get("/api/account", cookie: TypedHeader<Cookie>)]
async fn account() -> Result<Account> {
    // Resolve the server session.
}
```

- When an authentication package requires Axum session and auth layers, attach them to `dioxus::server::router(app)` inside `dioxus::serve`.
- Keep login, logout, identity, and permission operations as Dioxus server functions even when those layers are present.
- A package-specific session type can be a server-only extractor in those functions.
- Use a maintained authentication package; the examples demonstrate Dioxus integration, not a production authentication implementation.
