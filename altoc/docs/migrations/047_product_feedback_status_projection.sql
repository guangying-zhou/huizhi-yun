-- PC17: AIMS decision projection; never updates service_ticket status or SLA.
CREATE TABLE IF NOT EXISTS product_feedback_status_projection (
    ticket_id BIGINT NOT NULL PRIMARY KEY,
    source_revision BIGINT UNSIGNED NOT NULL,
    command_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    canonical_request_biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    decision_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_feedback_status_submission FOREIGN KEY(ticket_id) REFERENCES service_ticket_product_feedback(ticket_id),
    CONSTRAINT ck_feedback_status_revision CHECK(source_revision > 0),
    CONSTRAINT ck_feedback_status_decision CHECK(decision_status IN ('submitted','evaluating','accepted','deferred','rejected','merged'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
