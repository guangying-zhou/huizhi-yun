-- APF-18B1 candidate only; install via reviewed domaininstall.
CREATE TABLE altoc_due_checkpoint (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 family VARCHAR(32) NOT NULL, source_kind VARCHAR(32) NOT NULL, source_id BIGINT UNSIGNED NOT NULL,
 source_code VARCHAR(64) NOT NULL, recipient_uid VARCHAR(64) NOT NULL, due_at DATETIME(3) NOT NULL,
 fact_hash CHAR(64) NOT NULL, event_key VARCHAR(191) NOT NULL, generation_no BIGINT UNSIGNED NOT NULL,
 notification_id VARCHAR(64) NULL, published_at DATETIME(3) NULL,
 closure_state ENUM('resolved','cancelled') NULL, closure_acked_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uk_event(event_key), UNIQUE KEY uk_generation(family,source_kind,source_id,generation_no),
 KEY idx_pending(family,published_at,id), KEY idx_closure(family,closure_state,closure_acked_at,id),
 CHECK (generation_no>0), CHECK(recipient_uid<>'' AND LOWER(recipient_uid)<>'@all')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE altoc_due_cursor (family VARCHAR(32) NOT NULL PRIMARY KEY, source_cursor VARCHAR(100) NOT NULL DEFAULT '', reconcile_cursor BIGINT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE altoc_due_audit (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,action VARCHAR(64) NOT NULL,counts JSON NOT NULL,client_code VARCHAR(64) NOT NULL,request_id VARCHAR(100) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
