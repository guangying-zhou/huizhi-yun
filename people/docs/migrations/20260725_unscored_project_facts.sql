-- People project contribution facts are unscored until HR explicitly scores them.
USE `hzy_people`;

ALTER TABLE `people_contribution_snapshots`
  MODIFY COLUMN `contribution_score` DECIMAL(6,2) NULL DEFAULT NULL,
  ADD COLUMN `score_status` ENUM('unscored','scored') NOT NULL DEFAULT 'unscored'
    AFTER `contribution_score`;

-- Old Aims time-entry exports used a synthetic 80; clear the whole source scope.
-- Preserve explicit non-zero scores from other sources.
UPDATE `people_contribution_snapshots`
SET `score_status` = CASE
      WHEN `source_app` = 'aims' AND `source_biz_type` = 'time_entries' THEN 'unscored'
      WHEN `contribution_score` IS NULL OR `contribution_score` = 0 THEN 'unscored'
      ELSE 'scored'
    END,
    `contribution_score` = CASE
      WHEN `source_app` = 'aims' AND `source_biz_type` = 'time_entries' THEN NULL
      WHEN `contribution_score` IS NULL OR `contribution_score` = 0 THEN NULL
      ELSE `contribution_score`
    END;
