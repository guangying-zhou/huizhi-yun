-- Rollback of b17-console-runtime-audience-facts.sql: restores each row's preflight scope_json by id, only while the row still carries the
-- marker audienceFacts=s4-b17-audience-facts. Rows changed afterwards by anything else (no marker) are left alone.
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
CREATE TEMPORARY TABLE b17_audience_facts AS
  SELECT * FROM (
      SELECT 2443 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2444 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2445 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2446 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2447 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2448 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2449 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2450 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2451 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2452 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2454 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2455 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6102 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6106 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6107 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6108 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6109 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6110 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6326 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13038 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13039 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13040 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13041 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13042 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13043 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13044 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13045 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13046 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13047 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13048 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13049 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13050 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13051 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13052 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13053 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13054 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13055 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13056 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13057 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13058 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13059 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13060 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13061 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13062 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13063 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13064 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13065 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13066 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13067 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13068 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13069 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13070 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13071 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13072 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13073 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13074 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13075 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13076 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13077 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13078 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13079 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13080 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13081 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13082 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13083 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13084 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13085 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13086 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13087 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13088 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13089 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13090 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13091 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13092 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13093 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13094 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13095 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13096 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13097 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13098 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13099 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 102384 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 102385 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 102386 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 10190326 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 46512766 AS id,'{"source": "tenant-runtime-bootstrap"}' AS old_json
  ) x;
UPDATE service_client_grants g JOIN b17_audience_facts f ON g.id=f.id
SET g.scope_json = CAST(f.old_json AS JSON), g.updated_at = UTC_TIMESTAMP()
WHERE JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audienceFacts'))='s4-b17-audience-facts';
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
