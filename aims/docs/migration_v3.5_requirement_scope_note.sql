-- ============================================================
-- AIMS v3.5: 需求范围备注
-- ============================================================

ALTER TABLE `requirement_items`
  ADD COLUMN `scope_note` TEXT DEFAULT NULL COMMENT '需求范围备注，例如部分功能项不在本需求范围中' AFTER `change_reason`;
