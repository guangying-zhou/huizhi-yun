-- HZY Platform SQL Migration v2.11: order payment method for self-service subscriptions.
-- Date: 2026-05-02
-- Purpose:
--   Tenant self-service plan orders need to keep pending bank-transfer orders
--   before a platform admin confirms receipt. platform_payments is only created
--   after successful payment, so platform_orders must retain the requested method.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `platform_orders`
  ADD COLUMN `payment_method` VARCHAR(32) NULL COMMENT 'bank_transfer / wechat_pay / alipay；pending 对公转账订单也需要记录支付方式' AFTER `currency`,
  ADD KEY `idx_platform_orders_payment_method` (`payment_method`, `status`);
