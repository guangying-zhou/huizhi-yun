-- Generated only; do not auto-run.
ALTER TABLE work_item_service_ext
  ADD COLUMN delivery_generation BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER last_synced_at,
  ADD COLUMN last_delivery_status VARCHAR(30) DEFAULT NULL AFTER delivery_generation;

