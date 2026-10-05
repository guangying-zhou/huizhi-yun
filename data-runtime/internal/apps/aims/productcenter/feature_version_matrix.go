package productcenter

import (
	"context"
	"database/sql"
	"strings"
)

type FeatureVersionMatrixQuery struct {
	VersionIDs []int64 `json:"version_ids"`
	Page       int     `json:"page"`
	PageSize   int     `json:"page_size"`
}
type FeatureVersionMatrixCell struct {
	LatestRelease         *FeatureReleaseEvidence `json:"latest_release"`
	ScopeID               *int64                  `json:"scope_id"`
	DeferredFromScopeID   *int64                  `json:"deferred_from_scope_id"`
	DeferredFromVersionID *int64                  `json:"deferred_from_version_id"`
	VersionID             int64                   `json:"version_id"`
	Planned               int                     `json:"planned"`
	Delivered             int                     `json:"delivered"`
	Deferred              int                     `json:"deferred"`
}
type FeatureVersionMatrixRow struct {
	FeatureBizID string                     `json:"feature_biz_id"`
	Title        string                     `json:"title"`
	Cells        []FeatureVersionMatrixCell `json:"cells"`
}
type FeatureVersionMatrix struct {
	ProductCode       string                    `json:"product_code"`
	WorkspaceRevision uint64                    `json:"workspace_revision"`
	VersionIDs        []int64                   `json:"version_ids"`
	Items             []FeatureVersionMatrixRow `json:"items"`
	Total             int                       `json:"total"`
	Page              int                       `json:"page"`
	PageSize          int                       `json:"pageSize"`
}

func ValidateFeatureVersionMatrixQuery(q FeatureVersionMatrixQuery) error {
	if len(q.VersionIDs) < 1 || len(q.VersionIDs) > 10 {
		return invalid("product_feature_version_matrix_invalid", "请选择 1 至 10 个版本")
	}
	seen := map[int64]bool{}
	for _, id := range q.VersionIDs {
		if id < 1 || seen[id] {
			return invalid("product_feature_version_matrix_invalid", "版本标识无效或重复")
		}
		seen[id] = true
	}
	return ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize})
}

// Counts current version scopes once per scope row. Delivered scope is not a
// release/deployment claim; immutable release evidence is queried separately.
func ReadFeatureVersionMatrix(ctx context.Context, db *sql.DB, code, uid string, featurePermit, versionPermit AuthorizationPermit, q FeatureVersionMatrixQuery) (FeatureVersionMatrix, error) {
	out := FeatureVersionMatrix{ProductCode: code, VersionIDs: q.VersionIDs, Items: []FeatureVersionMatrixRow{}, Page: q.Page, PageSize: q.PageSize}
	if err := ValidateFeatureVersionMatrixQuery(q); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_features", "view", featurePermit); err != nil {
		return out, err
	}
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", versionPermit); err != nil {
		return out, err
	}
	for _, id := range q.VersionIDs {
		if _, err = loadProductVersion(ctx, tx, code, id); err != nil {
			return out, err
		}
	}
	out.WorkspaceRevision = featurePermit.Facts.Revision
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_features WHERE BINARY product_code=BINARY ?`, code).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,biz_id,title FROM product_features WHERE BINARY product_code=BINARY ? ORDER BY id DESC LIMIT ? OFFSET ?`, code, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		var row FeatureVersionMatrixRow
		if err = rows.Scan(&id, &row.FeatureBizID, &row.Title); err != nil {
			rows.Close()
			return out, err
		}
		ids = append(ids, id)
		row.Cells = []FeatureVersionMatrixCell{}
		for _, version := range q.VersionIDs {
			row.Cells = append(row.Cells, FeatureVersionMatrixCell{VersionID: version})
		}
		out.Items = append(out.Items, row)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(ids) == 0 {
		return out, tx.Commit()
	}
	args := []any{code}
	for _, id := range ids {
		args = append(args, id)
	}
	for _, id := range q.VersionIDs {
		args = append(args, id)
	}
	marks := func(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }
	cells, err := tx.QueryContext(ctx, `SELECT s.product_feature_id,s.version_id,s.status,s.id,s.deferred_from_feature_id,source.version_id,source_version.product_code FROM product_version_features s JOIN product_versions v ON v.id=s.version_id LEFT JOIN product_version_features source ON source.id=s.deferred_from_feature_id LEFT JOIN product_versions source_version ON source_version.id=source.version_id WHERE BINARY v.product_code=BINARY ? AND s.product_feature_id IN (`+marks(len(ids))+`) AND s.version_id IN (`+marks(len(q.VersionIDs))+`)`, args...)
	if err != nil {
		return out, err
	}
	for cells.Next() {
		var feature, version int64
		var status string
		var scopeID int64
		var sourceScope, sourceVersion *int64
		var sourceCode *string
		if err = cells.Scan(&feature, &version, &status, &scopeID, &sourceScope, &sourceVersion, &sourceCode); err != nil {
			cells.Close()
			return out, err
		}
		for i, id := range ids {
			if id != feature {
				continue
			}
			for j := range out.Items[i].Cells {
				cell := &out.Items[i].Cells[j]
				if cell.VersionID != version {
					continue
				}
				if cell.ScopeID != nil || (sourceScope != nil && (sourceVersion == nil || sourceCode == nil || *sourceCode != code)) {
					cells.Close()
					return out, invalid("product_feature_version_matrix_invalid", "范围关联或顺延来源不一致")
				}
				cell.ScopeID = &scopeID
				cell.DeferredFromScopeID, cell.DeferredFromVersionID = sourceScope, sourceVersion
				switch status {
				case "planned":
					cell.Planned = 1
				case "delivered":
					cell.Delivered = 1
				case "deferred":
					cell.Deferred = 1
				default:
					cells.Close()
					return out, invalid("product_feature_version_matrix_invalid", "版本范围状态无效")
				}
			}
		}
	}
	err = cells.Err()
	cells.Close()
	if err != nil {
		return out, err
	}
	// At most ten selected versions; load each latest immutable release once,
	// never once per cell. Latest is not necessarily current (withdrawn/reopened).
	for column, versionID := range q.VersionIDs {
		var recordID int64
		err = tx.QueryRowContext(ctx, `SELECT id FROM product_release_records WHERE version_id=? ORDER BY release_seq DESC,id DESC LIMIT 1`, versionID).Scan(&recordID)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return out, err
		}
		detail, loadErr := loadProductVersionRelease(ctx, tx, code, versionID, recordID)
		if loadErr != nil {
			return out, loadErr
		}
		for row := range out.Items {
			evidence, projectionErr := featureReleaseEvidence(detail, out.Items[row].FeatureBizID)
			if projectionErr != nil {
				return out, projectionErr
			}
			out.Items[row].Cells[column].LatestRelease = &evidence
		}
	}
	return out, tx.Commit()
}
