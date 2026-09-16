package productcenter

import (
	"context"
	"database/sql"
	"strings"
	"time"
	"unicode/utf8"
)

type LightweightPlanSummary struct {
	SelectedCount        int         `json:"selected_count"`
	EstimatedPersonDays  *Hundredths `json:"estimated_person_days"`
	UnknownEstimateCount int         `json:"unknown_estimate_count"`
	RemainingPersonDays  *Hundredths `json:"remaining_person_days"`
	Issues               []string    `json:"issues"`
}
type LightweightPlanConfirmation struct {
	ID            int64  `json:"id"`
	PlanRevision  uint64 `json:"plan_revision"`
	ScopeRevision uint64 `json:"scope_revision"`
	ConfirmedBy   string `json:"confirmed_by"`
	ConfirmedAt   string `json:"confirmed_at"`
}
type LightweightVersionPlan struct {
	PlanningMode        string                       `json:"planning_mode"`
	PlanStatus          string                       `json:"plan_status"`
	Goal                *string                      `json:"goal"`
	StartsOn            *string                      `json:"starts_on"`
	PlannedReleaseDate  *string                      `json:"planned_release_date"`
	AvailablePersonDays *Hundredths                  `json:"available_person_days"`
	ReservePersonDays   *Hundredths                  `json:"reserve_person_days"`
	WorkspaceRevision   uint64                       `json:"workspace_revision"`
	VersionRevision     uint64                       `json:"version_revision"`
	PlanRevision        uint64                       `json:"plan_revision"`
	ScopeRevision       uint64                       `json:"scope_revision"`
	Confirmation        *LightweightPlanConfirmation `json:"confirmation"`
	Summary             LightweightPlanSummary       `json:"summary"`
}
type LightweightVersionPlanEdit struct {
	VersionID               int64       `json:"version_id"`
	ExpectedRevision        uint64      `json:"expected_revision"`
	ExpectedVersionRevision uint64      `json:"expected_version_revision"`
	ExpectedPlanRevision    uint64      `json:"expected_plan_revision"`
	Goal                    string      `json:"goal"`
	StartsOn                string      `json:"starts_on"`
	PlannedReleaseDate      string      `json:"planned_release_date"`
	AvailablePersonDays     *Hundredths `json:"available_person_days"`
	ReservePersonDays       *Hundredths `json:"reserve_person_days"`
	Reason                  string      `json:"reason"`
}
type LightweightVersionPlanItemQuery struct {
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Keyword  string `json:"keyword"`
}
type LightweightVersionPlanItemRecord struct {
	ID                 int64       `json:"id"`
	BizID              string      `json:"biz_id"`
	VersionID          int64       `json:"version_id"`
	PlanningItemBizID  string      `json:"planning_item_biz_id"`
	RequestBizID       string      `json:"request_biz_id"`
	RequestTitle       string      `json:"request_title"`
	ComponentID        *int64      `json:"component_id"`
	ComponentName      *string     `json:"component_name"`
	ScopeSummary       string      `json:"scope_summary"`
	EstimatePersonDays *Hundredths `json:"estimate_person_days"`
	AcceptanceCriteria *string     `json:"acceptance_criteria"`
	SortOrder          int32       `json:"sort_order"`
	Status             string      `json:"status"`
	Revision           uint64      `json:"revision"`
	HandoffCount       int         `json:"handoff_count"`
}
type LightweightVersionPlanItemPage struct {
	Items             []LightweightVersionPlanItemRecord `json:"items"`
	Total             int                                `json:"total"`
	Page              int                                `json:"page"`
	PageSize          int                                `json:"pageSize"`
	WorkspaceRevision uint64                             `json:"workspace_revision"`
	VersionRevision   uint64                             `json:"version_revision"`
	PlanRevision      uint64                             `json:"plan_revision"`
	ScopeRevision     uint64                             `json:"scope_revision"`
}
type LightweightVersionPlanItemCreate struct {
	VersionID               int64       `json:"version_id"`
	ExpectedRevision        uint64      `json:"expected_revision"`
	ExpectedVersionRevision uint64      `json:"expected_version_revision"`
	ExpectedPlanRevision    uint64      `json:"expected_plan_revision"`
	ExpectedRequestRevision uint64      `json:"expected_request_revision"`
	RequestBizID            string      `json:"request_biz_id"`
	ScopeSummary            string      `json:"scope_summary"`
	EstimatePersonDays      *Hundredths `json:"estimate_person_days"`
	AcceptanceCriteria      string      `json:"acceptance_criteria"`
	SortOrder               int32       `json:"sort_order"`
	AdoptRequest            bool        `json:"adopt_request"`
	Reason                  string      `json:"reason"`
}
type LightweightVersionPlanItemEdit struct {
	VersionID               int64       `json:"version_id"`
	ScopeID                 int64       `json:"scope_id"`
	ExpectedRevision        uint64      `json:"expected_revision"`
	ExpectedVersionRevision uint64      `json:"expected_version_revision"`
	ExpectedPlanRevision    uint64      `json:"expected_plan_revision"`
	ExpectedScopeRevision   uint64      `json:"expected_scope_revision"`
	ScopeSummary            string      `json:"scope_summary"`
	EstimatePersonDays      *Hundredths `json:"estimate_person_days"`
	AcceptanceCriteria      string      `json:"acceptance_criteria"`
	SortOrder               int32       `json:"sort_order"`
	Reason                  string      `json:"reason"`
}
type LightweightVersionPlanItemDelete struct {
	VersionID               int64  `json:"version_id"`
	ScopeID                 int64  `json:"scope_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedPlanRevision    uint64 `json:"expected_plan_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
	Reason                  string `json:"reason"`
}
type LightweightVersionPlanConfirm struct {
	VersionID               int64  `json:"version_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedPlanRevision    uint64 `json:"expected_plan_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
}
type lightweightPlanRow struct {
	Goal          sql.NullString
	StartsOn      sql.NullString
	Available     sql.NullString
	Reserve       sql.NullString
	Revision      uint64
	ScopeRevision uint64
}

func parsePlanNumber(value sql.NullString) (*Hundredths, error) {
	if !value.Valid {
		return nil, nil
	}
	v, e := ParseHundredths(value.String)
	if e != nil {
		return nil, e
	}
	return &v, nil
}
func parsePlanDate(value string) error {
	if value == "" {
		return nil
	}
	d, e := time.Parse("2006-01-02", value)
	if e != nil || d.Year() < 1000 || d.Format("2006-01-02") != value {
		return invalid("product_version_plan_invalid", "计划日期无效")
	}
	return nil
}
func validPlanText(value string, max int, required bool) bool {
	return utf8.ValidString(value) && !strings.ContainsRune(value, '\x00') && utf8.RuneCountInString(value) <= max && (!required || strings.TrimSpace(value) != "")
}
func loadSimplePlanTx(ctx context.Context, tx *sql.Tx, code string, versionID int64) (ProductVersionRecord, lightweightPlanRow, error) {
	var p lightweightPlanRow
	v, e := loadProductVersion(ctx, tx, code, versionID)
	if e != nil {
		return v, p, e
	}
	if v.PlanningMode != "simple" {
		return v, p, invalid("product_version_plan_not_simple", "该版本使用高级周期规划")
	}
	e = tx.QueryRowContext(ctx, `SELECT goal,DATE_FORMAT(starts_on,'%Y-%m-%d'),available_person_days,reserve_person_days,revision,scope_revision FROM product_version_plans WHERE version_id=? AND product_code=? FOR UPDATE`, versionID, code).Scan(&p.Goal, &p.StartsOn, &p.Available, &p.Reserve, &p.Revision, &p.ScopeRevision)
	if e == sql.ErrNoRows {
		return v, p, invalid("product_version_plan_unavailable", "轻量计划元数据不存在，请先应用迁移")
	}
	return v, p, e
}
func planConfirmationTx(ctx context.Context, tx *sql.Tx, versionID int64, p lightweightPlanRow) (*LightweightPlanConfirmation, error) {
	var out LightweightPlanConfirmation
	e := tx.QueryRowContext(ctx, `SELECT id,plan_revision,scope_revision,confirmed_by,DATE_FORMAT(confirmed_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM product_version_plan_confirmations WHERE version_id=? AND invalidated_at IS NULL AND plan_revision=? AND scope_revision=? ORDER BY id DESC LIMIT 1`, versionID, p.Revision, p.ScopeRevision).Scan(&out.ID, &out.PlanRevision, &out.ScopeRevision, &out.ConfirmedBy, &out.ConfirmedAt)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	return &out, e
}
func planSummaryTx(ctx context.Context, tx *sql.Tx, versionID int64, p lightweightPlanRow) (LightweightPlanSummary, error) {
	out := LightweightPlanSummary{Issues: []string{}}
	var total sql.NullString
	if e := tx.QueryRowContext(ctx, `SELECT COUNT(*),COUNT(CASE WHEN estimate_person_days IS NULL THEN 1 END),CAST(SUM(estimate_person_days) AS CHAR) FROM product_version_plan_scopes WHERE version_id=?`, versionID).Scan(&out.SelectedCount, &out.UnknownEstimateCount, &total); e != nil {
		return out, e
	}
	var e error
	out.EstimatedPersonDays, e = parsePlanNumber(total)
	if e != nil {
		return out, e
	}
	a, e := parsePlanNumber(p.Available)
	if e != nil {
		return out, e
	}
	r, e := parsePlanNumber(p.Reserve)
	if e != nil {
		return out, e
	}
	if a == nil {
		out.Issues = append(out.Issues, "available_person_days_required")
	} else if r == nil {
		out.Issues = append(out.Issues, "reserve_person_days_required")
	} else if *r > *a {
		out.Issues = append(out.Issues, "reserve_exceeds_available")
	} else {
		left := *a - *r
		if out.EstimatedPersonDays != nil {
			left -= *out.EstimatedPersonDays
		}
		out.RemainingPersonDays = &left
		if left < 0 {
			out.Issues = append(out.Issues, "capacity_exceeded")
		}
	}
	if out.SelectedCount == 0 {
		out.Issues = append(out.Issues, "scope_required")
	}
	if strings.TrimSpace(valueOrEmpty(p.Goal)) == "" {
		out.Issues = append(out.Issues, "goal_required")
	}
	if !p.StartsOn.Valid {
		out.Issues = append(out.Issues, "starts_on_required")
	}
	var release sql.NullString
	var owner sql.NullString
	if e := tx.QueryRowContext(ctx, `SELECT DATE_FORMAT(planned_release_date,'%Y-%m-%d'),business_owner_uid FROM product_versions WHERE id=?`, versionID).Scan(&release, &owner); e != nil {
		return out, e
	}
	if !release.Valid {
		out.Issues = append(out.Issues, "planned_release_date_required")
	} else if p.StartsOn.Valid && p.StartsOn.String > release.String {
		out.Issues = append(out.Issues, "plan_date_order_invalid")
	}
	if !owner.Valid {
		out.Issues = append(out.Issues, "business_owner_required")
	} else {
		var active int
		if e := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_members WHERE product_code=(SELECT product_code FROM product_versions WHERE id=?) AND uid=? AND status='active' AND valid_from<=UTC_TIMESTAMP(3) AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP(3))`, versionID, owner.String).Scan(&active); e != nil {
			return out, e
		}
		if active == 0 {
			out.Issues = append(out.Issues, "business_owner_unavailable")
		}
	}
	if out.UnknownEstimateCount > 0 {
		out.Issues = append(out.Issues, "estimate_required")
	}
	var missingCriteria, unaccepted int
	if e := tx.QueryRowContext(ctx, `SELECT COUNT(CASE WHEN f.acceptance_criteria IS NULL OR CHAR_LENGTH(TRIM(f.acceptance_criteria))=0 THEN 1 END),COUNT(CASE WHEN r.decision_status<>'accepted' THEN 1 END) FROM product_version_plan_scopes s JOIN product_version_features f ON f.id=s.version_feature_id JOIN product_requests r ON r.id=s.request_id WHERE s.version_id=?`, versionID).Scan(&missingCriteria, &unaccepted); e != nil {
		return out, e
	}
	if missingCriteria > 0 {
		out.Issues = append(out.Issues, "acceptance_criteria_required")
	}
	if unaccepted > 0 {
		out.Issues = append(out.Issues, "source_request_not_accepted")
	}
	// A delivered scope remains part of the committed capacity.  Deferred
	// scopes and finished planning items, however, no longer describe a
	// deliverable plan and must make an existing confirmation stale.
	var unavailable, missingScopeSummary int
	if e := tx.QueryRowContext(ctx, `SELECT COUNT(CASE WHEN f.status='deferred' OR i.lifecycle IN ('merged','cancelled') THEN 1 END),COUNT(CASE WHEN CHAR_LENGTH(TRIM(s.scope_summary))=0 THEN 1 END) FROM product_version_plan_scopes s JOIN product_version_features f ON f.id=s.version_feature_id JOIN product_planning_items i ON i.id=s.planning_item_id WHERE s.version_id=?`, versionID).Scan(&unavailable, &missingScopeSummary); e != nil {
		return out, e
	}
	if unavailable > 0 {
		out.Issues = append(out.Issues, "scope_unavailable")
	}
	if missingScopeSummary > 0 {
		out.Issues = append(out.Issues, "scope_summary_required")
	}
	var dependencyBlocked int
	if e := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_plan_scopes s JOIN product_version_features current_scope ON current_scope.id=s.version_feature_id JOIN product_planning_dependencies d ON d.planning_item_id=s.planning_item_id AND d.product_code=s.product_code LEFT JOIN product_version_plan_scopes prior ON prior.version_id=s.version_id AND prior.planning_item_id=d.predecessor_id LEFT JOIN product_version_features predecessor_scope ON predecessor_scope.id=prior.version_feature_id LEFT JOIN product_planning_items pi ON pi.id=d.predecessor_id WHERE s.version_id=? AND pi.lifecycle<>'delivered' AND (prior.version_feature_id IS NULL OR predecessor_scope.sort_order>current_scope.sort_order OR (predecessor_scope.sort_order=current_scope.sort_order AND predecessor_scope.id>=current_scope.id))`, versionID).Scan(&dependencyBlocked); e != nil {
		return out, e
	}
	if dependencyBlocked > 0 {
		out.Issues = append(out.Issues, "dependency_blocked")
	}
	return out, nil
}
func ReadLightweightVersionPlan(ctx context.Context, db *sql.DB, code, uid string, versionID int64, permit, requestPermit AuthorizationPermit) (LightweightVersionPlan, error) {
	var out LightweightVersionPlan
	tx, e := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if e = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); e != nil {
		return out, e
	}
	if e = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_requests", "view", requestPermit); e != nil {
		return out, e
	}
	v, p, e := loadSimplePlanTx(ctx, tx, code, versionID)
	if e != nil {
		return out, e
	}
	out.PlanningMode = "simple"
	out.Goal = nullableString(p.Goal)
	out.StartsOn = nullableString(p.StartsOn)
	out.PlannedReleaseDate = v.PlannedReleaseDate
	out.AvailablePersonDays, e = parsePlanNumber(p.Available)
	if e != nil {
		return out, e
	}
	out.ReservePersonDays, e = parsePlanNumber(p.Reserve)
	if e != nil {
		return out, e
	}
	out.WorkspaceRevision = permit.Facts.Revision
	out.VersionRevision = v.Revision
	out.PlanRevision = p.Revision
	out.ScopeRevision = p.ScopeRevision
	out.Confirmation, e = planConfirmationTx(ctx, tx, versionID, p)
	if e != nil {
		return out, e
	}
	out.PlanStatus = "draft"
	if out.Confirmation != nil {
		out.PlanStatus = "confirmed"
	} else {
		var old int
		if e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_version_plan_confirmations WHERE version_id=?`, versionID).Scan(&old); e != nil {
			return out, e
		}
		if old > 0 {
			out.PlanStatus = "stale"
		}
	}
	out.Summary, e = planSummaryTx(ctx, tx, versionID, p)
	if e != nil {
		return out, e
	}
	if out.Confirmation != nil && len(out.Summary.Issues) > 0 {
		out.PlanStatus = "stale"
	}
	return out, tx.Commit()
}
func nullableString(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	x := s.String
	return &x
}
func planExpected(root ProductVersionRecord, p lightweightPlanRow, expectedRev, expectedVersion, expectedPlan uint64) error {
	if expectedRev == 0 || expectedVersion == 0 || expectedPlan == 0 {
		return invalid("product_version_plan_revision_required", "必须提供计划修订")
	}
	if root.Revision != expectedVersion {
		return invalid("product_version_revision_conflict", "版本已变化")
	}
	if p.Revision != expectedPlan {
		return invalid("product_version_plan_revision_conflict", "计划已变化")
	}
	return nil
}
