# Desktop integration

Select the smallest integration level that meets the host requirement:

1. Standard Dioxus desktop renderer.
2. A desktop child surface with `Config::with_as_child_window`.
3. Custom paint in Dioxus Native with `dioxus_native::use_wgpu`.
4. An externally driven `DioxusDocument` when the host owns rendering and input.

Use Dioxus menu, tray, global-shortcut, window, and close APIs for standard desktop behavior. Use `use_wry_event_handler` only when a required Tao or Wry event has no higher-level Dioxus hook.

For another window, create a new `VirtualDom` and pass explicit root props or context to it.

For a child surface, use `Config::with_on_window` to receive the host window and virtual DOM before launch. Put host graphics resources in root context. Use `Config::with_as_child_window` for the WebView child, and use a Wry event handler only for required resize or redraw events.

For Dioxus Native custom paint, implement `CustomPaintSource` with `resume`, `suspend`, and `render`. Create device-bound state from the `DeviceHandle` in `resume`. Return a registered `TextureHandle` from `render`. Register new textures with `ctx.register_texture`, and unregister replaced textures with `ctx.unregister_texture`. Install the source with `use_wgpu`, and send small updates through a typed channel.

For an external host, construct `DioxusDocument` from a `VirtualDom` and a `DocumentConfig` with a `Viewport`. Supply a waker for the host event loop. Poll and paint the document from that loop, and translate host input to Dioxus `UiEvent` values.

Keep standard controls and layout in RSX. Limit custom paint to the surface that needs host graphics integration.
