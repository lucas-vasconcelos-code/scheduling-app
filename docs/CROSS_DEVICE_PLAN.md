# Cross-device implementation audit

The existing Google callback verifies `sub` and finds a PostgreSQL user; sessions already use independent hashed credentials. Domain metadata is persisted under that user. A concurrent first login needs serialization. Root `.env` is absent; the legacy backend has configured values, which are not copied or exposed.

The API currently runs TypeScript via tsx, has no static web serving or container, and waits for Google synchronization inside webhook requests. Watches are renewed during five-minute polling, but an initial callback can arrive before the channel is saved. Clients poll once per minute and refresh on native activation; there is no authenticated change stream or network reconnect wiring. Native alarm registration exists, but not push token registration or background reconciliation. Devices lack session binding and last-seen status. Logout already revokes one session; disconnect is missing.

Implementation order:
1. Add a replaceable per-user invalidation broker, coalesced sync queue, fast authenticated watch acknowledgement, lifecycle cleanup, and safe session/disconnect boundaries.
2. Connect web/native streams, foreground/reconnect refresh, cached stale views, background push reconciliation, and device status without changing scheduling or design.
3. Add built-server/static SPA production hosting, validated configuration, Docker and EAS profiles.
4. Extend two-session/isolation/watch tests, run existing checks, and document personal cloud/account/device setup and exact manual verification. Keep Google and native-device claims separate from local tests.

Use one always-on server instance and PostgreSQL initially. Process-local streams and transient OAuth handoffs are intentional; restart reconnects clients and polling repairs missed invalidations. A multi-instance deployment requires a shared broker and handoff store.
