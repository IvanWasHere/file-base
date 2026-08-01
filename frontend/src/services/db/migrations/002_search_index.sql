-- Search index bookkeeping (M8).
--
-- Only the plain table lives here. The FTS5 virtual table it describes is
-- created on demand by services/search/searchIndex.ts, because FTS5 is a
-- compile-time option: the Go driver has it (pinned by TestFTS5IsAvailable),
-- but the sql.js build behind the mock bridge does not. Creating it here would
-- fail migration 002 outright and take the whole application down in tests and
-- browser development for the sake of an optional accelerator.
--
-- The index is an accelerator, never a source of truth. Every answer it gives
-- is re-stat'd against the filesystem before it is shown.

create table if not exists index_meta (
  root       text primary key,
  indexed_at integer not null,
  -- 'building' | 'ready' | 'failed'. A row left in 'building' means the app
  -- closed mid-index; it is rebuilt rather than trusted.
  status     text not null,
  entries    integer not null default 0
) strict;
