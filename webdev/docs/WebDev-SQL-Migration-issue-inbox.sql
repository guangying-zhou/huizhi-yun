-- WebDev SQL Migration: Issue 收件箱新增表（data-runtime / hzy_webdev 库）。
-- Date: 2026-06-13
-- Purpose:
--   阶段 1–4 引入 Issue 收件箱与自动领取规则；以下 4 张表为新增。
--   现有部署若未跑过最新 webdev_schema.sql，会在 intake 写库时报错（表不存在）。
--   全部为 CREATE TABLE IF NOT EXISTS，可安全重复执行。
-- 库定位：tenant-runtime 业务库（默认 hzy_webdev，按部署实际库名执行 USE）。

USE hzy_webdev;

-- Issue 主表（来源：Foundation 报告组件 / 控制台手动）
CREATE TABLE IF NOT EXISTS webdev_issues (
  issue_id        VARCHAR(64) PRIMARY KEY,
  display_no      BIGINT UNSIGNED NOT NULL DEFAULT 0,                -- 租户内展示短号 #NNNN
  project_id      VARCHAR(64)  NOT NULL DEFAULT '',
  app_code        VARCHAR(64)  NOT NULL DEFAULT '',                  -- 来源业务应用
  scope           VARCHAR(16)  NOT NULL DEFAULT 'page',              -- page | app
  page_key        VARCHAR(256) NOT NULL DEFAULT '',                  -- 归一化页面标识 app_code:routePattern
  page_url        VARCHAR(1024) NOT NULL DEFAULT '',                 -- 脱敏后的页面 URL（展示用）
  repo_id         VARCHAR(64)  NOT NULL DEFAULT '',                  -- 目标仓库
  tenant          VARCHAR(64)  NOT NULL DEFAULT '',
  fingerprint     VARCHAR(128) NOT NULL DEFAULT '',                  -- 脱敏上下文指纹
  severity        VARCHAR(16)  NOT NULL DEFAULT 'mid',               -- high | mid | low
  kind            VARCHAR(16)  NOT NULL DEFAULT 'bug',               -- bug | feature | question
  state           VARCHAR(24)  NOT NULL DEFAULT 'open',              -- open|in_progress|verifying|resolved|closed（+内部态 claiming）
  title           VARCHAR(256) NOT NULL,
  description     TEXT NULL,
  reporter_uid    VARCHAR(128) NOT NULL DEFAULT '',
  reporter_name   VARCHAR(128) NOT NULL DEFAULT '',
  assignee_uid    VARCHAR(128) NOT NULL DEFAULT '',
  context_json    JSON NULL,                                         -- 自动采集上下文
  linked_job_id   VARCHAR(64)  NOT NULL DEFAULT '',                  -- 关联 Agent 任务
  claim_token     VARCHAR(128) NOT NULL DEFAULT '',                  -- 幂等领取 token
  source          VARCHAR(24)  NOT NULL DEFAULT 'reporter',          -- reporter | manual
  auto_claimed    TINYINT(1)   NOT NULL DEFAULT 0,
  claimed_at      VARCHAR(64) NULL,
  created_at      VARCHAR(64)  NOT NULL,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_webdev_issues_tenant_no (tenant, display_no),
  KEY idx_webdev_issues_tenant_state (tenant, state, created_at),
  KEY idx_webdev_issues_tenant_app (tenant, app_code, created_at),
  KEY idx_webdev_issues_tenant_page (tenant, app_code, page_key, created_at),
  KEY idx_webdev_issues_reporter_page (tenant, reporter_uid, page_key, created_at),
  KEY idx_webdev_issues_fingerprint (tenant, fingerprint, created_at),
  KEY idx_webdev_issues_job (linked_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Issue 操作流水（指派/状态变更/领取，供详情时间线与审计）
CREATE TABLE IF NOT EXISTS webdev_issue_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant      VARCHAR(64) NOT NULL DEFAULT '',
  issue_id    VARCHAR(64) NOT NULL,
  actor       VARCHAR(128) NOT NULL DEFAULT '',
  action      VARCHAR(48)  NOT NULL,                                 -- created|claimed|assigned|state_changed|commented|closed
  detail_json JSON NULL,
  created_at  VARCHAR(64)  NOT NULL,
  KEY idx_webdev_issue_events_issue (issue_id, id),
  KEY idx_webdev_issue_events_tenant (tenant, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 租户内短号计数器（display_no 按 tenant 分配）
CREATE TABLE IF NOT EXISTS webdev_issue_counters (
  tenant     VARCHAR(64) PRIMARY KEY,
  next_no    BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 自动领取规则（按租户单条配置，项目设置维护；env 仅作兜底）
CREATE TABLE IF NOT EXISTS webdev_issue_settings (
  tenant             VARCHAR(64) PRIMARY KEY,
  auto_claim_enabled TINYINT(1)  NOT NULL DEFAULT 1,
  severity_min       VARCHAR(16) NOT NULL DEFAULT 'high',  -- high | mid | low
  kinds_json         JSON NULL,                            -- 命中的类型，如 ["bug"]
  apps_json          JSON NULL,                            -- 命中的来源应用，如 ["finance","workflow","codocs"]
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
