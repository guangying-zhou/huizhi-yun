-- Repeatable migration for business-domain and region writes through Tenant Runtime.

SET @business_domain_revision_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='org_business_domains' AND column_name='revision'
);
SET @business_domain_revision_ddl := IF(
  @business_domain_revision_exists=0,
  'ALTER TABLE `org_business_domains` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`',
  'SELECT 1'
);
PREPARE business_domain_revision_statement FROM @business_domain_revision_ddl;
EXECUTE business_domain_revision_statement;
DEALLOCATE PREPARE business_domain_revision_statement;

SET @region_revision_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema=DATABASE() AND table_name='regions' AND column_name='revision'
);
SET @region_revision_ddl := IF(
  @region_revision_exists=0,
  'ALTER TABLE `regions` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`',
  'SELECT 1'
);
PREPARE region_revision_statement FROM @region_revision_ddl;
EXECUTE region_revision_statement;
DEALLOCATE PREPARE region_revision_statement;
