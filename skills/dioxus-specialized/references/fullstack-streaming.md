# Full-stack streaming

Select the Dioxus wire type from the required communication pattern:

| Pattern | Type |
| --- | --- |
| One request and response | Generated server function |
| Server-to-client events | `ServerEvents<T>` |
| Typed HTTP stream | `Streaming<T, E>` |
| Bidirectional connection | `Websocket<ClientEvent, ServerEvent, E>` |
| File with metadata | `FileStream` |
| Opaque bytes | `ByteStream` |
| Browser multipart form | `MultipartFormData` |

Create a WebSocket client with `use_websocket`. Signals read by its initializer are connection dependencies, and a change reconnects the socket. On the server, accept `WebSocketOptions` and return the typed WebSocket through `options.on_upgrade(...)`. Use the handle `send`, `recv`, `connect`, and `status` operations. Keep client and server events as Serde types, and select a built-in encoding such as `CborEncoding` instead of custom framing.

Use `ServerEvents<T>::new` to adapt a producer to SSE. Use `Streaming<T, E>::new` for a typed Rust stream. `TextStream` is the plain-text alias. Select a supported encoding such as JSON, CBOR, Postcard, MessagePack, or Rkyv. A failed producer send means that the client connection ended.

Convert `FileData` with `FileData::into()` when file metadata must stay with the stream. Use `FileData::byte_stream()` for `ByteStream` when metadata is separate. Return `FileStream::from_path(...)` for a streamed download. Consume chunks as they arrive; do not buffer the complete transfer.
