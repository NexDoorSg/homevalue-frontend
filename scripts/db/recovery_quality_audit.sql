-- Read-only recovery checks. Coordinates are nullable when evidence is ambiguous.
BEGIN READ ONLY;
SELECT count(*) AS recovered,
       count(DISTINCT (address, transaction_date, transaction_price)) AS unique_keys,
       count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL) AS missing_coordinates,
       count(*) FILTER (WHERE (latitude IS NULL) <> (longitude IS NULL)) AS partial_coordinates,
       count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND NOT (latitude BETWEEN 1.15 AND 1.5 AND longitude BETWEEN 103.55 AND 104.15)) AS outside_singapore,
       count(*) FILTER (WHERE address ~* '(ETC|ENBLOC)') AS bulk_address_flags
FROM public.property_transactions_v2 WHERE id BETWEEN 1396763 AND 1400380;
-- Expected: 3618 recovered, 3618 unique keys, zero partial/outside/bulk flags.

SELECT p.project_name, p.property_type,
       CASE WHEN p.project_name = 'ENCHANTÃ‰' THEN 'ENCHANTÉ' ELSE p.project_name END AS transaction_name,
       (SELECT count(*) FROM public.property_transactions_v2 t WHERE t.project_name =
         CASE WHEN p.project_name = 'ENCHANTÃ‰' THEN 'ENCHANTÉ' ELSE p.project_name END) AS transactions
FROM public.projects_master p
WHERE NOT EXISTS (SELECT 1 FROM public.property_transactions_v2 t WHERE t.project_name = p.project_name)
ORDER BY p.property_type, p.project_name;
-- ENCHANTÃ‰ is a verified runtime alias, not an unresolved coverage gap.

SELECT project_name, count(*) AS excluded_from_tower
FROM public.property_transactions_v2
WHERE address ~* '(ETC|ENBLOC)'
  AND address !~ '^[0-9]+[A-Za-z]? [^#]+ #[0-9]+-[0-9]+$'
GROUP BY project_name ORDER BY count(*) DESC;
ROLLBACK;
