-- Aims migration v5.0: frozen cross-module reliable operation model v1.
--
-- integration_operation is the caller-owned Outbox. Each row represents one
-- command to exactly one different target application. Multi-target workflows
-- use correlation_key, sequence_no, and depends_on_operation_key.
-- integration_operation_attempt has append-only row identity; a processing
-- attempt may be finalized once with its safe outcome fields.
-- service_command_receipt is the target-owned Inbox/idempotency record.
--
-- operation_id is the global stable UUID; operation_key is the caller business
-- key; operation_code is the versioned dispatcher mapping key. Dispatcher code
-- maps operation_code to target app/audience/capability/path. The recorded
-- required_capability is audit-only and must never drive execution.
-- Identity and command fields are immutable after INSERT. Local completion/ack
-- steps stay in the surrounding source transaction and are not represented as
-- source_app = target_app operations.
--
-- No table stores service tokens, Authorization/Cookie values, credentials,
-- internal URLs, raw response bodies, or stack traces. This migration is purely
-- additive, contains no data rewrite or destructive DDL, and is safe to rerun.

CREATE TABLE IF NOT EXISTS integration_operation (
  operation_id CHAR(36) PRIMARY KEY COMMENT '全局稳定操作UUID；创建后不可修改',
  operation_key VARCHAR(191) NOT NULL COMMENT '调用方稳定业务操作键；创建后不可修改',
  correlation_key VARCHAR(191) NOT NULL COMMENT '多目标命令链业务关联键；单命令可等于operation_key',
  sequence_no INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '同一命令链内序号；创建后不可修改',
  depends_on_operation_key VARCHAR(191) DEFAULT NULL COMMENT '前置业务操作键；仅依赖成功后可派发',
  tenant_code VARCHAR(100) NOT NULL COMMENT '经认证上下文确认的租户；创建后不可修改',
  deployment_code VARCHAR(100) NOT NULL COMMENT '经认证上下文确认的部署；创建后不可修改',
  source_app VARCHAR(50) NOT NULL COMMENT '调用方应用；创建后不可修改且不得等于target_app',
  target_app VARCHAR(50) NOT NULL COMMENT '单一目标应用；创建后不可修改且不得等于source_app',
  operation_code VARCHAR(191) NOT NULL COMMENT '版本化dispatcher代码映射键；创建后不可修改',
  required_capability VARCHAR(191) NOT NULL COMMENT '创建时所需capability审计快照；不得作为dispatcher可执行来源',
  source_biz_type VARCHAR(100) NOT NULL COMMENT '调用方稳定业务对象类型；创建后不可修改',
  source_biz_code VARCHAR(191) NOT NULL COMMENT '调用方稳定业务对象编码；创建后不可修改',
  target_receipt_id CHAR(36) DEFAULT NULL COMMENT '目标端原子回执 UUID；source success 确认后写入',
  target_biz_type VARCHAR(100) DEFAULT NULL COMMENT '目标业务对象类型；成功确认后写入',
  target_biz_code VARCHAR(191) DEFAULT NULL COMMENT '目标稳定业务对象编码；成功确认后写入',
  idempotency_key VARCHAR(191) NOT NULL COMMENT '发送给目标服务的稳定幂等键；创建后不可修改',
  command_schema_version VARCHAR(30) NOT NULL DEFAULT 'v1' COMMENT '冻结命令schema版本；创建后不可修改',
  command_json JSON NOT NULL COMMENT '冻结命令载荷；不得包含Token、凭证、内部URL或动态路由字段',
  command_sha256 CHAR(64) NOT NULL COMMENT '规范化命令载荷SHA-256；创建后不可修改',
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '状态：pending/processing/retry_wait/partial_unknown/succeeded/failed_permanent/dead_letter/cancelled',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已开始尝试次数',
  max_attempts INT UNSIGNED NOT NULL DEFAULT 8 COMMENT '最大自动尝试次数',
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '下次可领取时间',
  last_attempt_at DATETIME(3) DEFAULT NULL COMMENT '最近尝试开始时间',
  locked_by VARCHAR(100) DEFAULT NULL COMMENT '当前持有租约的worker标识',
  locked_until DATETIME(3) DEFAULT NULL COMMENT '当前租约截止时间',
  fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '每次领取递增的栅栏令牌，拒绝陈旧worker写回',
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本；每次状态写入递增',
  original_request_id VARCHAR(100) DEFAULT NULL COMMENT '原始调用请求ID',
  correlation_id VARCHAR(100) DEFAULT NULL COMMENT '跨服务技术追踪关联ID',
  original_actor_uid VARCHAR(100) DEFAULT NULL COMMENT '经验证的原始用户actor UID',
  service_client_id VARCHAR(100) DEFAULT NULL COMMENT '经验证的调用服务client ID',
  replay_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '管理员人工重放次数',
  last_replay_actor_uid VARCHAR(100) DEFAULT NULL COMMENT '最近人工重放管理员UID',
  last_replay_reason VARCHAR(500) DEFAULT NULL COMMENT '最近人工重放原因；不得包含敏感信息',
  last_replay_at DATETIME(3) DEFAULT NULL COMMENT '最近人工重放时间',
  last_http_status SMALLINT UNSIGNED DEFAULT NULL COMMENT '最近下游HTTP状态码',
  last_error_code VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码；不得保存内部地址或凭证',
  last_error_class VARCHAR(50) DEFAULT NULL COMMENT '安全错误分类：authentication/authorization/transient/contract/conflict/protocol等',
  last_error_summary VARCHAR(1000) DEFAULT NULL COMMENT '脱敏错误摘要；不得保存响应正文、Token、内部URL或堆栈',
  last_error_at DATETIME(3) DEFAULT NULL COMMENT '最近错误时间',
  response_summary_sha256 CHAR(64) DEFAULT NULL COMMENT '脱敏响应摘要SHA-256；不保存完整响应',
  failure_notified_at DATETIME(3) DEFAULT NULL COMMENT '达到失败阈值后的首次通知时间，用于一次性告警',
  failure_notification_id VARCHAR(64) DEFAULT NULL COMMENT 'Console幂等通知ID；仅在发布成功后写入',
  succeeded_at DATETIME(3) DEFAULT NULL COMMENT '目标效果确认成功时间',
  failed_permanent_at DATETIME(3) DEFAULT NULL COMMENT '进入failed_permanent时间',
  dead_lettered_at DATETIME(3) DEFAULT NULL COMMENT '进入dead_letter时间',
  cancelled_at DATETIME(3) DEFAULT NULL COMMENT '受控取消时间',
  created_by VARCHAR(100) DEFAULT NULL COMMENT '创建者UID或服务client ID',
  updated_by VARCHAR(100) DEFAULT NULL COMMENT '最近更新者UID或worker标识',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',

  UNIQUE KEY uk_iop_identity (tenant_code, deployment_code, source_app, target_app, operation_code, idempotency_key),
  UNIQUE KEY uk_iop_operation_key (tenant_code, deployment_code, source_app, operation_key),
  UNIQUE KEY uk_iop_chain_sequence (tenant_code, deployment_code, source_app, correlation_key, sequence_no),
  INDEX idx_iop_due (status, next_attempt_at, locked_until),
  INDEX idx_iop_lock (status, locked_until),
  INDEX idx_iop_source_biz (tenant_code, deployment_code, source_app, source_biz_type, source_biz_code),
  INDEX idx_iop_target_biz (tenant_code, deployment_code, target_app, target_biz_type, target_biz_code),
  INDEX idx_iop_dependency (tenant_code, deployment_code, source_app, depends_on_operation_key),
  INDEX idx_iop_request (tenant_code, deployment_code, original_request_id),
  INDEX idx_iop_correlation_id (tenant_code, deployment_code, correlation_id),
  INDEX idx_iop_correlation_key (tenant_code, deployment_code, source_app, correlation_key, sequence_no),
  INDEX idx_iop_failure_notification (tenant_code, deployment_code, source_app, status, failure_notified_at, dead_lettered_at, operation_id),
  CONSTRAINT chk_iop_cross_app CHECK (source_app <> target_app),
  CONSTRAINT chk_iop_status CHECK (status IN ('pending', 'processing', 'retry_wait', 'partial_unknown', 'succeeded', 'failed_permanent', 'dead_letter', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调用方跨应用单目标命令Outbox；身份和命令字段创建后不可修改';

CREATE TABLE IF NOT EXISTS integration_operation_attempt (
  attempt_id CHAR(36) PRIMARY KEY COMMENT '全局稳定尝试UUID',
  operation_id CHAR(36) NOT NULL COMMENT '所属integration operation UUID',
  operation_code VARCHAR(191) NOT NULL COMMENT '版本化dispatcher代码映射键审计快照',
  attempt_no INT UNSIGNED NOT NULL COMMENT '操作内递增尝试序号',
  trigger_type VARCHAR(32) NOT NULL COMMENT '触发方式：immediate/scheduled/manual_replay/lease_recovery',
  request_id VARCHAR(100) DEFAULT NULL COMMENT '本次派发请求ID',
  correlation_id VARCHAR(100) DEFAULT NULL COMMENT '本次跨服务技术追踪关联ID',
  locked_by VARCHAR(100) DEFAULT NULL COMMENT '本次执行worker标识快照',
  fencing_token BIGINT UNSIGNED NOT NULL COMMENT '本次执行栅栏令牌',
  result_status VARCHAR(32) NOT NULL DEFAULT 'processing' COMMENT '尝试状态：processing；完成后一次性收口为succeeded/retry_wait/partial_unknown/failed_permanent/dead_letter/cancelled',
  http_status SMALLINT UNSIGNED DEFAULT NULL COMMENT '下游HTTP状态码',
  error_code VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码',
  error_class VARCHAR(50) DEFAULT NULL COMMENT '安全错误分类',
  error_summary VARCHAR(1000) DEFAULT NULL COMMENT '脱敏错误摘要；不得保存响应正文、Token、内部URL或堆栈',
  target_biz_type VARCHAR(100) DEFAULT NULL COMMENT '本次确认的目标业务对象类型',
  target_biz_code VARCHAR(191) DEFAULT NULL COMMENT '本次确认的目标稳定业务对象编码',
  response_summary_sha256 CHAR(64) DEFAULT NULL COMMENT '脱敏响应摘要SHA-256；不保存完整响应',
  started_at DATETIME(3) NOT NULL COMMENT '尝试开始时间',
  finished_at DATETIME(3) DEFAULT NULL COMMENT '尝试结束时间',
  duration_ms BIGINT UNSIGNED DEFAULT NULL COMMENT '尝试耗时毫秒',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '追加时间；身份字段禁止修改，processing仅允许一次性写入完成结果',

  UNIQUE KEY uk_ioa_operation_attempt (operation_id, attempt_no),
  INDEX idx_ioa_operation_created (operation_id, created_at),
  INDEX idx_ioa_operation_code (operation_code, created_at),
  INDEX idx_ioa_request (request_id),
  INDEX idx_ioa_correlation (correlation_id, created_at),
  INDEX idx_ioa_result (result_status, created_at),
  INDEX idx_ioa_error (error_class, error_code, created_at),
  CONSTRAINT fk_ioa_operation FOREIGN KEY (operation_id) REFERENCES integration_operation(operation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_ioa_result_status CHECK (result_status IN ('processing', 'succeeded', 'retry_wait', 'partial_unknown', 'failed_permanent', 'dead_letter', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨应用命令执行尝试安全审计日志；身份行追加，processing只允许一次性收口且不保存命令/响应正文或凭证';

CREATE TABLE IF NOT EXISTS service_command_receipt (
  receipt_id CHAR(36) PRIMARY KEY COMMENT '全局稳定目标回执UUID',
  operation_id CHAR(36) NOT NULL COMMENT '调用方integration operation UUID；创建后不可修改',
  operation_code VARCHAR(191) NOT NULL COMMENT '版本化目标命令代码；创建后不可修改',
  tenant_code VARCHAR(100) NOT NULL COMMENT '目标端验证后的租户；创建后不可修改',
  source_deployment_code VARCHAR(100) NOT NULL COMMENT '目标 BFF 验证后的调用方部署；创建后不可修改',
  deployment_code VARCHAR(100) NOT NULL COMMENT '目标 Runtime token 验证后的目标部署；创建后不可修改',
  source_app VARCHAR(50) NOT NULL COMMENT '目标端验证后的调用方；创建后不可修改且不得等于target_app',
  target_app VARCHAR(50) NOT NULL COMMENT '当前目标应用；创建后不可修改且不得等于source_app',
  required_capability VARCHAR(191) NOT NULL COMMENT '目标接口所需capability审计快照；不得用于动态选择授权',
  idempotency_key VARCHAR(191) NOT NULL COMMENT '目标端稳定幂等键；创建后不可修改',
  identity_sha256 BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(CONCAT_WS('|', tenant_code, source_deployment_code, deployment_code, source_app, target_app, operation_code, idempotency_key), 256))) STORED COMMENT '目标幂等身份生成摘要；用于受索引宽度限制的唯一约束',
  command_schema_version VARCHAR(30) NOT NULL DEFAULT 'v1' COMMENT '目标端接收的冻结命令schema版本',
  command_sha256 CHAR(64) NOT NULL COMMENT '规范化命令载荷SHA-256；同键异hash必须409',
  status VARCHAR(32) NOT NULL DEFAULT 'processing' COMMENT '状态：processing/succeeded/rejected',
  locked_by VARCHAR(100) DEFAULT NULL COMMENT '当前处理worker标识',
  locked_until DATETIME(3) DEFAULT NULL COMMENT '目标端处理租约截止时间',
  fencing_token BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '目标端接管处理时递增的栅栏令牌',
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本；每次状态写入递增',
  first_request_id VARCHAR(100) DEFAULT NULL COMMENT '首次接收请求ID',
  last_request_id VARCHAR(100) DEFAULT NULL COMMENT '最近同幂等键请求ID',
  correlation_id VARCHAR(100) DEFAULT NULL COMMENT '跨服务技术追踪关联ID',
  original_actor_uid VARCHAR(100) DEFAULT NULL COMMENT '目标端验证后的委托用户actor UID',
  service_client_id VARCHAR(100) DEFAULT NULL COMMENT '目标端验证后的调用服务client ID',
  target_biz_type VARCHAR(100) DEFAULT NULL COMMENT '目标业务对象类型',
  target_biz_code VARCHAR(191) DEFAULT NULL COMMENT '目标稳定业务对象编码；同键成功重放时返回',
  response_http_status SMALLINT UNSIGNED DEFAULT NULL COMMENT '首次终态HTTP状态码',
  response_summary_sha256 CHAR(64) DEFAULT NULL COMMENT '脱敏响应摘要SHA-256；不保存完整响应',
  last_error_code VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码',
  last_error_class VARCHAR(50) DEFAULT NULL COMMENT '安全错误分类',
  last_error_summary VARCHAR(1000) DEFAULT NULL COMMENT '脱敏错误摘要；不得保存响应正文、Token、内部URL或堆栈',
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '首次接收时间',
  last_received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '最近接收时间',
  completed_at DATETIME(3) DEFAULT NULL COMMENT '处理完成时间',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',

  UNIQUE KEY uk_scr_identity (identity_sha256),
  UNIQUE KEY uk_scr_operation_id (operation_id),
  INDEX idx_scr_status_lock (status, locked_until),
  INDEX idx_scr_target_biz (tenant_code, deployment_code, target_app, target_biz_type, target_biz_code),
  INDEX idx_scr_first_request (tenant_code, deployment_code, first_request_id),
  INDEX idx_scr_last_request (tenant_code, deployment_code, last_request_id),
  INDEX idx_scr_correlation (tenant_code, deployment_code, correlation_id),
  INDEX idx_scr_received (received_at),
  CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app),
  CONSTRAINT chk_scr_status CHECK (status IN ('processing', 'succeeded', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='目标服务命令Inbox回执；同幂等键同摘要重放、不同摘要冲突';
