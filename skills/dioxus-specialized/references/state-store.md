# Store state

Use Store for a large nested domain model that needs field-level reactive reads and writes. Keep small component state in `use_signal`.

Derive Store and create it with `use_store`:

```rust
#[derive(Store, Clone, PartialEq)]
struct AppState {
    items: Vec<Item>,
}

let state = use_store(|| AppState { items: Vec::new() });
```

Use generated lenses such as `state.items()` to subscribe to and change one field. Do not replace the complete model when a lens can change the selected field.

Add domain operations with the Store extension form:

```rust
#[store]
impl<Lens> Store<AppState, Lens> {}
```

Put domain changes on that extension. Keep component event code as a caller of those operations.
