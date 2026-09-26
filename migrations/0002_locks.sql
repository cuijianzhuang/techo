-- Passwords for the whole book or a single day (the 口令 in 手帐设置 / the entry editor).
-- Run once: npx wrangler d1 execute techo-db --remote --file=migrations/0002_locks.sql
CREATE TABLE IF NOT EXISTS locks (
  scope      TEXT PRIMARY KEY,   -- 'book', 'd-YYYY-MM-DD' (a whole day), or an entry id (one page)
  hash       TEXT NOT NULL,      -- pbkdf2-sha256$<iterations>$<salt>$<hash>, never the password
  updated_at INTEGER NOT NULL
);
