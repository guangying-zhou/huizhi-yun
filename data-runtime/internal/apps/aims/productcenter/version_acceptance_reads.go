package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

type VersionAcceptanceRecord struct {
	ID            int64  `json:"id"`
	VersionID     int64  `json:"version_id"`
	ScopeRevision uint64 `json:"scope_revision"`
	AcceptedBy    string `json:"accepted_by"`
	AcceptedAt    string `json:"accepted_at"`
}
type VersionAcceptancePage struct {
	Items                []VersionAcceptanceRecord `json:"items"`
	Total                int                       `json:"total"`
	Page                 int                       `json:"page"`
	PageSize             int                       `json:"pageSize"`
	CurrentScopeRevision uint64                    `json:"current_scope_revision"`
}
type VersionAcceptanceDetail struct {
	VersionAcceptanceRecord
	Checks               []VersionAcceptanceCheck     `json:"checks"`
	Exceptions           []VersionAcceptanceException `json:"exceptions"`
	CurrentScopeRevision uint64                       `json:"current_scope_revision"`
}

// History records remain readable after the version or workspace is archived.
// A matching scope revision alone does not prove readiness to publish: execution
// facts and release authorization must be checked by the release command.
func ListProductVersionAcceptances(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID int64, q PlanningPageQuery) (VersionAcceptancePage, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return VersionAcceptancePage{}, err
	}
	defer tx.Rollback()
	out, err := ListProductVersionAcceptancesInTransaction(ctx, tx, code, uid, permit, versionID, q)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ListProductVersionAcceptancesInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, versionID int64, q PlanningPageQuery) (VersionAcceptancePage, error) {
	out := VersionAcceptancePage{Items: []VersionAcceptanceRecord{}, Page: q.Page, PageSize: q.PageSize}
	if versionID <= 0 || q.Keyword != "" || q.Lifecycle != "" || q.InvestmentCategory != "" {
		return out, invalid("product_version_acceptance_query_invalid", "验收记录查询条件无效")
	}
	if err := ValidatePlanningPageQuery(q); err != nil {
		return out, err
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "History requires a transaction")
	}
	var err error
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	version, err := loadProductVersion(ctx, tx, code, versionID)
	if err != nil {
		return out, err
	}
	out.CurrentScopeRevision = version.ScopeRevision
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_acceptances WHERE version_id=?`, versionID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,version_id,scope_revision,accepted_by,DATE_FORMAT(accepted_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM product_version_acceptances WHERE version_id=? ORDER BY id DESC LIMIT ? OFFSET ?`, versionID, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item VersionAcceptanceRecord
		if err = rows.Scan(&item.ID, &item.VersionID, &item.ScopeRevision, &item.AcceptedBy, &item.AcceptedAt); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, nil
}

// Expose the human review evidence, not the complete stored execution snapshot:
// project execution details retain their own access boundary.
func ReadProductVersionAcceptance(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, versionID, acceptanceID int64) (VersionAcceptanceDetail, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return VersionAcceptanceDetail{}, err
	}
	defer tx.Rollback()
	out, err := ReadProductVersionAcceptanceInTransaction(ctx, tx, code, uid, permit, versionID, acceptanceID)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ReadProductVersionAcceptanceInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, versionID, acceptanceID int64) (VersionAcceptanceDetail, error) {
	var out VersionAcceptanceDetail
	if versionID <= 0 || acceptanceID <= 0 {
		return out, invalid("product_version_acceptance_query_invalid", "验收记录标识无效")
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "History requires a transaction")
	}
	var err error
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	version, err := loadProductVersion(ctx, tx, code, versionID)
	if err != nil {
		return out, err
	}
	out.CurrentScopeRevision = version.ScopeRevision
	var checklist, exceptions []byte
	err = tx.QueryRowContext(ctx, `SELECT id,version_id,scope_revision,accepted_by,DATE_FORMAT(accepted_at,'%Y-%m-%dT%H:%i:%s.%fZ'),checklist,exceptions FROM product_version_acceptances WHERE id=? AND version_id=?`, acceptanceID, versionID).Scan(&out.ID, &out.VersionID, &out.ScopeRevision, &out.AcceptedBy, &out.AcceptedAt, &checklist, &exceptions)
	if err == sql.ErrNoRows {
		return out, invalid("product_version_acceptance_not_found", "验收记录不存在")
	}
	if err != nil {
		return out, err
	}
	var stored struct {
		Checks []VersionAcceptanceCheck `json:"checks"`
	}
	if err = json.Unmarshal(checklist, &stored); err != nil {
		return out, err
	}
	out.Checks = stored.Checks
	if err = json.Unmarshal(exceptions, &out.Exceptions); err != nil {
		return out, err
	}
	if out.Checks == nil {
		out.Checks = []VersionAcceptanceCheck{}
	}
	if out.Exceptions == nil {
		out.Exceptions = []VersionAcceptanceException{}
	}
	return out, nil
}
