-- Thumbnail cache, rebuilt for the transport that actually works (M10).
--
-- Migration 001 created this table speculatively, before the backend existed,
-- storing the image as a BLOB. That turned out to be the wrong shape: Wails
-- marshals a Go []byte to a JSON array of numbers, so a 10KB thumbnail crosses
-- the bridge as ~40KB of text and arrives as something SQLite's STRICT mode
-- will not accept in a blob column. The backend now returns a `data:` URL, and
-- a URL is text.
--
-- Dropping rather than migrating: the old table has never held a row, because
-- nothing could write to it until now.
drop table if exists thumbs;

create table thumbs (
  path  text not null,
  size  integer not null,
  -- The source file's modification time. A file that changes invalidates its
  -- own thumbnail on the next lookup, with no sweep and no watcher involvement.
  mtime integer not null,
  image text not null,
  primary key (path, size)
) strict;

-- Eviction walks by age, so it needs its own index rather than a table scan.
create index if not exists thumbs_mtime on thumbs (mtime);
