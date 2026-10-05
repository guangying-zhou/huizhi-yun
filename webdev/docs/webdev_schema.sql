CREATE DATABASE IF NOT EXISTS hzy_webdev
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE hzy_webdev;

CREATE TABLE IF NOT EXISTS webdev_projects (
  project_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webdev_agents (
  agent_id VARCHAR(64) PRIMARY KEY,
  owner_uid VARCHAR(128) NOT NULL DEFAULT '',
  endpoint VARCHAR(512) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'offline',
  last_seen_at VARCHAR(64) NULL,
  version VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webdev_project_repos (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  repo_id VARCHAR(64) NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  default_branch VARCHAR(128) NOT NULL DEFAULT 'main',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_webdev_project_repo (project_id, repo_id, agent_id),
  KEY idx_webdev_project_repos_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webdev_command_templates (
  template_id VARCHAR(128) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  repo_id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  scope VARCHAR(128) NOT NULL DEFAULT '',
  cwd VARCHAR(512) NOT NULL DEFAULT '',
  argv_json JSON NOT NULL,
  timeout_sec INT NOT NULL DEFAULT 1800,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_webdev_command_templates_project (project_id, repo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webdev_jobs (
  job_id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  repo_id VARCHAR(64) NOT NULL DEFAULT '',
  agent_id VARCHAR(64) NOT NULL DEFAULT '',
  type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  template_id VARCHAR(128) NOT NULL DEFAULT '',
  target VARCHAR(64) NOT NULL DEFAULT '',
  prompt TEXT NULL,
  created_by VARCHAR(128) NOT NULL DEFAULT '',
  created_at VARCHAR(64) NOT NULL,
  started_at VARCHAR(64) NULL,
  finished_at VARCHAR(64) NULL,
  exit_code INT NULL,
  error TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_webdev_jobs_project (project_id, created_at),
  KEY idx_webdev_jobs_agent (agent_id, created_at),
  KEY idx_webdev_jobs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webdev_job_events (
  job_id VARCHAR(64) NOT NULL,
  sequence BIGINT NOT NULL,
  level VARCHAR(32) NOT NULL DEFAULT 'system',
  message TEXT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (job_id, sequence),
  KEY idx_webdev_job_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webdev_job_artifacts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  uri VARCHAR(1024) NOT NULL DEFAULT '',
  summary_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_webdev_job_artifacts_job (job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webdev_deployments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL DEFAULT '',
  module VARCHAR(64) NOT NULL DEFAULT '',
  target VARCHAR(64) NOT NULL DEFAULT '',
  worker_name VARCHAR(128) NOT NULL DEFAULT '',
  version_id VARCHAR(256) NOT NULL DEFAULT '',
  url VARCHAR(1024) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'created',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_webdev_deployments_job (job_id),
  KEY idx_webdev_deployments_project (project_id, module, target)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Issue 收件箱（来源：Foundation 报告组件 / 控制台手动），详见 docs/WebDev-Issue-Inbox-Design.md
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
