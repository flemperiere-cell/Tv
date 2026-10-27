ALTER TABLE media_matches
ADD COLUMN programme_kind TEXT NOT NULL DEFAULT 'movie'
CHECK(programme_kind IN ('movie', 'tv_movie', 'tv_series'));

UPDATE media_matches
SET programme_kind = CASE
  WHEN media_type = 'tv' THEN 'tv_series'
  ELSE 'movie'
END;
