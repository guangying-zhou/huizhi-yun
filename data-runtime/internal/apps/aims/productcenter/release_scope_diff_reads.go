package productcenter

import (
	"context"
	"database/sql"
)

type ReleaseScopeDiffQuery struct {
	BeforeVersionID int64 `json:"before_version_id"`
	BeforeRecordID  int64 `json:"before_record_id"`
	AfterVersionID  int64 `json:"after_version_id"`
	AfterRecordID   int64 `json:"after_record_id"`
	Page            int   `json:"page"`
	PageSize        int   `json:"page_size"`
}
type ReleaseScopeDiffPage struct {
	ReleaseScopeDiff
	BeforeRecordID    int64  `json:"before_record_id"`
	AfterRecordID     int64  `json:"after_record_id"`
	BeforeContentHash string `json:"before_content_hash"`
	AfterContentHash  string `json:"after_content_hash"`
	ProductCode       string `json:"product_code"`
	WorkspaceRevision uint64 `json:"workspace_revision"`
	Total             int    `json:"total"`
	Page              int    `json:"page"`
	PageSize          int    `json:"pageSize"`
}

func ReadReleaseScopeDiff(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q ReleaseScopeDiffQuery) (ReleaseScopeDiffPage, error) {
	out := ReleaseScopeDiffPage{ProductCode: code, BeforeRecordID: q.BeforeRecordID, AfterRecordID: q.AfterRecordID, Page: q.Page, PageSize: q.PageSize}
	if q.BeforeVersionID < 1 || q.AfterVersionID < 1 || q.BeforeRecordID < 1 || q.AfterRecordID < 1 {
		return out, invalid("product_release_diff_query_invalid", "发布对比标识无效")
	}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize}); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	before, err := loadProductVersionRelease(ctx, tx, code, q.BeforeVersionID, q.BeforeRecordID)
	if err != nil {
		return out, err
	}
	after, err := loadProductVersionRelease(ctx, tx, code, q.AfterVersionID, q.AfterRecordID)
	if err != nil {
		return out, err
	}
	diff, err := CompareReleaseScopes(before, after)
	if err != nil {
		return out, err
	}
	out.Total = len(diff.Changes)
	start := (q.Page - 1) * q.PageSize
	if start > len(diff.Changes) {
		start = len(diff.Changes)
	}
	end := start + q.PageSize
	if end > len(diff.Changes) {
		end = len(diff.Changes)
	}
	diff.Changes = diff.Changes[start:end]
	out.ReleaseScopeDiff = diff
	out.BeforeContentHash, out.AfterContentHash = before.ContentHash, after.ContentHash
	out.WorkspaceRevision = permit.Facts.Revision
	return out, tx.Commit()
}
