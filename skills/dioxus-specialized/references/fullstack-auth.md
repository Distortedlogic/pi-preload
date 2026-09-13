# Full-stack authentication

Use `Form<T>` for a typed form request. Use `FormEvent::parsed_values<T>()` when a Dioxus form event must become that request. A login server function can return `SetHeader<SetCookie>`.

Use this verb-macro syntax for a typed cookie extractor:

```rust
#[get("/api/account", cookie: TypedHeader<Cookie>)]
```

Use `TypedHeader<Cookie>` for a typed cookie extractor. Keep login, logout, identity, and permission operations as generated Dioxus server functions.

When the selected authentication package needs Axum session or authentication layers, attach them at the existing outer-router integration point. Its package-specific session type can then be an extractor in a generated function.
