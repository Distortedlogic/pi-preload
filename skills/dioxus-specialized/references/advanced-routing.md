# Advanced routing

Keep routes in the typed `Routable` enum. Use `Router`, `Link`, and `Outlet` with enum values instead of parsed URL strings.

- Use typed fields for dynamic path segments.
- Use typed query and hash state instead of manual location parsing.
- Use catch-all route fields for a variable remaining path.
- Use route nests for shared path prefixes.
- Use layouts for shared route UI and place child content at `Outlet`.
- Use typed redirects for old or canonical paths.
- Use router scroll restoration instead of a global browser scroll listener.

Keep layout and nest order explicit. Put a catch-all route after the specific routes that it must not replace.
