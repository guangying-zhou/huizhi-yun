-- Altoc target-applied watermark for ordered Assets delivery status commands. Additive; not executed here.
CREATE TABLE IF NOT EXISTS assets_delivery_status_projection (
  delivery_asset_code VARCHAR(191) PRIMARY KEY,
  applied_revision BIGINT UNSIGNED NOT NULL,
  command_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  environment_code VARCHAR(191) DEFAULT NULL,
  applied_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_adsp_status (status,applied_at),
  CONSTRAINT chk_adsp_revision CHECK (applied_revision>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Assets状态同步在Altoc的单调应用水位';
