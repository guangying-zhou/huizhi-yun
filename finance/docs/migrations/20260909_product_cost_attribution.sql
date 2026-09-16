-- Execute against the explicitly selected Finance database. No historical backfill.
CREATE TABLE IF NOT EXISTS product_cost_attribution_head (
    project_code VARCHAR(50) COLLATE utf8mb4_bin NOT NULL,
    period_month CHAR(7) NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (project_code, period_month),
    CONSTRAINT chk_product_cost_head_revision CHECK (revision >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='产品成本期间归因当前修订及并发锁';

CREATE TABLE IF NOT EXISTS product_cost_attribution_revision (
    project_code VARCHAR(50) COLLATE utf8mb4_bin NOT NULL,
    period_month CHAR(7) NOT NULL,
    revision BIGINT NOT NULL,
    evidence_ref VARCHAR(500) NOT NULL,
    shares_json JSON NOT NULL,
    total_basis_points INT NOT NULL,
    created_by VARCHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (project_code, period_month, revision),
    CONSTRAINT fk_product_cost_revision_head FOREIGN KEY (project_code, period_month)
        REFERENCES product_cost_attribution_head(project_code, period_month),
    CONSTRAINT chk_product_cost_revision CHECK (revision > 0),
    CONSTRAINT chk_product_cost_total CHECK (total_basis_points BETWEEN 0 AND 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='产品成本归因不可变修订，完整产品比例集合';
