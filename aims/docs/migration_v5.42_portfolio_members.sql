-- Aims migration v5.42: portfolio members and registered document repository.
-- Document asset design DOC-05a (docs/Document-Asset-DOC-05-06-Implementation-Spec.md §3).
--
-- CANDIDATE ONLY. Executing it is an environment write and needs approval for
-- the target environment. CREATE TABLE is not re-runnable: check that the
-- tables do not exist first (SHOW TABLES LIKE 'aims_portfolio_%'). There is no
-- backfill; an existing portfolio owner counts as a manager without a row.
--
-- Standalone Aims databases: run this file as is.
-- Unified Enterprise database (activated Aims domain): do NOT run this file.
-- Install the same two tables through the domain installer subset
-- "aims-portfolio-members" (cmd/hzy-enterprise-add-apf --subset), which also
-- registers the mapping; until then the member entry points answer 503
-- aims_portfolio_members_unavailable and every other Aims function is unchanged.
--
-- The tables are not part of the compatibility view family: logical and
-- physical names are identical in both deployments.

CREATE TABLE aims_portfolio_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  portfolio_id BIGINT UNSIGNED NOT NULL,
  uid VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  relation_type ENUM('manager','contributor','viewer') NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  valid_from DATETIME(3) NOT NULL,
  valid_until DATETIME(3) NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  updated_by VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aims_portfolio_member (portfolio_id, uid),
  KEY idx_aims_portfolio_member_uid (uid, status),
  CONSTRAINT ck_aims_portfolio_member_dates CHECK (valid_until IS NULL OR valid_until > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE aims_portfolio_doc_repos (
  portfolio_id BIGINT UNSIGNED NOT NULL,
  integration_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  repo_path VARCHAR(255) COLLATE utf8mb4_bin NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  updated_by VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (portfolio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
