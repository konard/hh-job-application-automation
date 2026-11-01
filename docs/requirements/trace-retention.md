# Local trace storage and retention

Browser traces must remain in machine-local app storage (`~/.hh-automation/traces`), outside
the source checkout. The app and CI must not upload them to GitHub. Keep the repository's
`logs` and accidental `traces/` directories ignored by Git.

Default retention is three days. Prune expired generated recordings at startup and every minute
while recording, including idle waits. Rotate long recordings at least daily so active sessions
do not retain older diagnostics indefinitely. An explicit positive `TRACE_RETENTION_DAYS` or
`--trace-retention-days` can change the age limit; zero must not silently mean unlimited storage.

Delete only timestamped run directories with a valid recorder-owned marker and matching creation
time. Never follow symlinks during cleanup or delete unrelated files. New directories and marker
files are private to the current user. Expiration uses recording age rather than a changing mtime.

The owner authorized deletion of the previous checkout's `logs/traces` after inspection confirmed
only generated diagnostics. Those recordings must be deleted, not migrated. Source files, CVs,
answers, caches and browser profiles remain outside that deletion.

Verification: `tests/trace-storage.test.mjs`, `tests/browser/trace-storage.mjs`, plus existing
DOM, network and screenshot recorder tests. Live deployment checks the former directory remains
absent, all active recorders use the new root, and deleted files have no remaining open handles.
