-- HZY Platform SQL Migration v2.32: cut application release sources over to the monorepo.
-- Prerequisite: v2.31 has added manifest_path and release_tag_prefix.
-- Idempotent: rerunning writes the same source configuration.

SET @monorepo_url := 'https://gitlab.wiztek.cn/huizhi-yun/huizhiyun.git';

UPDATE platform_applications
SET repo_url = @monorepo_url,
    manifest_path = CONCAT(app_code, '/app.manifest.json'),
    release_tag_prefix = CONCAT(app_code, '/')
WHERE app_code IN (
  'aims', 'altoc', 'assets', 'codocs', 'collab', 'console',
  'finance', 'insights', 'people', 'platform', 'webdev', 'workflow'
);

SELECT app_code, repo_url, manifest_path, release_tag_prefix
FROM platform_applications
WHERE app_code IN (
  'aims', 'altoc', 'assets', 'codocs', 'collab', 'console',
  'finance', 'insights', 'people', 'platform', 'webdev', 'workflow'
)
ORDER BY app_code;
