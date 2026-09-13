# Dioxus 0.7.10 Authentication Rules

Use this context only when a Dioxus full-stack task includes login, sessions, permissions, or protected server functions.

## 1. Keep authentication on the server

Authenticate credentials and authorize every protected operation inside server code.

Keep password hashes, session keys, OAuth secrets, database credentials, and permission rules behind the `server` feature.

Do not trust client signals, route state, hidden elements, or cookies without server verification.

## 2. Use an established authentication package

Use a maintained authentication or session package when it covers the requirement. Do not build custom password, token, cookie-signing, or session cryptography.

Treat authentication examples as API demonstrations. Do not copy demo credentials, in-memory users, static session identifiers, or incomplete cookie settings into production code.

## 3. Use Dioxus server functions as the application boundary

Use HTTP verb server functions for login, logout, session inspection, and protected operations.

```rust
#[post("/api/login")]
async fn login(form: Form<LoginForm>) -> Result<SetHeader<SetCookie>> {
    // Verify through the selected authentication service.
}
```

Call the generated server function from the client. Do not add a second REST client or duplicate API model.

Use `use_action` for login, logout, and other explicit authentication operations.

## 4. Use Dioxus request and response wrappers

Use these Dioxus full-stack types when they fit:

- `Form<T>` for login and registration forms
- `SetHeader<SetCookie>` for a session cookie response
- `TypedHeader<Cookie>` for a server-side cookie extractor
- `HeaderMap` for required custom headers
- `HttpError` for authentication and authorization failures

Use a server-only extractor through the server-function macro when the client must not supply it.

Do not parse raw HTTP requests when a typed wrapper is sufficient.

## 5. Store sessions on the server

Use a maintained server-side session store for revocable sessions. Store only an opaque session identifier in the browser cookie.

Set secure cookie attributes for the deployment:

- `HttpOnly`
- `Secure`
- an explicit `SameSite` policy
- a narrow path and domain
- a bounded lifetime

Rotate session identifiers after login and privilege changes. Invalidate the server session during logout.

Do not put authorization state, secrets, or trusted user data in an unsigned client cookie.

## 6. Apply authorization to each protected server function

Resolve the current user on the server. Check the required permission before data access or mutation.

Return `HttpError::unauthorized` when authentication is missing or invalid. Return the correct forbidden response when identity is valid but permission is insufficient.

Keep permission names and checks in the server domain model. Do not make the client responsible for enforcing them.

## 7. Select authentication state by scope

Use process-wide `LazyLock` or `dioxus::fullstack::Lazy` for shared authentication services and session stores.

Use a request extension only for identity or state resolved for the current request.

Do not create a request extension for a process-wide database pool or static configuration.

## 8. Keep client authentication state provisional

The client can show pending, authenticated, anonymous, and failed states. The server remains authoritative.

Fetch the current session through a server function when the application starts or when authentication changes.

Do not treat a successful login form response as permanent proof of authorization. Protected server functions must validate the session again.

## 9. Protect form and redirect flows

Validate all form data on the server. Apply CSRF protection when cookie authentication and browser requests require it.

Validate redirect targets. Do not redirect to an arbitrary URL supplied by the client.

Do not expose whether an account exists unless the product explicitly permits that information.

## 10. Keep custom Axum integration narrow

Use `dioxus::serve` and `dioxus::server::router(app)` only when the selected authentication package requires router layers or extractors.

Attach the required session and authentication layers at the server boundary. Keep application operations as Dioxus server functions.

Do not convert the full application into direct Axum handlers only because the authentication package integrates with Axum.
