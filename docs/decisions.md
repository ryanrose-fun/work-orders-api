# Engineering decisions

## Version checks instead of last-write-wins

Every status update carries `expected_version`. The database UPDATE includes both ID and version in its predicate and increments the version in the same statement. Checking the version only in Python would leave a race between reading and writing. One concurrent update succeeds; the other receives 409.

The React console keeps the attempted target after a conflict, fetches the latest record, and requires an explicit second save. It never silently applies stale intent to new state. Terminal states cannot be reopened. A revision counter detects change, not semantic compatibility: a richer editor would need field-level merge rules or an explicit diff. High contention could warrant a different workflow, not increasingly aggressive retries.

## PostgreSQL for deployment; SQLite for local iteration

SQLite keeps the demonstration easy to run without a database service. PostgreSQL provides the intended shared deployment database. Both run the API tests in CI; a local SQLite pass alone does not establish PostgreSQL behaviour. SQLite's single-writer constraints and file management make it a poor default for multiple independent application hosts. Migrations run separately from web-process startup.

## Thin browser client and same-origin API

The TypeScript client submits intent and displays persisted responses. Rules and validation remain in FastAPI; disabled buttons are usability, not security. Vite's development proxy maps `/api` to the backend. A deployed build needs an equivalent HTTPS reverse proxy. Tokens live in tab memory, not local storage. This does not protect against XSS or provide individual identities: replace shared-token authentication before offering a multi-user service.

## No automatic retries of writes

A dropped POST response might hide a committed insert. The UI retains input and tells the operator to inspect the register rather than retrying automatically. Production create retries should use an idempotency key bound to the request payload and a stored result. PATCH's version precondition prevents a repeated transition, but an uncertain response still calls for a read.

## Bounded lists, explicit limitations

The UI requests 12 orders at a time; the API caps requests at 100. UUID ordering is deterministic for a static dataset, not chronological ordering or a snapshot. Insertions can shift offset pages. High-volume changing registers should use cursor pagination with a stable indexed ordering key. The separate 'Just created' card makes a successful create visible without pretending it belongs on the current page.
