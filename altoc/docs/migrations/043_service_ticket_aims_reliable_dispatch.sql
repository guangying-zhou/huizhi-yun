-- Generated only; do not auto-run.
ALTER TABLE service_ticket
  ADD COLUMN aims_dispatch_status VARCHAR(20) NOT NULL DEFAULT 'idle' AFTER aims_work_item_type,
  ADD COLUMN aims_dispatch_operation_key VARCHAR(191) DEFAULT NULL AFTER aims_dispatch_status,
  ADD COLUMN aims_delivery_generation BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER aims_dispatch_operation_key,
  ADD COLUMN aims_delivery_status VARCHAR(30) DEFAULT NULL AFTER aims_delivery_generation,
  ADD INDEX idx_aims_dispatch (aims_dispatch_status, aims_dispatch_operation_key);

