-- PC17 progress is independent of legacy decision receipts; v1 retries cannot erase it.
CREATE TABLE IF NOT EXISTS product_feedback_progress_projection (
    ticket_id BIGINT NOT NULL PRIMARY KEY,
    source_revision BIGINT UNSIGNED NOT NULL,
    command_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    snapshot_json JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_feedback_progress_submission FOREIGN KEY(ticket_id) REFERENCES service_ticket_product_feedback(ticket_id),
    CONSTRAINT ck_feedback_progress_revision CHECK(source_revision > 0 AND source_revision <= 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
