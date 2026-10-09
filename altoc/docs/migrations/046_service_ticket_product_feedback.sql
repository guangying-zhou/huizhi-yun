-- PC17: immutable source submission identity; operation and binding are written together.
CREATE TABLE IF NOT EXISTS service_ticket_product_feedback (
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
    CONSTRAINT fk_product_feedback_ticket FOREIGN KEY (ticket_id) REFERENCES service_ticket(id),
    CONSTRAINT ck_product_feedback_product CHECK (CHAR_LENGTH(TRIM(product_code)) > 0),
    CONSTRAINT ck_product_feedback_actor CHECK (CHAR_LENGTH(TRIM(original_actor_uid)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
