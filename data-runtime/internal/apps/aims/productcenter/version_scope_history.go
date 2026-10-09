package productcenter

import (
	"context"
	"database/sql"
	"strconv"
)

type ProductVersionScopeHistoryRecord struct {
	ID             int64   `json:"id"`
	Action         string  `json:"action"`
	ActorUID       string  `json:"actor_uid"`
	CreatedAt      string  `json:"created_at"`
	Revision       uint64  `json:"revision"`
	Reason         string  `json:"reason"`
	Evidence       string  `json:"evidence"`
	BeforeCriteria *string `json:"before_criteria"`
	AfterCriteria  *string `json:"after_criteria"`
}
type ProductVersionScopeHistoryPage struct {
	Items     []ProductVersionScopeHistoryRecord `json:"items"`
	Total     int                                `json:"total"`
	Page      int                                `json:"page"`
	PageSize  int                                `json:"pageSize"`
	VersionID int64                              `json:"version_id"`
	ScopeID   int64                              `json:"scope_id"`
}

// Return explicit delivery/withdrawal evidence, never entire audit payloads
// which may contain unrelated planning or project execution snapshots.
func ListProductVersionScopeHistory(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID, scopeID int64, page, pageSize int) (ProductVersionScopeHistoryPage, error) {
	out := ProductVersionScopeHistoryPage{Items: []ProductVersionScopeHistoryRecord{}, VersionID: versionID, ScopeID: scopeID, Page: page, PageSize: pageSize}
	if versionID < 1 || scopeID < 1 || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return out, invalid("product_version_scope_history_invalid", "范围历史标识或分页无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	if _, err = loadProductVersion(ctx, tx, code, versionID); err != nil {
		return out, err
	}
	var found int64
	if err = tx.QueryRowContext(ctx, `SELECT id FROM product_version_features WHERE id=? AND version_id=?`, scopeID, versionID).Scan(&found); err != nil {
		return out, err
	}
	where := ` FROM product_activity_logs WHERE BINARY product_code=BINARY ? AND object_type='version' AND object_id=? AND action IN ('scope-deliver','scope-reopen','scope-legacy-criteria','scope-create','scope-edit') AND CAST(JSON_UNQUOTE(CASE action WHEN 'scope-create' THEN JSON_EXTRACT(changes,'$.after.id') WHEN 'scope-edit' THEN JSON_EXTRACT(changes,'$.result.id') ELSE JSON_EXTRACT(changes,'$.before.id') END) AS UNSIGNED)=?`
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, code, strconv.FormatInt(versionID, 10), scopeID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,action,actor_uid,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),revision,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(changes,'$.reason')),JSON_UNQUOTE(JSON_EXTRACT(changes,'$.after.reason')),JSON_UNQUOTE(JSON_EXTRACT(changes,'$.input.reason')),''),COALESCE(JSON_UNQUOTE(JSON_EXTRACT(changes,'$.evidence')),''),CASE WHEN JSON_TYPE(JSON_EXTRACT(changes,'$.before.acceptance_criteria'))='STRING' THEN JSON_UNQUOTE(JSON_EXTRACT(changes,'$.before.acceptance_criteria')) END,CASE WHEN JSON_TYPE(COALESCE(JSON_EXTRACT(changes,'$.after.acceptance_criteria'),JSON_EXTRACT(changes,'$.input.acceptance_criteria')))='STRING' THEN JSON_UNQUOTE(COALESCE(JSON_EXTRACT(changes,'$.after.acceptance_criteria'),JSON_EXTRACT(changes,'$.input.acceptance_criteria'))) END`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, code, strconv.FormatInt(versionID, 10), scopeID, pageSize, (page-1)*pageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var r ProductVersionScopeHistoryRecord
		if err = rows.Scan(&r.ID, &r.Action, &r.ActorUID, &r.CreatedAt, &r.Revision, &r.Reason, &r.Evidence, &r.BeforeCriteria, &r.AfterCriteria); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
