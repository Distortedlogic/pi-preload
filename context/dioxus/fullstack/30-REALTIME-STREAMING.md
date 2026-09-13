# Full-Stack Real-Time and Streaming

Use the Dioxus type that matches the wire behavior:

- one request and response: generated server function with `use_action`
- server-to-client events: `ServerEvents<T>`
- typed HTTP stream: `Streaming<T, E>`
- bidirectional connection: `Websocket<ClientEvent, ServerEvent, E>`
- metadata-bearing file transfer: `FileStream`
- opaque bytes: `ByteStream`
- multipart browser form: `MultipartFormData`

## WebSockets

- Create the client handle with `use_websocket`.
- Signals read by its initializer are reactive connection dependencies; changing one reconnects the socket.
- A generated endpoint accepts `WebSocketOptions` and returns `Websocket<...>` through `options.on_upgrade(...)`.
- `send`, `recv`, `connect`, and `status` are supplied by the typed handle.
- Client and server event enums are Serde types. Select a built-in encoding, such as `CborEncoding`, through the WebSocket type parameter instead of framing messages manually.

## Server events and typed streams

- `ServerEvents<T>::new` adapts a producer into SSE. The client receives typed events through `recv()`.
- `Streaming<T, E>::new` adapts a Rust stream. `TextStream` is the plain-text alias.
- Available encodings include JSON, CBOR, Postcard, MessagePack, and Rkyv.
- A failed producer send indicates that the client connection ended.

## Files and bytes

- `FileData::into()` produces a `FileStream` with file metadata.
- `FileData::byte_stream()` can become a `ByteStream` when metadata is supplied separately.
- A returned `FileStream::from_path(...)` gives the generated client a streamed download.
- Consume stream chunks incrementally; these APIs exist to avoid buffering complete transfers.
