package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const weeklyReportRAGRuleVersion = "rag-v1"

type weeklyReportVersionResult struct {
	ID                    int64           `json:"id"`
	ReportID              int64           `json:"reportId"`
	VersionNo             int             `json:"versionNo"`
	Kind                  string          `json:"kind"`
	CorrectionOfVersionID *int64          `json:"correctionOfVersionId"`
	CorrectionReason      *string         `json:"correctionReason"`
	ManagerContent        json.RawMessage `json:"managerContent"`
	FactSnapshot          json.RawMessage `json:"factSnapshot"`
	FactSnapshotSHA256    string          `json:"factSnapshotSha256"`
	SystemRAG             string          `json:"systemRag"`
	SelectedRAG           string          `json:"selectedRag"`
	RAGOverrideReason     *string         `json:"ragOverrideReason"`
	RAGRuleVersion        string          `json:"ragRuleVersion"`
	SubmittedBy           string          `json:"submittedBy"`
	SubmittedAt           string          `json:"submittedAt"`
}

type weeklyReportReviewResult struct {
	ID                 int64   `json:"id"`
	ReportVersionID    int64   `json:"reportVersionId"`
	Action             string  `json:"action"`
	Comment            *string `json:"comment"`
	ReviewerUID        string  `json:"reviewerUid"`
	RoleHolderRevision int64   `json:"roleHolderRevision"`
	CreatedAt          string  `json:"createdAt"`
}

type weeklyReportLockedProjection struct {
	ReportID                   int64
	ProjectID                  int64
	ObligationID               int64
	Status                     string
	CurrentVersionNo           int
	CurrentSubmittedVersionID  sql.NullInt64
	CurrentFrozenVersionID     sql.NullInt64
	PendingCorrectionOfVersion sql.NullInt64
	PendingCorrectionReason    sql.NullString
	PendingCorrectionRequestID sql.NullInt64
	ReportYear                 int
	ReportWeek                 int
	WeekStart                  string
	WeekEnd                    string
	MainWork                   sql.NullString
	OverallProgress            sql.NullString
	DepartmentName             sql.NullString
	ProjectTypeName            sql.NullString
	ProjectManagerName         sql.NullString
	InitiationStatus           sql.NullString
	CurrentStage               sql.NullString
	ProgressStatus             sql.NullString
	CompletionPercent          sql.NullString
	ContractStatus             sql.NullString
	ContractAmount             sql.NullString
	PaymentStatus              sql.NullString
	CumulativeLaborCost        sql.NullString
	MajorRisks                 sql.NullString
	CoordinationNeeds          sql.NullString
	Remarks                    sql.NullString
	DeadlineAt                 time.Time
	Timezone                   string
}

func (a *Adapter) handleProjectWeeklyReportGovernanceRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if projectID, periodKey, action, ok := projectWeeklyReportPeriodPath(path); ok {
		switch {
		case action == "" && method == http.MethodGet:
			data, err := a.getProjectWeeklyReportPeriod(ctx, projectID, periodKey, query)
			return data, "aims.projects.weekly_reports.period.read", true, err
		case action == "draft" && method == http.MethodPut:
			data, err := a.saveProjectWeeklyReportPeriodDraft(ctx, projectID, periodKey, query, body)
			return data, "aims.projects.weekly_reports.draft.save", true, err
		case action == "submit" && method == http.MethodPost:
			data, err := a.submitProjectWeeklyReportPeriod(ctx, projectID, periodKey, query, body)
			return data, "aims.projects.weekly_reports.submit", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}

	if reportID, action, ok := weeklyReportCommandPath(path); ok {
		switch {
		case action == "review" && method == http.MethodPost:
			data, err := a.reviewProjectWeeklyReport(ctx, reportID, query, body)
			return data, "aims.weekly_reports.review", true, err
		case action == "open-correction" && method == http.MethodPost:
			data, err := a.openProjectWeeklyReportCorrection(ctx, reportID, query, body)
			return data, "aims.weekly_reports.open_correction", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
	}

	if periodKey, ok := weeklyReportDirectorWorkbenchPath(path); ok {
		if method != http.MethodGet {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.weeklyReportDirectorWorkbench(ctx, periodKey, query)
		return data, "aims.weekly_reporting_periods.director_workbench", true, err
	}

	return nil, "", false, nil
}

func (a *Adapter) getProjectWeeklyReportPeriod(
	ctx context.Context,
	rawProjectID string,
	periodKey string,
	query url.Values,
) (map[string]any, error) {
	year, week, err := parseISOPeriodKey(periodKey)
	if err != nil {
		return nil, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectWeeklyReportRead(ctx, rawProjectID, uid, query); err != nil {
		return nil, err
	}
	editableByCurrentUser := a.requireProjectWeeklyReportManager(ctx, rawProjectID, uid, query) == nil

	var reportID int64
	var status string
	var currentVersionNo int
	var currentSubmittedVersionID, currentReviewedVersionID, currentFrozenVersionID sql.NullInt64
	err = a.DB().QueryRowContext(ctx, `
		SELECT
		  id, status, current_version_no, current_submitted_version_id,
		  current_reviewed_version_id, current_frozen_version_id
		FROM project_weekly_reports
		WHERE project_id = ? AND report_year = ? AND report_week = ?
	`, projectID, year, week).Scan(
		&reportID,
		&status,
		&currentVersionNo,
		&currentSubmittedVersionID,
		&currentReviewedVersionID,
		&currentFrozenVersionID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{
			"periodKey":             periodKey,
			"editableByCurrentUser": editableByCurrentUser,
			"report":                nil,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	report, err := a.getProjectWeeklyReport(ctx, reportID, true)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"periodKey":                 periodKey,
		"editableByCurrentUser":     editableByCurrentUser,
		"status":                    status,
		"currentVersionNo":          currentVersionNo,
		"currentSubmittedVersionId": nullableInt64(currentSubmittedVersionID),
		"currentReviewedVersionId":  nullableInt64(currentReviewedVersionID),
		"currentFrozenVersionId":    nullableInt64(currentFrozenVersionID),
		"report":                    report,
	}, nil
}

func (a *Adapter) saveProjectWeeklyReportPeriodDraft(
	ctx context.Context,
	rawProjectID string,
	periodKey string,
	query url.Values,
	body map[string]any,
) (projectWeeklyReportItem, error) {
	year, week, err := parseISOPeriodKey(periodKey)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	obligationID, err := a.requireWeeklyReportObligation(ctx, projectID, periodKey)
	if err != nil {
		return projectWeeklyReportItem{}, err
	}
	draft := cloneBody(body)
	draft["reportYear"] = year
	draft["reportWeek"] = week
	draft["status"] = "draft"
	draft["_governance_obligation_id"] = obligationID
	return a.saveProjectWeeklyReport(ctx, rawProjectID, query, draft)
}

func (a *Adapter) submitProjectWeeklyReportPeriod(
	ctx context.Context,
	rawProjectID string,
	periodKey string,
	query url.Values,
	body map[string]any,
) (weeklyReportVersionResult, error) {
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	year, week, err := parseISOPeriodKey(periodKey)
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return weeklyReportVersionResult{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectWeeklyReportManager(ctx, rawProjectID, actor, query); err != nil {
		return weeklyReportVersionResult{}, err
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	defer tx.Rollback()

	projection, err := lockWeeklyReportProjection(ctx, tx, projectID, year, week)
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	if projection.Status != "draft" && projection.Status != "correction_draft" {
		return weeklyReportVersionResult{}, httperror.New(http.StatusConflict, "weekly_report_not_submittable", "weekly report is not submittable in its current state")
	}
	if projection.ObligationID <= 0 {
		return weeklyReportVersionResult{}, httperror.New(http.StatusConflict, "weekly_report_obligation_required", "weekly report obligation is required")
	}

	managerContent, err := weeklyReportManagerContent(ctx, tx, projection)
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	factSnapshot, systemRAG, err := weeklyReportFactSnapshot(ctx, tx, projection)
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	selectedRAG := firstBodyText(body, "selectedRag", "selected_rag")
	if selectedRAG == "" {
		selectedRAG = systemRAG
	}
	if !validRAG(selectedRAG) {
		return weeklyReportVersionResult{}, httperror.New(http.StatusBadRequest, "invalid_selected_rag", "selectedRag is invalid")
	}
	overrideReason := firstBodyText(body, "ragOverrideReason", "rag_override_reason")
	if selectedRAG != systemRAG && overrideReason == "" {
		return weeklyReportVersionResult{}, httperror.New(http.StatusBadRequest, "rag_override_reason_required", "ragOverrideReason is required")
	}

	versionNo := projection.CurrentVersionNo + 1
	kind := "submission"
	var correctionOf any
	var correctionReason any
	if projection.Status == "correction_draft" {
		if !projection.PendingCorrectionOfVersion.Valid ||
			!projection.PendingCorrectionReason.Valid ||
			!projection.PendingCorrectionRequestID.Valid {
			return weeklyReportVersionResult{}, httperror.New(http.StatusConflict, "weekly_report_correction_context_missing", "correction context is missing")
		}
		kind = "correction"
		correctionOf = projection.PendingCorrectionOfVersion.Int64
		correctionReason = projection.PendingCorrectionReason.String
	}
	managerJSON, err := canonicalJSON(managerContent)
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	factJSON, err := canonicalJSON(factSnapshot)
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	factHash := sha256Hex(factJSON)

	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_weekly_report_versions (
		  report_id, version_no, kind, correction_of_version_id, correction_reason,
		  manager_content_json, fact_snapshot_json, fact_snapshot_sha256,
		  system_rag, selected_rag, rag_override_reason, rag_rule_version,
		  submitted_by, submitted_at
		) VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))
	`, projection.ReportID, versionNo, kind, correctionOf, correctionReason,
		string(managerJSON), string(factJSON), factHash, systemRAG, selectedRAG,
		nullableText(overrideReason), weeklyReportRAGRuleVersion, actor)
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	versionID, err := result.LastInsertId()
	if err != nil {
		return weeklyReportVersionResult{}, err
	}
	if err := lockProjectManagerDutyTimeEntries(
		ctx,
		tx,
		projection,
		versionID,
		actor,
	); err != nil {
		return weeklyReportVersionResult{}, err
	}
	late := time.Now().UTC().After(projection.DeadlineAt.UTC())
	if _, err := tx.ExecContext(ctx, `
		UPDATE project_weekly_reports
		SET status = 'submitted',
		    current_version_no = ?,
		    current_submitted_version_id = ?,
		    current_reviewed_version_id = NULL,
		    pending_correction_of_version_id = NULL,
		    pending_correction_reason = NULL,
		    pending_correction_request_id = NULL,
		    updated_by = ?
		WHERE id = ?
	`, versionNo, versionID, actor, projection.ReportID); err != nil {
		return weeklyReportVersionResult{}, err
	}
	if projection.PendingCorrectionRequestID.Valid {
		result, err := tx.ExecContext(ctx, `
			UPDATE project_weekly_report_correction_requests
			SET status = 'consumed',
			    submitted_version_id = ?,
			    consumed_at = UTC_TIMESTAMP(6)
			WHERE id = ?
			  AND report_id = ?
			  AND status = 'open'
		`, versionID, projection.PendingCorrectionRequestID.Int64, projection.ReportID)
		if err != nil {
			return weeklyReportVersionResult{}, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return weeklyReportVersionResult{}, err
		}
		if affected != 1 {
			return weeklyReportVersionResult{}, httperror.New(
				http.StatusConflict,
				"weekly_report_correction_request_not_open",
				"weekly report correction request is not open",
			)
		}
	}
	dueStatus := "submitted"
	if late {
		dueStatus = "late"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE weekly_report_obligations
		SET due_status = ?,
		    first_submitted_at = COALESCE(first_submitted_at, UTC_TIMESTAMP(6)),
		    late_flag = IF(late_flag = 1 OR ? = 1, 1, 0)
		WHERE id = ? AND frozen_at IS NULL
	`, dueStatus, boolInt(late), projection.ObligationID); err != nil {
		return weeklyReportVersionResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return weeklyReportVersionResult{}, err
	}
	return a.getWeeklyReportVersion(ctx, versionID)
}

func (a *Adapter) reviewProjectWeeklyReport(
	ctx context.Context,
	rawReportID string,
	query url.Values,
	body map[string]any,
) (weeklyReportReviewResult, error) {
	if !currentUserIsProjectDirector(query) {
		return weeklyReportReviewResult{}, httperror.New(http.StatusForbidden, "project_director_required", "current project director is required")
	}
	revision, err := projectDirectorRoleHolderRevision(query)
	if err != nil {
		return weeklyReportReviewResult{}, err
	}
	reportID, err := parseID(rawReportID, "report_id")
	if err != nil {
		return weeklyReportReviewResult{}, err
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return weeklyReportReviewResult{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	action := firstBodyText(body, "action")
	if action != "approve" && action != "return" && action != "approve_with_corrective_action" {
		return weeklyReportReviewResult{}, httperror.New(http.StatusBadRequest, "invalid_weekly_report_review_action", "review action is invalid")
	}
	comment := firstBodyText(body, "comment")
	if (action == "return" || action == "approve_with_corrective_action") && comment == "" {
		return weeklyReportReviewResult{}, httperror.New(http.StatusBadRequest, "weekly_report_review_comment_required", "review comment is required")
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return weeklyReportReviewResult{}, err
	}
	defer tx.Rollback()

	var projectID, versionID, obligationID int64
	var reportYear, reportWeek int
	var status string
	err = tx.QueryRowContext(ctx, `
		SELECT
		  project_id, current_submitted_version_id, obligation_id, status,
		  report_year, report_week
		FROM project_weekly_reports
		WHERE id = ?
		FOR UPDATE
	`, reportID).Scan(&projectID, &versionID, &obligationID, &status, &reportYear, &reportWeek)
	if errors.Is(err, sql.ErrNoRows) {
		return weeklyReportReviewResult{}, httperror.New(http.StatusNotFound, "weekly_report_not_found", "weekly report not found")
	}
	if err != nil {
		return weeklyReportReviewResult{}, err
	}
	if status != "submitted" {
		return weeklyReportReviewResult{}, httperror.New(http.StatusConflict, "weekly_report_not_reviewable", "weekly report is not awaiting review")
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_weekly_report_reviews (
		  report_version_id, action, comment, reviewer_uid, role_holder_revision
		) VALUES (?, ?, ?, ?, ?)
	`, versionID, action, nullableText(comment), actor, revision)
	if err != nil {
		return weeklyReportReviewResult{}, err
	}
	reviewID, err := result.LastInsertId()
	if err != nil {
		return weeklyReportReviewResult{}, err
	}

	nextStatus := "reviewed"
	dueStatus := "reviewed"
	var reviewedVersion any = versionID
	if action == "return" {
		nextStatus = "returned"
		dueStatus = "returned"
		reviewedVersion = nil
		if err := unlockProjectManagerDutyTimeEntries(
			ctx,
			tx,
			versionID,
			actor,
			comment,
		); err != nil {
			return weeklyReportReviewResult{}, err
		}
	}
	if action == "approve_with_corrective_action" {
		workItemID, err := createWeeklyReportCorrectiveWorkItem(
			ctx,
			tx,
			projectID,
			reportYear,
			reportWeek,
			actor,
			comment,
			body,
		)
		if err != nil {
			return weeklyReportReviewResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO weekly_report_corrective_action_links (review_id, work_item_id)
			VALUES (?, ?)
		`, reviewID, workItemID); err != nil {
			return weeklyReportReviewResult{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE project_weekly_reports
		SET status = ?, current_reviewed_version_id = ?, updated_by = ?
		WHERE id = ?
	`, nextStatus, reviewedVersion, actor, reportID); err != nil {
		return weeklyReportReviewResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE weekly_report_obligations
		SET due_status = ?
		WHERE id = ? AND frozen_at IS NULL
	`, dueStatus, obligationID); err != nil {
		return weeklyReportReviewResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return weeklyReportReviewResult{}, err
	}
	return a.getWeeklyReportReview(ctx, reviewID)
}

func (a *Adapter) openProjectWeeklyReportCorrection(
	ctx context.Context,
	rawReportID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if !currentUserIsProjectDirector(query) {
		return nil, httperror.New(http.StatusForbidden, "project_director_required", "current project director is required")
	}
	roleHolderRevision, err := projectDirectorRoleHolderRevision(query)
	if err != nil {
		return nil, err
	}
	reportID, err := parseID(rawReportID, "report_id")
	if err != nil {
		return nil, err
	}
	actor := currentUserFrom(query, body)
	if actor == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	reason := firstBodyText(body, "reason", "correctionReason", "correction_reason")
	if reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "correction_reason_required", "correction reason is required")
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var frozenVersionID int64
	err = tx.QueryRowContext(ctx, `
		SELECT current_frozen_version_id
		FROM project_weekly_reports
		WHERE id = ?
		  AND status = 'frozen'
		  AND current_frozen_version_id IS NOT NULL
		FOR UPDATE
	`, reportID).Scan(&frozenVersionID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "weekly_report_correction_not_allowed", "only a frozen published report can open a correction")
	}
	if err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_weekly_report_correction_requests (
		  report_id, correction_of_version_id, reason, opened_by, role_holder_revision
		) VALUES (?, ?, ?, ?, ?)
	`, reportID, frozenVersionID, reason, actor, roleHolderRevision)
	if err != nil {
		return nil, err
	}
	requestID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	result, err = tx.ExecContext(ctx, `
		UPDATE project_weekly_reports
		SET status = 'correction_draft',
		    pending_correction_of_version_id = ?,
		    pending_correction_reason = ?,
		    pending_correction_request_id = ?,
		    updated_by = ?
		WHERE id = ?
		  AND status = 'frozen'
		  AND current_frozen_version_id IS NOT NULL
	`, frozenVersionID, reason, requestID, actor, reportID)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "weekly_report_correction_not_allowed", "only a frozen published report can open a correction")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"reportId":              reportID,
		"correctionRequestId":   requestID,
		"correctionOfVersionId": frozenVersionID,
		"status":                "correction_draft",
		"reason":                reason,
	}, nil
}

func (a *Adapter) weeklyReportDirectorWorkbench(
	ctx context.Context,
	periodKey string,
	query url.Values,
) (map[string]any, error) {
	if !currentUserIsProjectDirector(query) {
		return nil, httperror.New(http.StatusForbidden, "project_director_required", "current project director is required")
	}
	if _, _, err := parseISOPeriodKey(periodKey); err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  obligation.id,
		  obligation.project_id,
		  project.project_code,
		  project.name,
		  obligation.responsible_uid_snapshot,
		  obligation.responsibility_type,
		  obligation.due_status,
		  obligation.late_flag,
		  report.id,
		  report.status,
		  report.current_version_no,
		  report.current_submitted_version_id,
		  report.current_reviewed_version_id,
		  period.deadline_at,
		  period.summary_target_at
		FROM weekly_report_obligations obligation
		INNER JOIN weekly_reporting_periods period ON period.id = obligation.period_id
		INNER JOIN aims_projects project ON project.id = obligation.project_id
		LEFT JOIN project_weekly_reports report ON report.obligation_id = obligation.id
		WHERE period.period_key = ?
		ORDER BY
		  FIELD(obligation.due_status, 'missing', 'late', 'submitted', 'returned', 'draft', 'pending', 'reviewed', 'frozen'),
		  project.project_code
	`, periodKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var obligationID, projectID int64
		var projectCode, projectName, responsibleUID, responsibilityType, dueStatus string
		var lateFlag int
		var reportID, versionNo, submittedVersionID, reviewedVersionID sql.NullInt64
		var reportStatus sql.NullString
		var deadlineAt, summaryTargetAt time.Time
		if err := rows.Scan(
			&obligationID, &projectID, &projectCode, &projectName, &responsibleUID,
			&responsibilityType, &dueStatus, &lateFlag, &reportID, &reportStatus,
			&versionNo, &submittedVersionID, &reviewedVersionID, &deadlineAt, &summaryTargetAt,
		); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"obligationId":              obligationID,
			"projectId":                 projectID,
			"projectCode":               projectCode,
			"projectName":               projectName,
			"responsibleUid":            responsibleUID,
			"responsibilityType":        responsibilityType,
			"dueStatus":                 dueStatus,
			"late":                      lateFlag == 1,
			"reportId":                  nullableInt64(reportID),
			"reportStatus":              nullableString(reportStatus),
			"currentVersionNo":          nullableInt64(versionNo),
			"currentSubmittedVersionId": nullableInt64(submittedVersionID),
			"currentReviewedVersionId":  nullableInt64(reviewedVersionID),
			"deadlineAt":                deadlineAt.UTC().Format(time.RFC3339Nano),
			"summaryTargetAt":           summaryTargetAt.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"periodKey": periodKey, "items": items, "total": len(items)}, nil
}

func (a *Adapter) requireWeeklyReportObligation(ctx context.Context, projectID int64, periodKey string) (int64, error) {
	var obligationID int64
	err := a.DB().QueryRowContext(ctx, `
		SELECT obligation.id
		FROM weekly_report_obligations obligation
		INNER JOIN weekly_reporting_periods period ON period.id = obligation.period_id
		WHERE obligation.project_id = ?
		  AND period.period_key = ?
		  AND obligation.frozen_at IS NULL
	`, projectID, periodKey).Scan(&obligationID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, httperror.New(http.StatusConflict, "weekly_report_obligation_required", "project has no open reporting obligation for this period")
	}
	return obligationID, err
}

func lockWeeklyReportProjection(
	ctx context.Context,
	tx *sql.Tx,
	projectID int64,
	year int,
	week int,
) (weeklyReportLockedProjection, error) {
	var item weeklyReportLockedProjection
	err := tx.QueryRowContext(ctx, `
		SELECT
		  report.id,
		  report.project_id,
		  report.obligation_id,
		  report.status,
		  report.current_version_no,
		  report.current_submitted_version_id,
		  report.current_frozen_version_id,
		  report.pending_correction_of_version_id,
		  report.pending_correction_reason,
		  report.pending_correction_request_id,
		  report.report_year,
		  report.report_week,
		  DATE_FORMAT(report.week_start, '%Y-%m-%d'),
		  DATE_FORMAT(report.week_end, '%Y-%m-%d'),
		  report.main_work,
		  report.overall_progress,
		  report.department_name,
		  report.project_type_name,
		  report.project_manager_name,
		  report.initiation_status,
		  report.current_stage,
		  report.progress_status,
		  CAST(report.completion_percent AS CHAR),
		  report.contract_status,
		  CAST(report.contract_amount AS CHAR),
		  report.payment_status,
		  CAST(report.cumulative_labor_cost AS CHAR),
		  report.major_risks,
		  report.coordination_needs,
		  report.remarks,
		  period.deadline_at,
		  period.timezone
		FROM project_weekly_reports report
		INNER JOIN weekly_report_obligations obligation ON obligation.id = report.obligation_id
		INNER JOIN weekly_reporting_periods period ON period.id = obligation.period_id
		WHERE report.project_id = ?
		  AND report.report_year = ?
		  AND report.report_week = ?
		FOR UPDATE
	`, projectID, year, week).Scan(
		&item.ReportID,
		&item.ProjectID,
		&item.ObligationID,
		&item.Status,
		&item.CurrentVersionNo,
		&item.CurrentSubmittedVersionID,
		&item.CurrentFrozenVersionID,
		&item.PendingCorrectionOfVersion,
		&item.PendingCorrectionReason,
		&item.PendingCorrectionRequestID,
		&item.ReportYear,
		&item.ReportWeek,
		&item.WeekStart,
		&item.WeekEnd,
		&item.MainWork,
		&item.OverallProgress,
		&item.DepartmentName,
		&item.ProjectTypeName,
		&item.ProjectManagerName,
		&item.InitiationStatus,
		&item.CurrentStage,
		&item.ProgressStatus,
		&item.CompletionPercent,
		&item.ContractStatus,
		&item.ContractAmount,
		&item.PaymentStatus,
		&item.CumulativeLaborCost,
		&item.MajorRisks,
		&item.CoordinationNeeds,
		&item.Remarks,
		&item.DeadlineAt,
		&item.Timezone,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return item, httperror.New(http.StatusNotFound, "weekly_report_draft_not_found", "weekly report draft not found")
	}
	return item, err
}

func weeklyReportManagerContent(
	ctx context.Context,
	tx *sql.Tx,
	report weeklyReportLockedProjection,
) (map[string]any, error) {
	entries, err := queryRowsAsMaps(ctx, tx, `
		SELECT
		  uid,
		  CAST(allocation_percent AS CHAR),
		  CAST(hours AS CHAR)
		FROM project_weekly_report_entries
		WHERE report_id = ?
		ORDER BY uid
	`, report.ReportID, func(rows *sql.Rows) (map[string]any, error) {
		var uid, allocation, hours string
		if err := rows.Scan(&uid, &allocation, &hours); err != nil {
			return nil, err
		}
		return map[string]any{"uid": uid, "allocationPercent": allocation, "hours": hours}, nil
	})
	if err != nil {
		return nil, err
	}
	workItems, err := queryRowsAsMaps(ctx, tx, `
		SELECT
		  plan_type, source_type, work_item_id, module_name, sort_order,
		  task_summary, owner_uid, owner_name,
		  CAST(completion_percent AS CHAR), incomplete_reason, CAST(workload_days AS CHAR)
		FROM project_weekly_report_work_items
		WHERE report_id = ?
		ORDER BY sort_order, id
	`, report.ReportID, func(rows *sql.Rows) (map[string]any, error) {
		var planType, sourceType, taskSummary string
		var workItemID, sortOrder sql.NullInt64
		var moduleName, ownerUID, ownerName, completion, incompleteReason, workload sql.NullString
		if err := rows.Scan(
			&planType, &sourceType, &workItemID, &moduleName, &sortOrder, &taskSummary,
			&ownerUID, &ownerName, &completion, &incompleteReason, &workload,
		); err != nil {
			return nil, err
		}
		return map[string]any{
			"planType":          planType,
			"sourceType":        sourceType,
			"workItemId":        nullableInt64(workItemID),
			"moduleName":        nullableJSONText(moduleName),
			"sortOrder":         nullableInt64(sortOrder),
			"taskSummary":       taskSummary,
			"ownerUid":          nullableJSONText(ownerUID),
			"ownerName":         nullableJSONText(ownerName),
			"completionPercent": nullableJSONText(completion),
			"incompleteReason":  nullableJSONText(incompleteReason),
			"workloadDays":      nullableJSONText(workload),
		}, nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"reportYear":          report.ReportYear,
		"reportWeek":          report.ReportWeek,
		"weekStart":           report.WeekStart,
		"weekEnd":             report.WeekEnd,
		"mainWork":            nullableJSONText(report.MainWork),
		"overallProgress":     nullableJSONText(report.OverallProgress),
		"departmentName":      nullableJSONText(report.DepartmentName),
		"projectTypeName":     nullableJSONText(report.ProjectTypeName),
		"projectManagerName":  nullableJSONText(report.ProjectManagerName),
		"initiationStatus":    nullableJSONText(report.InitiationStatus),
		"currentStage":        nullableJSONText(report.CurrentStage),
		"progressStatus":      nullableJSONText(report.ProgressStatus),
		"completionPercent":   nullableJSONText(report.CompletionPercent),
		"contractStatus":      nullableJSONText(report.ContractStatus),
		"contractAmount":      nullableJSONText(report.ContractAmount),
		"paymentStatus":       nullableJSONText(report.PaymentStatus),
		"cumulativeLaborCost": nullableJSONText(report.CumulativeLaborCost),
		"majorRisks":          nullableJSONText(report.MajorRisks),
		"coordinationNeeds":   nullableJSONText(report.CoordinationNeeds),
		"remarks":             nullableJSONText(report.Remarks),
		"entries":             entries,
		"workItems":           workItems,
	}, nil
}

func weeklyReportFactSnapshot(
	ctx context.Context,
	tx *sql.Tx,
	report weeklyReportLockedProjection,
) (map[string]any, string, error) {
	overdueMilestones, err := queryInt64IDs(ctx, tx, `
		SELECT id
		FROM milestones
		WHERE project_id = ?
		  AND end_date < ?
		  AND status <> 'completed'
		ORDER BY id
	`, report.ProjectID, report.WeekEnd)
	if err != nil {
		return nil, "", err
	}
	overdueCriticalItems, err := queryInt64IDs(ctx, tx, `
		SELECT id
		FROM work_items
		WHERE project_id = ?
		  AND due_date < ?
		  AND status <> 'completed'
		  AND (priority IN ('P0','P1') OR severity IN ('critical','high'))
		ORDER BY id
	`, report.ProjectID, report.WeekEnd)
	if err != nil {
		return nil, "", err
	}
	pendingTimeEntries, err := pendingWeeklyReportTimeEntryIDs(ctx, tx, report)
	if err != nil {
		return nil, "", err
	}
	pendingQualityDeliverables, err := queryInt64IDs(ctx, tx, `
		SELECT id
		FROM deliverables
		WHERE project_owner_id = ?
		  AND required = 1
		  AND quality_status NOT IN ('passed','waived','not_required')
		ORDER BY id
	`, report.ProjectID)
	if err != nil {
		return nil, "", err
	}
	systemRAG := "green"
	if len(overdueMilestones) > 0 || len(overdueCriticalItems) > 0 {
		systemRAG = "red"
	} else if len(pendingTimeEntries) > 0 || len(pendingQualityDeliverables) > 0 {
		systemRAG = "yellow"
	}
	return map[string]any{
		"schema":    "aims.project-weekly-report.fact-snapshot.v1",
		"projectId": report.ProjectID,
		"period": map[string]any{
			"reportYear": report.ReportYear,
			"reportWeek": report.ReportWeek,
			"weekStart":  report.WeekStart,
			"weekEnd":    report.WeekEnd,
		},
		"overdueMilestoneIds":          overdueMilestones,
		"overdueCriticalWorkItemIds":   overdueCriticalItems,
		"pendingTimeEntryIds":          pendingTimeEntries,
		"pendingQualityDeliverableIds": pendingQualityDeliverables,
	}, systemRAG, nil
}

func pendingWeeklyReportTimeEntryIDs(
	ctx context.Context,
	tx *sql.Tx,
	report weeklyReportLockedProjection,
) ([]int64, error) {
	location, err := time.LoadLocation(report.Timezone)
	if err != nil {
		return nil, httperror.New(http.StatusConflict, "invalid_period_timezone", "weekly reporting period timezone is invalid")
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id, uid, entry_date, review_route
		FROM time_entries
		WHERE project_id = ?
		  AND entry_date BETWEEN ? AND ?
		  AND review_status <> 'approved'
		ORDER BY id
	`, report.ProjectID, report.WeekStart, report.WeekEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type entry struct {
		id        int64
		uid       string
		entryDate time.Time
		route     sql.NullString
	}
	entries := make([]entry, 0)
	for rows.Next() {
		var item entry
		if err := rows.Scan(&item.id, &item.uid, &item.entryDate, &item.route); err != nil {
			return nil, err
		}
		entries = append(entries, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	pending := make([]int64, 0, len(entries))
	for _, item := range entries {
		if item.route.Valid && item.route.String == "company_summary" {
			continue
		}
		responsibleUID, err := projectResponsibleUIDAtDate(ctx, tx, report.ProjectID, item.entryDate, location)
		if err != nil {
			return nil, err
		}
		if responsibleUID == item.uid {
			continue
		}
		pending = append(pending, item.id)
	}
	return pending, nil
}

func (a *Adapter) getWeeklyReportVersion(ctx context.Context, id int64) (weeklyReportVersionResult, error) {
	var item weeklyReportVersionResult
	var managerContent, factSnapshot []byte
	var correctionOf sql.NullInt64
	var correctionReason, overrideReason sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT
		  id, report_id, version_no, kind, correction_of_version_id, correction_reason,
		  manager_content_json, fact_snapshot_json, fact_snapshot_sha256,
		  system_rag, selected_rag, rag_override_reason, rag_rule_version,
		  submitted_by, DATE_FORMAT(submitted_at, '%Y-%m-%dT%H:%i:%s.%fZ')
		FROM project_weekly_report_versions
		WHERE id = ?
	`, id).Scan(
		&item.ID, &item.ReportID, &item.VersionNo, &item.Kind, &correctionOf, &correctionReason,
		&managerContent, &factSnapshot, &item.FactSnapshotSHA256, &item.SystemRAG,
		&item.SelectedRAG, &overrideReason, &item.RAGRuleVersion, &item.SubmittedBy, &item.SubmittedAt,
	)
	if err != nil {
		return item, err
	}
	item.CorrectionOfVersionID = nullableInt64(correctionOf)
	item.CorrectionReason = nullableString(correctionReason)
	item.RAGOverrideReason = nullableString(overrideReason)
	item.ManagerContent = json.RawMessage(managerContent)
	item.FactSnapshot = json.RawMessage(factSnapshot)
	return item, nil
}

func (a *Adapter) getWeeklyReportReview(ctx context.Context, id int64) (weeklyReportReviewResult, error) {
	var item weeklyReportReviewResult
	var comment sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT
		  id, report_version_id, action, comment, reviewer_uid, role_holder_revision,
		  DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ')
		FROM project_weekly_report_reviews
		WHERE id = ?
	`, id).Scan(
		&item.ID, &item.ReportVersionID, &item.Action, &comment, &item.ReviewerUID,
		&item.RoleHolderRevision, &item.CreatedAt,
	)
	item.Comment = nullableString(comment)
	return item, err
}

func lockProjectManagerDutyTimeEntries(
	ctx context.Context,
	tx *sql.Tx,
	report weeklyReportLockedProjection,
	reportVersionID int64,
	actor string,
) error {
	location, err := time.LoadLocation(report.Timezone)
	if err != nil {
		return httperror.New(http.StatusConflict, "invalid_period_timezone", "weekly reporting period timezone is invalid")
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id, uid, entry_date, review_status
		FROM time_entries
		WHERE project_id = ?
		  AND entry_date BETWEEN ? AND ?
		  AND review_status IN ('draft','returned','submitted')
		ORDER BY entry_date, id
		FOR UPDATE
	`, report.ProjectID, report.WeekStart, report.WeekEnd)
	if err != nil {
		return err
	}
	type entry struct {
		id        int64
		uid       string
		entryDate time.Time
		status    string
	}
	entries := make([]entry, 0)
	for rows.Next() {
		var item entry
		if err := rows.Scan(&item.id, &item.uid, &item.entryDate, &item.status); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range entries {
		responsibleUID, err := projectResponsibleUIDAtDate(ctx, tx, report.ProjectID, item.entryDate, location)
		if err != nil {
			return err
		}
		if responsibleUID != item.uid {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE time_entries
			SET review_status = 'submitted',
			    review_route = 'company_summary',
			    reviewer_uid_snapshot = NULL,
			    locked_report_version_id = ?,
			    row_version = row_version + 1,
			    submitted_at = COALESCE(submitted_at, UTC_TIMESTAMP(6)),
			    reviewed_by = NULL,
			    reviewed_at = NULL,
			    return_reason = NULL
			WHERE id = ?
			  AND review_status IN ('draft','returned','submitted')
		`, reportVersionID, item.id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO time_entry_review_events (
			  time_entry_id, from_status, to_status, actor_uid, reason, report_version_id
			) VALUES (?, ?, 'submitted', ?, 'weekly_report_submit_lock', ?)
		`, item.id, item.status, actor, reportVersionID); err != nil {
			return err
		}
	}
	return nil
}

func unlockProjectManagerDutyTimeEntries(
	ctx context.Context,
	tx *sql.Tx,
	reportVersionID int64,
	actor string,
	reason string,
) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM time_entries
		WHERE locked_report_version_id = ?
		  AND review_route = 'company_summary'
		  AND review_status = 'submitted'
		ORDER BY id
		FOR UPDATE
	`, reportVersionID)
	if err != nil {
		return err
	}
	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `
			UPDATE time_entries
			SET review_status = 'returned',
			    locked_report_version_id = NULL,
			    row_version = row_version + 1,
			    reviewed_by = ?,
			    reviewed_at = UTC_TIMESTAMP(6),
			    return_reason = ?
			WHERE id = ?
			  AND locked_report_version_id = ?
			  AND review_status = 'submitted'
		`, actor, nullableText(reason), id, reportVersionID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO time_entry_review_events (
			  time_entry_id, from_status, to_status, actor_uid, reason, report_version_id
			) VALUES (?, 'submitted', 'returned', ?, ?, ?)
		`, id, actor, nullableText(reason), reportVersionID); err != nil {
			return err
		}
	}
	return nil
}

func createWeeklyReportCorrectiveWorkItem(
	ctx context.Context,
	tx *sql.Tx,
	projectID int64,
	reportYear int,
	reportWeek int,
	actor string,
	comment string,
	body map[string]any,
) (int64, error) {
	var projectCode, responsibleUID string
	err := tx.QueryRowContext(ctx, `
		SELECT
		  project.project_code,
		  COALESCE((
		    SELECT delegation.delegate_uid
		    FROM project_manager_delegations delegation
		    WHERE delegation.project_id = project.id
		      AND delegation.revoked_at IS NULL
		      AND delegation.starts_at <= UTC_TIMESTAMP(6)
		      AND delegation.ends_at > UTC_TIMESTAMP(6)
		    ORDER BY delegation.starts_at DESC, delegation.id DESC
		    LIMIT 1
		  ), project.leader_uid)
		FROM aims_projects project
		WHERE project.id = ?
		FOR UPDATE
	`, projectID).Scan(&projectCode, &responsibleUID)
	if err != nil {
		return 0, err
	}

	milestoneID, parseErr := bodyInt64(body, "correctiveMilestoneId", "corrective_milestone_id")
	if parseErr != nil || milestoneID <= 0 {
		err = tx.QueryRowContext(ctx, `
			SELECT id
			FROM milestones
			WHERE project_id = ?
			  AND status IN ('active','todo','planning')
			ORDER BY
			  FIELD(status, 'active', 'todo', 'planning'),
			  COALESCE(end_date, '9999-12-31'),
			  id
			LIMIT 1
			FOR UPDATE
		`, projectID).Scan(&milestoneID)
		if errors.Is(err, sql.ErrNoRows) {
			return 0, httperror.New(
				http.StatusConflict,
				"corrective_milestone_required",
				"an active project milestone is required to create the corrective action",
			)
		}
		if err != nil {
			return 0, err
		}
	} else {
		var exists int64
		if err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM milestones
			WHERE id = ? AND project_id = ? AND status <> 'completed'
			FOR UPDATE
		`, milestoneID, projectID).Scan(&exists); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return 0, httperror.New(http.StatusBadRequest, "corrective_milestone_invalid", "corrective milestone must be an incomplete milestone in the report project")
			}
			return 0, err
		}
	}

	itemNumber, err := nextDecomposeItemNumber(ctx, tx, projectID)
	if err != nil {
		return 0, err
	}
	itemKey := fmt.Sprintf("%s-%d", strings.TrimSpace(projectCode), itemNumber)
	title := firstBodyText(body, "correctiveTitle", "corrective_title")
	if title == "" {
		title = fmt.Sprintf("%d-W%02d 项目周报整改", reportYear, reportWeek)
	}
	dueDate := firstBodyText(body, "correctiveDueDate", "corrective_due_date")
	result, err := tx.ExecContext(ctx, `
		INSERT INTO work_items (
		  project_id, milestone_id, item_number, item_key, tier, type,
		  title, description, status, priority, assignee_uid, reporter_uid,
		  due_date, approval_status, review_level
		) VALUES (?, ?, ?, ?, 'matter', 'change_request', ?, ?, 'todo', 'P1', ?, ?, ?, 'not_required', 1)
	`, projectID, milestoneID, itemNumber, itemKey, title, comment,
		responsibleUID, actor, nullableText(dueDate))
	if err != nil {
		return 0, err
	}
	workItemID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO work_item_changelog (
		  work_item_id, field_name, old_value, new_value, changed_by
		) VALUES (?, 'created_from_weekly_report_review', NULL, ?, ?)
	`, workItemID, itemKey, actor); err != nil {
		return 0, err
	}
	return workItemID, nil
}

func projectWeeklyReportPeriodPath(path string) (string, string, string, bool) {
	const prefix = "/v1/aims/projects/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.Split(rest, "/weekly-reports/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
		return "", "", "", false
	}
	projectID := parts[0]
	tail := parts[1]
	if strings.HasSuffix(tail, ":submit") {
		periodKey := strings.TrimSuffix(tail, ":submit")
		return projectID, periodKey, "submit", periodKey != ""
	}
	if strings.HasSuffix(tail, "/draft") {
		periodKey := strings.TrimSuffix(tail, "/draft")
		return projectID, periodKey, "draft", periodKey != ""
	}
	if tail == "" || strings.Contains(tail, "/") || strings.Contains(tail, ":") {
		return "", "", "", false
	}
	return projectID, tail, "", true
}

func weeklyReportCommandPath(path string) (string, string, bool) {
	const prefix = "/v1/aims/weekly-reports/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	tail := strings.TrimPrefix(path, prefix)
	for _, action := range []string{"review", "open-correction"} {
		suffix := ":" + action
		if strings.HasSuffix(tail, suffix) {
			reportID := strings.TrimSuffix(tail, suffix)
			return reportID, action, reportID != "" && !strings.Contains(reportID, "/")
		}
	}
	return "", "", false
}

func weeklyReportDirectorWorkbenchPath(path string) (string, bool) {
	const prefix = "/v1/aims/weekly-reporting-periods/"
	const suffix = "/director-workbench"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	periodKey := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	return periodKey, periodKey != "" && !strings.Contains(periodKey, "/")
}

func canonicalJSON(value any) ([]byte, error) {
	return json.Marshal(value)
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func validRAG(value string) bool {
	return value == "green" || value == "yellow" || value == "red"
}

func cloneBody(body map[string]any) map[string]any {
	result := make(map[string]any, len(body)+3)
	for key, value := range body {
		result[key] = value
	}
	return result
}

func nullableJSONText(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func queryInt64IDs(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		items = append(items, id)
	}
	return items, rows.Err()
}

func queryRowsAsMaps(
	ctx context.Context,
	tx *sql.Tx,
	query string,
	arg any,
	scan func(*sql.Rows) (map[string]any, error),
) ([]map[string]any, error) {
	rows, err := tx.QueryContext(ctx, query, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
