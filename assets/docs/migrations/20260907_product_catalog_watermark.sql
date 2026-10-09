-- Assets product catalog snapshot watermark, 2026-09-07.
-- Apply before enabling the catalog API. Replaying this migration invalidates
-- in-flight catalog generations and never resets the change revision.
CREATE TABLE IF NOT EXISTS assets_product_catalog_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  ready TINYINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO assets_product_catalog_state(id,epoch,revision,ready) VALUES(1,UUID(),1,0);
UPDATE assets_product_catalog_state SET ready=0,epoch=UUID() WHERE id=1;
DELIMITER $$
DROP TRIGGER IF EXISTS assets_pc_product_ai$$
CREATE TRIGGER assets_pc_product_ai AFTER INSERT ON product_assets FOR EACH ROW
BEGIN
  UPDATE assets_product_catalog_state SET revision=revision+1 WHERE id=1;
END$$
DROP TRIGGER IF EXISTS assets_pc_product_au$$
CREATE TRIGGER assets_pc_product_au AFTER UPDATE ON product_assets FOR EACH ROW
BEGIN
  UPDATE assets_product_catalog_state SET revision=revision+1 WHERE id=1;
END$$
DROP TRIGGER IF EXISTS assets_pc_product_ad$$
CREATE TRIGGER assets_pc_product_ad AFTER DELETE ON product_assets FOR EACH ROW
BEGIN
  UPDATE assets_product_catalog_state SET revision=revision+1 WHERE id=1;
END$$
DROP TRIGGER IF EXISTS assets_pc_line_ai$$
CREATE TRIGGER assets_pc_line_ai AFTER INSERT ON asset_category_groups FOR EACH ROW
BEGIN
  IF NEW.category_scope='product' THEN
  UPDATE assets_product_catalog_state SET revision=revision+1 WHERE id=1;
  END IF;
END$$
DROP TRIGGER IF EXISTS assets_pc_line_au$$
CREATE TRIGGER assets_pc_line_au AFTER UPDATE ON asset_category_groups FOR EACH ROW
BEGIN
  IF OLD.category_scope='product' OR NEW.category_scope='product' THEN
  UPDATE assets_product_catalog_state SET revision=revision+1 WHERE id=1;
  END IF;
END$$
DROP TRIGGER IF EXISTS assets_pc_line_ad$$
CREATE TRIGGER assets_pc_line_ad AFTER DELETE ON asset_category_groups FOR EACH ROW
BEGIN
  IF OLD.category_scope='product' THEN
  UPDATE assets_product_catalog_state SET revision=revision+1 WHERE id=1;
  END IF;
END$$
DELIMITER ;
UPDATE assets_product_catalog_state SET ready=1,epoch=UUID(),revision=revision+1 WHERE id=1;
