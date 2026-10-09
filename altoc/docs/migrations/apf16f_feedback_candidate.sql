-- APF-16f fresh unified-domain candidate. Not executed.
-- Install only through reviewed Registry domain installer; no legacy view aliases.
CREATE TABLE altoc_service_ticket_product_feedback (
    ticket_id BIGINT NOT NULL PRIMARY KEY,
    submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    operation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    original_actor_uid VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uk_product_feedback_submission (submission_id),
    UNIQUE KEY uk_product_feedback_request (request_biz_id),
    UNIQUE KEY uk_product_feedback_operation (operation_id),
    CONSTRAINT apf16f_fk_product_feedback_ticket FOREIGN KEY (ticket_id) REFERENCES altoc_service_ticket(id),
    CONSTRAINT apf16f_ck_product_feedback_product CHECK (CHAR_LENGTH(TRIM(product_code)) > 0),
    CONSTRAINT apf16f_ck_product_feedback_actor CHECK (CHAR_LENGTH(TRIM(original_actor_uid)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE altoc_product_feedback_status_projection (
    ticket_id BIGINT NOT NULL PRIMARY KEY,
    source_revision BIGINT UNSIGNED NOT NULL,
    command_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    canonical_request_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    decision_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT apf16f_fk_feedback_status_submission FOREIGN KEY(ticket_id) REFERENCES altoc_service_ticket_product_feedback(ticket_id),
    CONSTRAINT apf16f_ck_feedback_status_revision CHECK(source_revision > 0),
    CONSTRAINT apf16f_ck_feedback_status_decision CHECK(decision_status IN ('submitted','evaluating','accepted','deferred','rejected','merged'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE altoc_product_feedback_progress_projection (
    ticket_id BIGINT NOT NULL PRIMARY KEY,
    source_revision BIGINT UNSIGNED NOT NULL,
    command_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    snapshot_json JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT apf16f_fk_feedback_progress_submission FOREIGN KEY(ticket_id) REFERENCES altoc_service_ticket_product_feedback(ticket_id),
    CONSTRAINT apf16f_ck_feedback_progress_revision CHECK(source_revision > 0 AND source_revision <= 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
