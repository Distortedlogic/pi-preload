# Custom server integration

Apply router-wide Tower layers to the outer Axum router. Merge required non-Dioxus routes without changing generated operation paths.

Apply endpoint-specific Tower middleware with `#[middleware(...)]` on the server function. Do not rebuild that operation as an Axum route.

Select server state by its lifetime and initialization:

1. Use `std::sync::LazyLock<T>` for synchronous process-wide initialization.
2. Put an async lock inside it for asynchronous shared mutation.
3. Use `dioxus::fullstack::Lazy<T>` when initialization is asynchronous.
4. Use typed `State<T>` only when router setup must inject application state.
5. Implement `FromRef<FullstackContext>` when a custom extractor or state type must resolve from Dioxus full-stack context.
6. Use a request extension only for a value inserted into request context.

For a custom wire response, implement the server `IntoResponse` conversion and the matching client `FromResponse` conversion. For a custom request value, implement serialization or Dioxus `IntoRequest`. Do not create a second client API for the same generated operation.
