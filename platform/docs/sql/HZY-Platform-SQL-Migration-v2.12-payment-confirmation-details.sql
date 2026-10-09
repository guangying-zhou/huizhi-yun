-- HZY Platform SQL Migration v2.12: payment confirmation details.
-- Date: 2026-05-02
-- Purpose:
--   Bank-transfer subscription orders require manual receipt confirmation.
--   Store the bank transaction number, receipt date and confirming platform
--   account so the order page has an auditable confirmation record.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `platform_payments`
  ADD COLUMN `transaction_ref` VARCHAR(128) NULL COMMENT '第三方支付单号或对公转账银行流水号' AFTER `status`,
  ADD COLUMN `confirmed_by_account_id` BIGINT UNSIGNED NULL COMMENT '对公转账人工确认人；跨域→platform_accounts，无 FK' AFTER `paid_at`,
  ADD COLUMN `confirmed_at` DATETIME NULL AFTER `confirmed_by_account_id`,
  ADD KEY `idx_platform_payments_confirmed_by` (`confirmed_by_account_id`, `confirmed_at`);
