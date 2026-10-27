CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_items (
  provider TEXT NOT NULL DEFAULT 'tmdb',
  media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv')),
  provider_id INTEGER NOT NULL CHECK(provider_id > 0),
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, media_type, provider_id)
);

CREATE TABLE IF NOT EXISTS media_matches (
  fingerprint TEXT PRIMARY KEY,
  normalized_title TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv')),
  release_year INTEGER,
  provider TEXT NOT NULL DEFAULT 'tmdb',
  provider_id INTEGER,
  score INTEGER CHECK(score BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK(status IN ('matched', 'ambiguous', 'not_found')),
  manual_override INTEGER NOT NULL DEFAULT 0 CHECK(manual_override IN (0, 1)),
  candidates_json TEXT,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider, media_type, provider_id)
    REFERENCES media_items(provider, media_type, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_media_matches_lookup
  ON media_matches(normalized_title, media_type, release_year);
CREATE INDEX IF NOT EXISTS idx_media_items_expiry ON media_items(expires_at);
CREATE INDEX IF NOT EXISTS idx_media_matches_expiry ON media_matches(expires_at);

CREATE TABLE IF NOT EXISTS episode_items (
  provider TEXT NOT NULL DEFAULT 'tmdb',
  series_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL CHECK(season_number >= 0),
  episode_number INTEGER NOT NULL CHECK(episode_number >= 1),
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'tv' CHECK(media_type = 'tv'),
  PRIMARY KEY (provider, series_id, season_number, episode_number),
  FOREIGN KEY (provider, media_type, series_id)
    REFERENCES media_items(provider, media_type, provider_id)
);
