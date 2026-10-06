-- Optional Postgres target for the "Upsert to Postgres" node.
CREATE TABLE IF NOT EXISTS public.listings (
  id           TEXT PRIMARY KEY,          -- canonical product URL
  title        TEXT NOT NULL,
  price        NUMERIC(12,2),
  currency     VARCHAR(3),
  url          TEXT,
  availability TEXT,
  source       TEXT,
  scraped_at   TIMESTAMPTZ,
  status       TEXT,
  issues       TEXT
);
