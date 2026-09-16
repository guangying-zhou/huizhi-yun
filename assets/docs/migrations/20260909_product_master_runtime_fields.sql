-- Add fields already used by product master reads/writes. Existing values are preserved.
SET @hzy_product_column_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_assets' AND COLUMN_NAME='build_stage')=0, 'ALTER TABLE product_assets ADD COLUMN `build_stage` VARCHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE hzy_product_column_stmt FROM @hzy_product_column_ddl;
EXECUTE hzy_product_column_stmt;
DEALLOCATE PREPARE hzy_product_column_stmt;

SET @hzy_product_column_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_assets' AND COLUMN_NAME='current_version')=0, 'ALTER TABLE product_assets ADD COLUMN `current_version` VARCHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE hzy_product_column_stmt FROM @hzy_product_column_ddl;
EXECUTE hzy_product_column_stmt;
DEALLOCATE PREPARE hzy_product_column_stmt;

SET @hzy_product_column_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_assets' AND COLUMN_NAME='target_version')=0, 'ALTER TABLE product_assets ADD COLUMN `target_version` VARCHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE hzy_product_column_stmt FROM @hzy_product_column_ddl;
EXECUTE hzy_product_column_stmt;
DEALLOCATE PREPARE hzy_product_column_stmt;

SET @hzy_product_column_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_assets' AND COLUMN_NAME='productization_value_level')=0, 'ALTER TABLE product_assets ADD COLUMN `productization_value_level` VARCHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE hzy_product_column_stmt FROM @hzy_product_column_ddl;
EXECUTE hzy_product_column_stmt;
DEALLOCATE PREPARE hzy_product_column_stmt;

SET @hzy_product_column_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_assets' AND COLUMN_NAME='supported_terminals')=0, 'ALTER TABLE product_assets ADD COLUMN `supported_terminals` JSON DEFAULT NULL', 'SELECT 1');
PREPARE hzy_product_column_stmt FROM @hzy_product_column_ddl;
EXECUTE hzy_product_column_stmt;
DEALLOCATE PREPARE hzy_product_column_stmt;

SET @hzy_product_column_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_assets' AND COLUMN_NAME='covered_legacy_systems')=0, 'ALTER TABLE product_assets ADD COLUMN `covered_legacy_systems` JSON DEFAULT NULL', 'SELECT 1');
PREPARE hzy_product_column_stmt FROM @hzy_product_column_ddl;
EXECUTE hzy_product_column_stmt;
DEALLOCATE PREPARE hzy_product_column_stmt;

