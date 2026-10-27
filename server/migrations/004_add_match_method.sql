ALTER TABLE media_matches
ADD COLUMN method TEXT NOT NULL DEFAULT 'title'
CHECK(method IN ('title', 'title_and_episode', 'series_only', 'manual'));

UPDATE media_matches
SET method = CASE
  WHEN manual_override = 1 THEN 'manual'
  WHEN media_type = 'tv' AND status = 'matched' THEN 'series_only'
  ELSE 'title'
END;
