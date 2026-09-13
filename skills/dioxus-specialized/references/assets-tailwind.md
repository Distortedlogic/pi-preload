# Assets and Tailwind

Keep reused static assets in constants. `asset!` returns a build-managed `Asset`.

```rust
const LOGO: Asset = asset!("/assets/logo.svg");
```

Use `#[css_module]` when class names must be scoped. Use the generated class names instead of spelling the transformed names.

A root `tailwind.css` is detected by the Dioxus CLI. Include Rust RSX in the Tailwind source scan:

```css
@import "tailwindcss";
@source "./src/**/*.{rs,html,css}";
```

Use `use_asset_handler` only for desktop content that is generated or selected at run time. Keep static files as `asset!` assets. Let Rust select classes, but keep the styling rules in Tailwind or CSS assets.
