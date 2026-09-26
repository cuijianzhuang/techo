-- Where a page was written and that day's weather (the 地点和天气 row in the entry editor).
-- Run once: npx wrangler d1 execute techo-db --remote --file=migrations/0003_place_weather.sql
-- Until it has run, pages still save, just without a place or weather.
ALTER TABLE entries ADD COLUMN place   TEXT NOT NULL DEFAULT '';  -- e.g. 上海 · 徐汇
ALTER TABLE entries ADD COLUMN geo     TEXT NOT NULL DEFAULT '';  -- "lat,lon", two decimals
ALTER TABLE entries ADD COLUMN weather TEXT NOT NULL DEFAULT '';  -- e.g. 多云 18~25°
