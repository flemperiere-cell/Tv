DELETE FROM media_matches
WHERE status IN ('ambiguous', 'not_found')
  AND manual_override = 0;
