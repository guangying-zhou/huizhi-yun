-- v2 collaboration sessions (stage B). A session is a short, renewable lease
-- opened by the Host for a verified writer of a published v2 document. While a
-- session is active, Host HTTP saves are refused (D3). Collab publishes only
-- through an active session whose epoch still matches the document head.
-- Dormant until the stage B routes are enabled; install only with them.
CREATE TABLE document_collaboration_sessions (
  tenant_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  deployment_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  epoch BIGINT NOT NULL,
  opened_by VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  status ENUM('active', 'closed', 'revoked') NOT NULL DEFAULT 'active',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_code, deployment_code, session_id),
  INDEX collaboration_session_document (tenant_code, deployment_code, document_uuid, status),
  CONSTRAINT collaboration_session_epoch CHECK (epoch >= 0)
) ENGINE=InnoDB;

-- One-time admission tickets (ADR-020 §5.1): the Host issues one per verified
-- user; Collab redeems it with its own service identity before exposing any
-- document state. Only the SHA-256 of the ticket is stored.
CREATE TABLE document_collaboration_tickets (
  tenant_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  deployment_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  ticket_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_uid VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  access ENUM('read', 'write') NOT NULL,
  expires_at DATETIME NOT NULL,
  redeemed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_code, deployment_code, ticket_sha256),
  INDEX collaboration_ticket_session (tenant_code, deployment_code, session_id)
) ENGINE=InnoDB;

-- Verified participants per session (ADR-020 §6.4) and the participant set
-- recorded with each collaborative publication.
CREATE TABLE document_collaboration_participants (
  tenant_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  deployment_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_uid VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  access ENUM('read', 'write') NOT NULL,
  first_admitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_admitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_code, deployment_code, session_id, user_uid)
) ENGINE=InnoDB;

CREATE TABLE document_collaboration_publications (
  tenant_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  deployment_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  candidate_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participants_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_code, deployment_code, candidate_key)
) ENGINE=InnoDB;
