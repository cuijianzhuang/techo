-- For a techo-db created before drafts / doodles / jots existed.
-- Run once: npx wrangler d1 execute techo-db --remote --file=migrations/0001_drafts_stickers_jots.sql
ALTER TABLE entries ADD COLUMN stickers TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
CREATE TABLE IF NOT EXISTS jots (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_in    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_jots_created ON jots(created_at);
