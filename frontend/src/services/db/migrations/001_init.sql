-- Initial schema.
--
-- The filesystem is the source of truth for directory contents; nothing here
-- caches file listings. This stores what the filesystem cannot: what the user
-- chose, where they have been, and how they want things shown.
--
-- The FTS5 search index and index_meta arrive with M8, in their own migration —
-- creating schema for a feature that does not exist yet only invites drift.

create table if not exists settings (
  key   text primary key,
  value text not null
) strict;

create table if not exists favorites (
  id         integer primary key autoincrement,
  path       text not null unique,
  label      text not null,
  icon       text,
  sort_order integer not null default 0
) strict;

create index if not exists favorites_sort_order on favorites (sort_order);

-- Most-recently-visited locations. Pruned by the repository, not by a trigger,
-- so the retention policy stays in TypeScript with the rest of the logic.
create table if not exists recents (
  path       text primary key,
  visited_at integer not null
) strict;

create index if not exists recents_visited_at on recents (visited_at desc);

-- Per-folder view preferences: the view mode and sort a folder was left in.
create table if not exists folder_prefs (
  path          text primary key,
  view_mode     text not null,
  sort_key      text not null,
  sort_dir      text not null,
  folders_first integer not null default 1
) strict;

-- Window session: open tabs, their panes and the split layout, as JSON.
--
-- JSON rather than normalised tables on purpose. This is opaque blob state
-- restored wholesale at launch and never queried by field; normalising it would
-- buy nothing and couple the schema to the shape of the workspace store.
create table if not exists sessions (
  id         integer primary key check (id = 1),
  payload    text not null,
  updated_at integer not null
) strict;

-- Tagging (a PRD "Future Feature"): schema now, UI later. Cheap to create up
-- front, and it keeps the annotations foreign key honest.
create table if not exists tags (
  id    integer primary key autoincrement,
  name  text not null unique,
  color text
) strict;

create table if not exists path_tags (
  path   text not null,
  tag_id integer not null references tags (id) on delete cascade,
  primary key (path, tag_id)
) strict;

create table if not exists annotations (
  path       text primary key,
  note       text not null,
  updated_at integer not null
) strict;

-- Thumbnail cache (M10). Keyed by path + size, with mtime so a changed file
-- invalidates its own thumbnail without a sweep.
create table if not exists thumbs (
  path  text not null,
  size  integer not null,
  mtime integer not null,
  image blob not null,
  primary key (path, size)
) strict;
