DELETE FROM media_matches
WHERE programme_kind = 'tv_series'
  AND status IN ('ambiguous', 'not_found')
  AND manual_override = 0;
