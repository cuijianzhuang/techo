-- The font a single page is written in (the 字体 row in the entry editor); empty: the book's (the 字体 card in 手帐设置).
-- Run once: npx wrangler d1 execute techo-db --remote --file=migrations/0004_font.sql
-- Until it has run, pages still save, just without a font of their own.
ALTER TABLE entries ADD COLUMN font TEXT NOT NULL DEFAULT '';  -- a font id (render.js FONTS), or u-<uuid> for an uploaded one
