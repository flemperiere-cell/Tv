DELETE FROM media_matches
WHERE status = 'matched'
  AND manual_override = 0;
