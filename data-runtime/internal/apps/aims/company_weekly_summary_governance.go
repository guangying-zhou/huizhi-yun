package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	companyWeeklySummaryOperationCode       = "aims.company-weekly-summary.codocs-publish.v1"
	companyWeeklySummaryRequiredCapability  = "codocs:company-weekly-summary:publish"
	companyWeeklySummaryCommandSchema       = "v1"
	companyWeeklySummaryStructuredSchema    = "aims.company-weekly-summary.snapshot.v1"
	companyWeeklySummaryDefaultDocumentType = "company"
)

type companySummaryDraft struct {
	Title                 string  `json:"title"`
	Opening               string  `json:"opening,omitempty"`
	Closing               string  `json:"closing,omitempty"`
	IncludedObligationIDs []int64 `json:"includedObligationIds"`
}

type companySummaryRecipientSelection struct {
	SubjectType string `json:"subjectType"`
	SubjectCode string `json:"subjectCode"`
	SubjectName string `json:"subjectName"`
}

type companySummaryResolvedRecipient struct {
	SubjectType    string `json:"subjectType"`
	SubjectCode    string `json:"subjectCode"`
	UID            string `json:"uid"`
	DisplayName    string `json:"displayName"`
	DepartmentCode string `json:"departmentCode,omitempty"`
}

type companySummaryObligation struct {
	ID               int64
	ProjectID        int64
	ProjectCode      string
	ProjectName      string
	ResponsibleUID   string
	DueStatus        string
	Late             bool
	ReportID         sql.NullInt64
	ReviewedVersion  sql.NullInt64
	SelectedRAG      sql.NullString
	ManagerContent   json.RawMessage
	FactSnapshot     json.RawMessage
	SubmittedBy      sql.NullString
	SubmittedAt      sql.NullTime
	InclusionStatus  string
	IncludedByChoice bool
}

func (a *Adapter) handleCompanyWeeklySummaryGovernanceRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if versionID, ok := pathParam(path, "/v1/aims/company-weekly-summary-versions/", ":publish-content"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
		}
		data, err := a.companyWeeklySummaryPublishContent(ctx, versionID, body)
		return data, "aims.company_weekly_summary_versions.publish_content", true, err
	}
	periodKey, action, ok := companyWeeklySummaryPath(path)
	if !ok {
		return nil, "", false, nil
	}

	switch {
	case action == "" && method == http.MethodGet:
		data, err := a.getCompanyWeeklySummary(ctx, periodKey, query)
		return data, "aims.company_weekly_summaries.read", true, err
	case action == "generate" && method == http.MethodPost:
		data, err := a.generateCompanyWeeklySummary(ctx, periodKey, query, body)
		return data, "aims.company_weekly_summaries.generate", true, err
	case action == "draft" && method == http.MethodPut:
		data, err := a.saveCompanyWeeklySummaryDraft(ctx, periodKey, query, body)
		return data, "aims.company_weekly_summaries.draft.save", true, err
	case action == "publish" && method == http.MethodPost:
		data, err := a.publishCompanyWeeklySummary(ctx, periodKey, query, body)
		return data, "aims.company_weekly_summaries.publish", true, err
	case action == "retry" && method == http.MethodPost:
		data, err := a.retryCompanyWeeklySummaryPublish(ctx, periodKey, query, body)
		return data, "aims.company_weekly_summaries.retry", true, err
	case action == "cancel-publish" && method == http.MethodPost:
		data, err := a.cancelCompanyWeeklySummaryPublish(ctx, periodKey, query, body)
		return data, "aims.company_weekly_summaries.cancel_publish", true, err
	case action == "open-correction" && method == http.MethodPost:
		data, err := a.openCompanyWeeklySummaryCorrection(ctx, periodKey, query, body)
		return data, "aims.company_weekly_summaries.open_correction", true, err
	case action == "versions" && method == http.MethodGet:
		data, err := a.listCompanyWeeklySummaryVersions(ctx, periodKey, query)
		return data, "aims.company_weekly_summaries.versions.list", true, err
	default:
		return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method is not allowed")
	}
}

func (a *Adapter) companyWeeklySummaryPublishContent(
	ctx context.Context,
	rawVersionID string,
	body map[string]any,
) (map[string]any, error) {
	if err := aimsRequireIntegrationOperationScope(body); err != nil {
		return nil, err
	}
	if _, _, err := trustedAimsIntegrationOperationWorker(body); err != nil {
		return nil, err
	}
	versionID, err := parseID(rawVersionID, "summary_version_id")
	if err != nil {
		return nil, err
	}
	expectedHash := strings.TrimSpace(firstBodyText(body, "markdownSha256", "markdown_sha256"))
	var periodKey, title, markdown, hash, publishStatus string
	var revision int
	err = a.DB().QueryRowContext(ctx, `
		SELECT period.period_key,
		       JSON_UNQUOTE(JSON_EXTRACT(version.structured_snapshot_json, '$.title')),
		       version.revision_no, version.markdown_content, version.markdown_sha256,
		       version.publish_status
		FROM company_weekly_summary_versions version
		INNER JOIN company_weekly_summaries summary ON summary.id = version.summary_id
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		WHERE version.id = ?
	`, versionID).Scan(&periodKey, &title, &revision, &markdown, &hash, &publishStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "company_weekly_summary_version_not_found", "company weekly summary version not found")
	}
	if err != nil {
		return nil, err
	}
	if expectedHash == "" || expectedHash != hash || sha256Hex([]byte(markdown)) != hash {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_markdown_hash_mismatch", "immutable summary Markdown hash mismatch")
	}
	if publishStatus != "pending" && publishStatus != "published" {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_version_not_publishable", "summary version is not publishable")
	}
	return map[string]any{
		"summaryVersionId": versionID, "periodKey": periodKey, "revisionNo": revision,
		"title": title, "markdownContent": markdown, "markdownSha256": hash,
	}, nil
}

func companyWeeklySummaryPath(path string) (string, string, bool) {
	const prefix = "/v1/aims/company-weekly-summaries/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	value := strings.TrimPrefix(path, prefix)
	if value == "" || strings.Contains(value, "/") && !strings.HasSuffix(value, "/draft") && !strings.HasSuffix(value, "/versions") {
		return "", "", false
	}
	for _, suffix := range []struct {
		value  string
		action string
	}{
		{":open-correction", "open-correction"},
		{":generate", "generate"},
		{":publish", "publish"},
		{":retry", "retry"},
		{":cancel-publish", "cancel-publish"},
		{"/versions", "versions"},
		{"/draft", "draft"},
	} {
		if strings.HasSuffix(value, suffix.value) {
			periodKey := strings.TrimSuffix(value, suffix.value)
			return periodKey, suffix.action, periodKey != ""
		}
	}
	return value, "", value != "" && !strings.Contains(value, "/") && !strings.Contains(value, ":")
}

func (a *Adapter) cancelCompanyWeeklySummaryPublish(
	ctx context.Context,
	periodKey string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	actor, _, err := requireCompanySummaryDirector(query)
	if err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var summaryID, periodID, versionID int64
	var correctionOf sql.NullInt64
	err = tx.QueryRowContext(ctx, `
		SELECT summary.id, summary.period_id, version.id, version.correction_of_version_id
		FROM company_weekly_summaries summary
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		INNER JOIN company_weekly_summary_versions version
		  ON version.summary_id = summary.id
		 AND version.publish_status IN ('pending','failed')
		WHERE period.period_key = ?
		  AND summary.status = 'publishing'
		ORDER BY version.revision_no DESC
		LIMIT 1
		FOR UPDATE
	`, periodKey).Scan(&summaryID, &periodID, &versionID, &correctionOf)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_publish_not_cancellable", "summary has no cancellable publish")
	}
	if err != nil {
		return nil, err
	}
	var operationID, operationStatus string
	var operationVersion uint64
	var receiptID sql.NullString
	err = tx.QueryRowContext(ctx, trusted.SQL(`
		SELECT operation_id, status, version_no, target_receipt_id
		FROM integration_operation
		WHERE tenant_code = ?
		  AND deployment_code = ?
		  AND source_app = 'aims'
		  AND target_app = 'codocs'
		  AND operation_code = ?
		  AND source_biz_type = 'company_weekly_summary'
		  AND source_biz_code = ?
		  AND JSON_UNQUOTE(JSON_EXTRACT(command_json, '$.summaryVersionId')) = CAST(? AS CHAR)
		LIMIT 1
		FOR UPDATE
	`), trusted.TenantCode, trusted.DeploymentCode, companyWeeklySummaryOperationCode,
		periodKey, versionID).Scan(&operationID, &operationStatus, &operationVersion, &receiptID)
	if err != nil {
		return nil, err
	}
	if receiptID.Valid || (operationStatus != string(integrationoperation.StatusPending) &&
		operationStatus != string(integrationoperation.StatusRetryWait)) {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_publish_not_cancellable", "publish can only be cancelled before target delivery starts")
	}
	result, err := tx.ExecContext(ctx, trusted.SQL(`
		UPDATE integration_operation
		SET status = 'cancelled', next_attempt_at = UTC_TIMESTAMP(6),
		    locked_by = NULL, locked_until = NULL,
		    version_no = version_no + 1,
		    updated_by = ?, updated_at = UTC_TIMESTAMP(6)
		WHERE operation_id = ?
		  AND version_no = ?
		  AND status IN ('pending','retry_wait')
		  AND target_receipt_id IS NULL
	`), actor, operationID, operationVersion)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_publish_cancel_conflict", "publish state changed before cancellation")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE project_weekly_reports report
		INNER JOIN company_weekly_summary_items item
		  ON item.summary_version_id = ?
		 AND item.inclusion_status = 'included'
		 AND item.report_version_id = report.current_frozen_version_id
		SET report.status = 'reviewed',
		    report.current_frozen_version_id = NULL,
		    report.updated_by = ?
		WHERE report.status = 'frozen'
	`, versionID, actor); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE weekly_report_obligations obligation
		INNER JOIN company_weekly_summary_items item
		  ON item.summary_version_id = ?
		 AND item.obligation_id = obligation.id
		SET obligation.due_status = CASE
		      WHEN item.inclusion_status = 'missing' THEN 'missing'
		      ELSE 'reviewed'
		    END,
		    obligation.frozen_at = NULL
	`, versionID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE company_weekly_summary_versions
		SET publish_status = 'cancelled'
		WHERE id = ?
	`, versionID); err != nil {
		return nil, err
	}
	nextStatus := "draft"
	if correctionOf.Valid {
		nextStatus = "correction_draft"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE company_weekly_summaries
		SET status = ?, updated_by = ?
		WHERE id = ?
	`, nextStatus, actor, summaryID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE weekly_reporting_periods
		SET status = 'deadline_frozen', obligations_frozen_at = NULL
		WHERE id = ?
	`, periodID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"periodKey": periodKey, "summaryVersionId": versionID,
		"operationId": operationID, "operationStatus": "cancelled",
		"status": nextStatus,
	}, nil
}

func (a *Adapter) retryCompanyWeeklySummaryPublish(
	ctx context.Context,
	periodKey string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	actor, _, err := requireCompanySummaryDirector(query)
	if err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil {
		return nil, err
	}
	var operationID, operationKey, status string
	var operationVersion uint64
	var summaryVersionID int64
	outbox, err := a.enterpriseOutbox()
	if err != nil {
		return nil, err
	}
	err = a.DB().QueryRowContext(ctx, outbox.SQL(`
		SELECT operation.operation_id, operation.operation_key, operation.status,
		       operation.version_no, version.id
		FROM company_weekly_summaries summary
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		INNER JOIN company_weekly_summary_versions version
		  ON version.summary_id = summary.id
		 AND version.publish_status IN ('pending','failed')
		INNER JOIN integration_operation operation
		  ON operation.source_app = 'aims'
		 AND operation.target_app = 'codocs'
		 AND operation.operation_code = ?
		 AND operation.source_biz_type = 'company_weekly_summary'
		 AND operation.source_biz_code = period.period_key
		 AND JSON_UNQUOTE(JSON_EXTRACT(operation.command_json, '$.summaryVersionId')) = CAST(version.id AS CHAR)
		WHERE period.period_key = ?
		  AND operation.tenant_code = ?
		  AND operation.deployment_code = ?
		ORDER BY version.revision_no DESC
		LIMIT 1
	`), companyWeeklySummaryOperationCode, periodKey, trusted.TenantCode, trusted.DeploymentCode).Scan(
		&operationID, &operationKey, &status, &operationVersion, &summaryVersionID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "company_weekly_summary_publish_operation_not_found", "summary publish operation not found")
	}
	if err != nil {
		return nil, err
	}
	switch integrationoperation.Status(status) {
	case integrationoperation.StatusSucceeded:
		return map[string]any{
			"operationId": operationID, "operationKey": operationKey,
			"operationStatus": status, "summaryVersionId": summaryVersionID,
		}, nil
	case integrationoperation.StatusProcessing:
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_publish_in_progress", "summary publish is already in progress")
	case integrationoperation.StatusFailedPermanent, integrationoperation.StatusDeadLetter:
		repository, err := a.integrationOperationRepository()
		if err != nil {
			return nil, err
		}
		result, err := repository.Replay(ctx, integrationoperation.ReplayInput{
			TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode,
			SourceApp: "aims", OperationID: operationID, ExpectedVersion: operationVersion,
			ActorUID: actor, Reason: "project director retry company weekly summary publish",
			Now: time.Now().UTC(),
		})
		if errors.Is(err, integrationoperation.ErrReplayRejected) {
			return nil, httperror.New(http.StatusConflict, "company_weekly_summary_publish_retry_conflict", "summary publish retry conflicts with current operation state")
		}
		if err != nil {
			return nil, err
		}
		status = string(result.Status)
	case integrationoperation.StatusRetryWait, integrationoperation.StatusPartialUnknown:
		result, err := a.DB().ExecContext(ctx, outbox.SQL(`
			UPDATE integration_operation
			SET next_attempt_at = UTC_TIMESTAMP(6),
			    version_no = version_no + 1,
			    updated_by = ?, updated_at = UTC_TIMESTAMP(6)
			WHERE operation_id = ?
			  AND version_no = ?
			  AND status IN ('retry_wait','partial_unknown')
			  AND target_receipt_id IS NULL
		`), actor, operationID, operationVersion)
		if err != nil {
			return nil, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if affected != 1 {
			return nil, httperror.New(http.StatusConflict, "company_weekly_summary_publish_retry_conflict", "summary publish retry conflicts with current operation state")
		}
		// Keep the legal retry_wait/partial_unknown state; ClaimByOperationKey
		// will transition it directly to processing now that it is due.
	case integrationoperation.StatusPending:
		// Already ready for a dispatcher claim.
	default:
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_publish_not_retryable", "summary publish operation is not retryable")
	}
	if _, err := a.DB().ExecContext(ctx, `
		UPDATE company_weekly_summary_versions
		SET publish_status = 'pending'
		WHERE id = ? AND publish_status IN ('pending','failed')
	`, summaryVersionID); err != nil {
		return nil, err
	}
	return map[string]any{
		"operationId": operationID, "operationKey": operationKey,
		"operationStatus": status, "summaryVersionId": summaryVersionID,
	}, nil
}

func requireCompanySummaryDirector(query url.Values) (string, int64, error) {
	if !currentUserIsProjectDirector(query) {
		return "", 0, httperror.New(http.StatusForbidden, "project_director_required", "current project director is required")
	}
	actor := strings.TrimSpace(query.Get("current_user"))
	if actor == "" {
		return "", 0, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	revision, err := projectDirectorRoleHolderRevision(query)
	if err != nil {
		return "", 0, err
	}
	return actor, revision, nil
}

func (a *Adapter) generateCompanyWeeklySummary(
	ctx context.Context,
	periodKey string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	actor, _, err := requireCompanySummaryDirector(query)
	if err != nil {
		return nil, err
	}
	if _, _, err := parseISOPeriodKey(periodKey); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var periodID int64
	var weekStart time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT id, week_start
		FROM weekly_reporting_periods
		WHERE period_key = ?
		FOR UPDATE
	`, periodKey).Scan(&periodID, &weekStart)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "weekly_reporting_period_required", "weekly reporting period is required")
	}
	if err != nil {
		return nil, err
	}
	defaultDraft := companySummaryDraft{
		Title:                 fmt.Sprintf("%s 公司项目周报汇总", periodKey),
		IncludedObligationIDs: []int64{},
	}
	defaultDraftJSON, err := canonicalJSON(defaultDraft)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO company_weekly_summaries (
		  period_id, status, current_revision_no, draft_content_json, created_by, updated_by
		) VALUES (?, 'draft', 0, CAST(? AS JSON), ?, ?)
		ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by)
	`, periodID, string(defaultDraftJSON), actor, actor); err != nil {
		return nil, err
	}

	var summaryID int64
	var selectionCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT id,
		       (SELECT COUNT(*) FROM company_weekly_summary_recipient_selections selection WHERE selection.summary_id = company_weekly_summaries.id)
		FROM company_weekly_summaries
		WHERE period_id = ?
		FOR UPDATE
	`, periodID).Scan(&summaryID, &selectionCount); err != nil {
		return nil, err
	}
	if selectionCount == 0 {
		var priorSummaryID sql.NullInt64
		err = tx.QueryRowContext(ctx, `
			SELECT summary.id
			FROM company_weekly_summaries summary
			INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
			WHERE summary.status = 'published'
			  AND period.week_start < ?
			ORDER BY period.week_start DESC, summary.id DESC
			LIMIT 1
		`, weekStart).Scan(&priorSummaryID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if priorSummaryID.Valid {
			if _, err := tx.ExecContext(ctx, `
				INSERT IGNORE INTO company_weekly_summary_recipient_selections (
				  summary_id, subject_type, subject_code, subject_name_snapshot, selected_by
				)
				SELECT ?, subject_type, subject_code, subject_name_snapshot, ?
				FROM company_weekly_summary_recipient_selections
				WHERE summary_id = ?
				ORDER BY id
			`, summaryID, actor, priorSummaryID.Int64); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.getCompanyWeeklySummary(ctx, periodKey, query)
}

func (a *Adapter) saveCompanyWeeklySummaryDraft(
	ctx context.Context,
	periodKey string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	actor, _, err := requireCompanySummaryDirector(query)
	if err != nil {
		return nil, err
	}
	draft, err := companySummaryDraftFromBody(periodKey, body)
	if err != nil {
		return nil, err
	}
	selections, err := companySummarySelectionsFromBody(body)
	if err != nil {
		return nil, err
	}
	draftJSON, err := canonicalJSON(draft)
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var summaryID int64
	var status string
	err = tx.QueryRowContext(ctx, `
		SELECT summary.id, summary.status
		FROM company_weekly_summaries summary
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		WHERE period.period_key = ?
		FOR UPDATE
	`, periodKey).Scan(&summaryID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_required", "generate company weekly summary first")
	}
	if err != nil {
		return nil, err
	}
	if status != "draft" && status != "correction_draft" {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_not_editable", "company weekly summary is not editable")
	}
	if err := validateCompanySummaryIncludedObligationsTx(ctx, tx, summaryID, draft.IncludedObligationIDs); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE company_weekly_summaries
		SET draft_content_json = CAST(? AS JSON), updated_by = ?
		WHERE id = ?
	`, string(draftJSON), actor, summaryID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM company_weekly_summary_recipient_selections WHERE summary_id = ?`, summaryID); err != nil {
		return nil, err
	}
	for _, selection := range selections {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO company_weekly_summary_recipient_selections (
			  summary_id, subject_type, subject_code, subject_name_snapshot, selected_by
			) VALUES (?, ?, ?, ?, ?)
		`, summaryID, selection.SubjectType, selection.SubjectCode, selection.SubjectName, actor); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.getCompanyWeeklySummary(ctx, periodKey, query)
}

func (a *Adapter) publishCompanyWeeklySummary(
	ctx context.Context,
	periodKey string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	actor, roleRevision, err := requireCompanySummaryDirector(query)
	if err != nil {
		return nil, err
	}
	if !truthyQuery(query, "company_summary_recipient_resolution_verified") {
		return nil, httperror.New(http.StatusForbidden, "company_summary_recipient_resolution_required", "verified recipient resolution is required")
	}
	resolvedRecipients, err := companySummaryResolvedRecipientsFromBody(body)
	if err != nil {
		return nil, err
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "aims")
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var summaryID, periodID int64
	var status string
	var revisionNo int
	var currentVersionID sql.NullInt64
	var draftJSON []byte
	err = tx.QueryRowContext(ctx, `
		SELECT summary.id, summary.period_id, summary.status, summary.current_revision_no,
		       summary.current_version_id, summary.draft_content_json
		FROM company_weekly_summaries summary
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		WHERE period.period_key = ?
		FOR UPDATE
	`, periodKey).Scan(&summaryID, &periodID, &status, &revisionNo, &currentVersionID, &draftJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_required", "generate company weekly summary first")
	}
	if err != nil {
		return nil, err
	}
	if status != "draft" && status != "correction_draft" {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_not_publishable", "company weekly summary is not publishable")
	}
	var draft companySummaryDraft
	if err := json.Unmarshal(draftJSON, &draft); err != nil {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_draft_invalid", "company weekly summary draft is invalid")
	}
	if strings.TrimSpace(draft.Title) == "" {
		return nil, httperror.New(http.StatusBadRequest, "company_weekly_summary_title_required", "summary title is required")
	}

	obligations, err := loadCompanySummaryObligationsTx(ctx, tx, periodID, draft.IncludedObligationIDs)
	if err != nil {
		return nil, err
	}
	if len(obligations) == 0 {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_has_no_obligations", "reporting period has no obligations")
	}
	includedCount := 0
	for _, item := range obligations {
		if item.InclusionStatus == "included" {
			includedCount++
		}
	}
	if includedCount == 0 {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_has_no_reviewed_reports", "select at least one reviewed project weekly report")
	}

	selectionIDs, err := loadCompanySummarySelectionIDsTx(ctx, tx, summaryID)
	if err != nil {
		return nil, err
	}
	coveredSelectionKeys := serviceStringSlice(body["coveredSelectionKeys"], body["covered_selection_keys"])
	if err := validateResolvedCompanySummaryRecipients(selectionIDs, resolvedRecipients, coveredSelectionKeys); err != nil {
		return nil, err
	}

	var latestRevisionNo int
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(revision_no), 0)
		FROM company_weekly_summary_versions
		WHERE summary_id = ?
		FOR UPDATE
	`, summaryID).Scan(&latestRevisionNo); err != nil {
		return nil, err
	}
	nextRevision := latestRevisionNo + 1
	snapshot := companySummaryStructuredSnapshot(
		periodKey,
		draft,
		obligations,
		resolvedRecipients,
		actor,
		roleRevision,
		nextRevision,
		currentVersionID,
	)
	structuredJSON, err := canonicalJSON(snapshot)
	if err != nil {
		return nil, err
	}
	markdown := renderCompanySummaryMarkdown(periodKey, draft, obligations, nextRevision, currentVersionID.Valid)
	structuredHash := sha256Hex(structuredJSON)
	markdownHash := sha256Hex([]byte(markdown))
	correctionReason := strings.TrimSpace(firstBodyText(body, "correctionReason", "correction_reason"))
	var correctionOf any
	if status == "correction_draft" {
		if !currentVersionID.Valid {
			return nil, httperror.New(http.StatusConflict, "company_weekly_summary_correction_base_missing", "correction base version is missing")
		}
		if correctionReason == "" {
			return nil, httperror.New(http.StatusBadRequest, "correction_reason_required", "correction reason is required")
		}
		correctionOf = currentVersionID.Int64
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO company_weekly_summary_versions (
		  summary_id, revision_no, correction_of_version_id, correction_reason,
		  structured_snapshot_json, structured_sha256, markdown_content, markdown_sha256,
		  publish_status, published_by
		) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, 'pending', ?)
	`, summaryID, nextRevision, correctionOf, nullableText(correctionReason), string(structuredJSON),
		structuredHash, markdown, markdownHash, actor)
	if err != nil {
		return nil, err
	}
	versionID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	for _, item := range obligations {
		var reportVersion any
		if item.InclusionStatus == "included" {
			reportVersion = item.ReviewedVersion.Int64
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO company_weekly_summary_items (
			  summary_version_id, obligation_id, report_version_id, inclusion_status
			) VALUES (?, ?, ?, ?)
		`, versionID, item.ID, reportVersion, item.InclusionStatus); err != nil {
			return nil, err
		}
	}
	for _, recipient := range resolvedRecipients {
		selectionID := selectionIDs[recipient.SubjectType+":"+recipient.SubjectCode]
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO company_weekly_summary_recipient_snapshots (
			  summary_version_id, selection_id, resolved_uid, display_name_snapshot, department_code_snapshot
			) VALUES (?, ?, ?, ?, ?)
		`, versionID, selectionID, recipient.UID, recipient.DisplayName, nullableText(recipient.DepartmentCode)); err != nil {
			return nil, err
		}
	}
	for _, item := range obligations {
		if item.InclusionStatus == "included" {
			if _, err := tx.ExecContext(ctx, `
				UPDATE project_weekly_reports
				SET status = 'frozen', current_frozen_version_id = ?, updated_by = ?
				WHERE id = ? AND current_reviewed_version_id = ?
			`, item.ReviewedVersion.Int64, actor, item.ReportID.Int64, item.ReviewedVersion.Int64); err != nil {
				return nil, err
			}
		}
		dueStatus := "missing"
		if item.InclusionStatus == "included" {
			dueStatus = "frozen"
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE weekly_report_obligations
			SET due_status = ?, frozen_at = UTC_TIMESTAMP(6)
			WHERE id = ?
		`, dueStatus, item.ID); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE company_weekly_summaries
		SET status = 'publishing', updated_by = ?
		WHERE id = ?
	`, actor, summaryID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE weekly_reporting_periods
		SET status = 'publishing', obligations_frozen_at = COALESCE(obligations_frozen_at, UTC_TIMESTAMP(6))
		WHERE id = ?
	`, periodID); err != nil {
		return nil, err
	}
	operation, err := enqueueCompanyWeeklySummaryPublishOperationTx(
		ctx,
		tx,
		trusted,
		periodKey,
		summaryID,
		versionID,
		nextRevision,
		draft.Title,
		markdownHash,
		resolvedRecipients,
		actor,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"summaryId": summaryID, "summaryVersionId": versionID, "revisionNo": nextRevision,
		"periodKey": periodKey, "status": "publishing", "markdownSha256": markdownHash,
		"operation": operation,
	}, nil
}

func (a *Adapter) openCompanyWeeklySummaryCorrection(
	ctx context.Context,
	periodKey string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	actor, _, err := requireCompanySummaryDirector(query)
	if err != nil {
		return nil, err
	}
	reason := strings.TrimSpace(firstBodyText(body, "reason", "correctionReason", "correction_reason"))
	if reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "correction_reason_required", "correction reason is required")
	}
	result, err := a.DB().ExecContext(ctx, `
		UPDATE company_weekly_summaries summary
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		SET summary.status = 'correction_draft',
		    summary.updated_by = ?,
		    summary.draft_content_json = JSON_SET(
		      COALESCE(summary.draft_content_json, JSON_OBJECT()),
		      '$.correctionReason',
		      ?
		    )
		WHERE period.period_key = ?
		  AND summary.status = 'published'
		  AND summary.current_version_id IS NOT NULL
	`, actor, reason, periodKey)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_correction_not_allowed", "only a published summary can open a correction")
	}
	return a.getCompanyWeeklySummary(ctx, periodKey, query)
}

func (a *Adapter) getCompanyWeeklySummary(
	ctx context.Context,
	periodKey string,
	query url.Values,
) (map[string]any, error) {
	if _, _, err := requireCompanySummaryDirector(query); err != nil {
		return nil, err
	}
	if _, _, err := parseISOPeriodKey(periodKey); err != nil {
		return nil, err
	}
	var summaryID, periodID int64
	var status string
	var revisionNo int
	var currentVersionID sql.NullInt64
	var documentUUID sql.NullString
	var draftJSON []byte
	err := a.DB().QueryRowContext(ctx, `
		SELECT summary.id, summary.period_id, summary.status, summary.current_revision_no,
		       summary.current_version_id, summary.codocs_document_uuid,
		       COALESCE(summary.draft_content_json, JSON_OBJECT())
		FROM company_weekly_summaries summary
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		WHERE period.period_key = ?
	`, periodKey).Scan(&summaryID, &periodID, &status, &revisionNo, &currentVersionID, &documentUUID, &draftJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{
			"periodKey": periodKey, "generated": false, "status": nil,
			"draft": nil, "recipientSelections": []any{},
		}, nil
	}
	if err != nil {
		return nil, err
	}
	var draft any
	if len(draftJSON) > 0 {
		_ = json.Unmarshal(draftJSON, &draft)
	}
	selections, err := a.listCompanySummarySelections(ctx, summaryID)
	if err != nil {
		return nil, err
	}
	obligations, err := a.listCompanySummaryDraftObligations(ctx, periodID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"periodKey": periodKey, "generated": true, "id": summaryID, "status": status,
		"currentRevisionNo": revisionNo, "currentVersionId": nullableInt64(currentVersionID),
		"codocsDocumentUuid": nullableString(documentUUID), "draft": draft,
		"recipientSelections": selections, "obligations": obligations,
	}, nil
}

func (a *Adapter) listCompanyWeeklySummaryVersions(
	ctx context.Context,
	periodKey string,
	query url.Values,
) (map[string]any, error) {
	if _, _, err := requireCompanySummaryDirector(query); err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT version.id, version.revision_no, version.correction_of_version_id,
		       version.correction_reason, version.structured_sha256, version.markdown_sha256,
		       version.publish_status, version.codocs_document_uuid,
		       version.codocs_document_version_id, version.codocs_version_num,
		       version.published_by, version.published_at, version.created_at
		FROM company_weekly_summary_versions version
		INNER JOIN company_weekly_summaries summary ON summary.id = version.summary_id
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		WHERE period.period_key = ?
		ORDER BY version.revision_no DESC
	`, periodKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var revision int
		var correctionOf, documentVersionID, documentVersionNum sql.NullInt64
		var reason, documentUUID, publishedBy sql.NullString
		var structuredHash, markdownHash, publishStatus string
		var publishedAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(
			&id, &revision, &correctionOf, &reason, &structuredHash, &markdownHash,
			&publishStatus, &documentUUID, &documentVersionID, &documentVersionNum,
			&publishedBy, &publishedAt, &createdAt,
		); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "revisionNo": revision, "correctionOfVersionId": nullableInt64(correctionOf),
			"correctionReason": nullableString(reason), "structuredSha256": structuredHash,
			"markdownSha256": markdownHash, "publishStatus": publishStatus,
			"codocsDocumentUuid":      nullableString(documentUUID),
			"codocsDocumentVersionId": nullableInt64(documentVersionID),
			"codocsVersionNum":        nullableInt64(documentVersionNum),
			"publishedBy":             nullableString(publishedBy), "publishedAt": nullableTimeRFC3339(publishedAt),
			"createdAt": createdAt.UTC().Format(time.RFC3339Nano),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"periodKey": periodKey, "items": items}, nil
}

func companySummaryDraftFromBody(periodKey string, body map[string]any) (companySummaryDraft, error) {
	draft := companySummaryDraft{
		Title:   strings.TrimSpace(firstBodyText(body, "title")),
		Opening: strings.TrimSpace(firstBodyText(body, "opening")),
		Closing: strings.TrimSpace(firstBodyText(body, "closing")),
	}
	if draft.Title == "" {
		draft.Title = fmt.Sprintf("%s 公司项目周报汇总", periodKey)
	}
	rawIDs, _ := body["includedObligationIds"].([]any)
	if rawIDs == nil {
		rawIDs, _ = body["included_obligation_ids"].([]any)
	}
	seen := map[int64]struct{}{}
	for _, raw := range rawIDs {
		id, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(raw)), 10, 64)
		if err != nil || id <= 0 {
			return draft, httperror.New(http.StatusBadRequest, "invalid_included_obligation_id", "included obligation ids must be positive integers")
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		draft.IncludedObligationIDs = append(draft.IncludedObligationIDs, id)
	}
	sort.Slice(draft.IncludedObligationIDs, func(i, j int) bool {
		return draft.IncludedObligationIDs[i] < draft.IncludedObligationIDs[j]
	})
	return draft, nil
}

func companySummarySelectionsFromBody(body map[string]any) ([]companySummaryRecipientSelection, error) {
	raw, _ := body["recipientSelections"].([]any)
	if raw == nil {
		raw, _ = body["recipient_selections"].([]any)
	}
	items := make([]companySummaryRecipientSelection, 0, len(raw))
	seen := map[string]struct{}{}
	for _, value := range raw {
		row, _ := value.(map[string]any)
		item := companySummaryRecipientSelection{
			SubjectType: strings.TrimSpace(firstBodyText(row, "subjectType", "subject_type")),
			SubjectCode: strings.TrimSpace(firstBodyText(row, "subjectCode", "subject_code")),
			SubjectName: strings.TrimSpace(firstBodyText(row, "subjectName", "subject_name")),
		}
		if (item.SubjectType != "user" && item.SubjectType != "department") || item.SubjectCode == "" || item.SubjectName == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_recipient_selection", "recipient selections require type, code and display name")
		}
		key := item.SubjectType + ":" + item.SubjectCode
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].SubjectType+":"+items[i].SubjectCode < items[j].SubjectType+":"+items[j].SubjectCode
	})
	return items, nil
}

func companySummaryResolvedRecipientsFromBody(body map[string]any) ([]companySummaryResolvedRecipient, error) {
	raw, _ := body["resolvedRecipients"].([]any)
	if raw == nil {
		raw, _ = body["resolved_recipients"].([]any)
	}
	items := make([]companySummaryResolvedRecipient, 0, len(raw))
	seen := map[string]struct{}{}
	for _, value := range raw {
		row, _ := value.(map[string]any)
		item := companySummaryResolvedRecipient{
			SubjectType:    strings.TrimSpace(firstBodyText(row, "subjectType", "subject_type")),
			SubjectCode:    strings.TrimSpace(firstBodyText(row, "subjectCode", "subject_code")),
			UID:            strings.TrimSpace(firstBodyText(row, "uid")),
			DisplayName:    strings.TrimSpace(firstBodyText(row, "displayName", "display_name")),
			DepartmentCode: strings.TrimSpace(firstBodyText(row, "departmentCode", "department_code")),
		}
		if (item.SubjectType != "user" && item.SubjectType != "department") ||
			item.SubjectCode == "" || item.UID == "" || item.DisplayName == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_resolved_recipient", "resolved recipients require selection identity, uid and display name")
		}
		if _, exists := seen[item.UID]; exists {
			continue
		}
		seen[item.UID] = struct{}{}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UID < items[j].UID })
	return items, nil
}

func validateCompanySummaryIncludedObligationsTx(
	ctx context.Context,
	tx *sql.Tx,
	summaryID int64,
	ids []int64,
) error {
	for _, id := range ids {
		var reviewedVersionID sql.NullInt64
		err := tx.QueryRowContext(ctx, `
			SELECT report.current_reviewed_version_id
			FROM company_weekly_summaries summary
			INNER JOIN weekly_report_obligations obligation ON obligation.period_id = summary.period_id
			LEFT JOIN project_weekly_reports report ON report.obligation_id = obligation.id
			WHERE summary.id = ? AND obligation.id = ?
		`, summaryID, id).Scan(&reviewedVersionID)
		if errors.Is(err, sql.ErrNoRows) {
			return httperror.New(http.StatusBadRequest, "company_weekly_summary_obligation_out_of_period", "selected obligation does not belong to summary period")
		}
		if err != nil {
			return err
		}
		if !reviewedVersionID.Valid {
			return httperror.New(http.StatusConflict, "company_weekly_summary_report_not_reviewed", "only a reviewed project weekly report can be included")
		}
	}
	return nil
}

func loadCompanySummaryObligationsTx(
	ctx context.Context,
	tx *sql.Tx,
	periodID int64,
	includedIDs []int64,
) ([]companySummaryObligation, error) {
	selected := map[int64]struct{}{}
	for _, id := range includedIDs {
		selected[id] = struct{}{}
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT
		  obligation.id, obligation.project_id, project.project_code, project.name,
		  obligation.responsible_uid_snapshot, obligation.due_status, obligation.late_flag,
		  report.id, report.current_reviewed_version_id,
		  version.selected_rag, version.manager_content_json, version.fact_snapshot_json,
		  version.submitted_by, version.submitted_at
		FROM weekly_report_obligations obligation
		INNER JOIN aims_projects project ON project.id = obligation.project_id
		LEFT JOIN project_weekly_reports report ON report.obligation_id = obligation.id
		LEFT JOIN project_weekly_report_versions version ON version.id = report.current_reviewed_version_id
		WHERE obligation.period_id = ?
		ORDER BY project.project_code, obligation.id
		FOR UPDATE
	`, periodID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]companySummaryObligation, 0)
	seenSelected := map[int64]struct{}{}
	for rows.Next() {
		var item companySummaryObligation
		var late int
		if err := rows.Scan(
			&item.ID, &item.ProjectID, &item.ProjectCode, &item.ProjectName,
			&item.ResponsibleUID, &item.DueStatus, &late, &item.ReportID,
			&item.ReviewedVersion, &item.SelectedRAG, &item.ManagerContent,
			&item.FactSnapshot, &item.SubmittedBy, &item.SubmittedAt,
		); err != nil {
			return nil, err
		}
		item.Late = late == 1
		_, item.IncludedByChoice = selected[item.ID]
		switch {
		case item.IncludedByChoice && item.ReviewedVersion.Valid:
			item.InclusionStatus = "included"
			seenSelected[item.ID] = struct{}{}
		case item.IncludedByChoice:
			return nil, httperror.New(http.StatusConflict, "company_weekly_summary_report_not_reviewed", "only a reviewed project weekly report can be included")
		case !item.ReviewedVersion.Valid:
			item.InclusionStatus = "missing"
		default:
			item.InclusionStatus = "late_unincluded"
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(seenSelected) != len(selected) {
		return nil, httperror.New(http.StatusBadRequest, "company_weekly_summary_obligation_out_of_period", "selected obligation does not belong to summary period")
	}
	return items, nil
}

func loadCompanySummarySelectionIDsTx(
	ctx context.Context,
	tx *sql.Tx,
	summaryID int64,
) (map[string]int64, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, subject_type, subject_code
		FROM company_weekly_summary_recipient_selections
		WHERE summary_id = ?
		ORDER BY id
		FOR UPDATE
	`, summaryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]int64{}
	for rows.Next() {
		var id int64
		var subjectType, subjectCode string
		if err := rows.Scan(&id, &subjectType, &subjectCode); err != nil {
			return nil, err
		}
		result[subjectType+":"+subjectCode] = id
	}
	return result, rows.Err()
}

func validateResolvedCompanySummaryRecipients(
	selections map[string]int64,
	resolved []companySummaryResolvedRecipient,
	coveredSelectionKeys []string,
) error {
	for _, recipient := range resolved {
		key := recipient.SubjectType + ":" + recipient.SubjectCode
		if selections[key] == 0 {
			return httperror.New(http.StatusConflict, "company_summary_recipient_selection_mismatch", "resolved recipient does not match a frozen selection")
		}
	}
	covered := map[string]bool{}
	for _, key := range coveredSelectionKeys {
		key = strings.TrimSpace(key)
		if selections[key] == 0 {
			return httperror.New(http.StatusConflict, "company_summary_recipient_selection_mismatch", "recipient coverage does not match a frozen selection")
		}
		covered[key] = true
	}
	for key := range selections {
		if !covered[key] {
			return httperror.New(http.StatusConflict, "company_summary_recipient_resolution_incomplete", "every recipient selection must resolve to at least one active user")
		}
	}
	return nil
}

func companySummaryStructuredSnapshot(
	periodKey string,
	draft companySummaryDraft,
	obligations []companySummaryObligation,
	recipients []companySummaryResolvedRecipient,
	actor string,
	roleRevision int64,
	revision int,
	correctionOf sql.NullInt64,
) map[string]any {
	items := make([]map[string]any, 0, len(obligations))
	for _, item := range obligations {
		row := map[string]any{
			"obligationId": item.ID, "projectId": item.ProjectID, "projectCode": item.ProjectCode,
			"projectName": item.ProjectName, "responsibleUid": item.ResponsibleUID,
			"dueStatus": item.DueStatus, "late": item.Late, "inclusionStatus": item.InclusionStatus,
		}
		if item.InclusionStatus == "included" {
			var managerContent any
			var factSnapshot any
			_ = json.Unmarshal(item.ManagerContent, &managerContent)
			_ = json.Unmarshal(item.FactSnapshot, &factSnapshot)
			row["reportId"] = item.ReportID.Int64
			row["reportVersionId"] = item.ReviewedVersion.Int64
			row["selectedRag"] = item.SelectedRAG.String
			row["managerContent"] = managerContent
			row["factSnapshot"] = factSnapshot
			row["submittedBy"] = item.SubmittedBy.String
			if item.SubmittedAt.Valid {
				row["submittedAt"] = item.SubmittedAt.Time.UTC().Format(time.RFC3339Nano)
			}
		}
		items = append(items, row)
	}
	recipientItems := make([]map[string]any, 0, len(recipients))
	for _, recipient := range recipients {
		recipientItems = append(recipientItems, map[string]any{
			"subjectType": recipient.SubjectType, "subjectCode": recipient.SubjectCode,
			"uid": recipient.UID, "displayName": recipient.DisplayName,
			"departmentCode": nullableText(recipient.DepartmentCode),
		})
	}
	return map[string]any{
		"schema": companyWeeklySummaryStructuredSchema, "periodKey": periodKey,
		"revisionNo": revision, "correctionOfVersionId": nullableInt64(correctionOf),
		"title": draft.Title, "opening": draft.Opening, "closing": draft.Closing,
		"publishedBy": actor, "projectDirectorRoleRevision": roleRevision,
		"items": items, "recipients": recipientItems,
	}
}

func renderCompanySummaryMarkdown(
	periodKey string,
	draft companySummaryDraft,
	obligations []companySummaryObligation,
	revision int,
	correction bool,
) string {
	var builder strings.Builder
	builder.WriteString("# ")
	builder.WriteString(strings.TrimSpace(draft.Title))
	builder.WriteString("\n\n")
	builder.WriteString("- 周期：")
	builder.WriteString(periodKey)
	builder.WriteString("\n- 版本：R")
	builder.WriteString(strconv.Itoa(revision))
	if correction {
		builder.WriteString("（更正版）")
	}
	builder.WriteString("\n\n")
	if draft.Opening != "" {
		builder.WriteString(draft.Opening)
		builder.WriteString("\n\n")
	}
	included, missing, lateUnincluded := 0, 0, 0
	for _, item := range obligations {
		switch item.InclusionStatus {
		case "included":
			included++
		case "missing":
			missing++
		case "late_unincluded":
			lateUnincluded++
		}
	}
	builder.WriteString("## 汇总概览\n\n")
	builder.WriteString(fmt.Sprintf("- 已纳入：%d 个项目\n- 缺报：%d 个项目\n- 已审阅但未纳入：%d 个项目\n\n", included, missing, lateUnincluded))

	for _, item := range obligations {
		if item.InclusionStatus != "included" {
			continue
		}
		builder.WriteString("## ")
		builder.WriteString(item.ProjectName)
		builder.WriteString("（")
		builder.WriteString(item.ProjectCode)
		builder.WriteString("）\n\n")
		builder.WriteString("- 项目经理：")
		builder.WriteString(item.ResponsibleUID)
		builder.WriteString("\n- RAG：")
		builder.WriteString(strings.ToUpper(item.SelectedRAG.String))
		if item.Late {
			builder.WriteString("\n- 提交状态：迟交")
		}
		builder.WriteString("\n\n")
		var content map[string]any
		_ = json.Unmarshal(item.ManagerContent, &content)
		for _, field := range []struct {
			key   string
			label string
		}{
			{"mainWork", "本周主要工作"},
			{"overallProgress", "总体进展"},
			{"majorRisks", "主要风险"},
			{"coordinationNeeds", "需协调事项"},
			{"remarks", "备注"},
		} {
			value := strings.TrimSpace(fmt.Sprint(content[field.key]))
			if value == "" || value == "<nil>" {
				continue
			}
			builder.WriteString("### ")
			builder.WriteString(field.label)
			builder.WriteString("\n\n")
			builder.WriteString(value)
			builder.WriteString("\n\n")
		}
	}

	if missing > 0 || lateUnincluded > 0 {
		builder.WriteString("## 未纳入清单\n\n")
		builder.WriteString("| 项目 | 状态 |\n| --- | --- |\n")
		for _, item := range obligations {
			if item.InclusionStatus == "included" {
				continue
			}
			status := "缺报"
			if item.InclusionStatus == "late_unincluded" {
				status = "已审阅但未纳入"
			}
			builder.WriteString("| ")
			builder.WriteString(item.ProjectName + "（" + item.ProjectCode + "）")
			builder.WriteString(" | ")
			builder.WriteString(status)
			builder.WriteString(" |\n")
		}
		builder.WriteString("\n")
	}
	if draft.Closing != "" {
		builder.WriteString("## 补充说明\n\n")
		builder.WriteString(draft.Closing)
		builder.WriteString("\n")
	}
	return builder.String()
}

func enqueueCompanyWeeklySummaryPublishOperationTx(
	ctx context.Context,
	tx *sql.Tx,
	trusted integrationoperation.TrustedContext,
	periodKey string,
	summaryID int64,
	versionID int64,
	revision int,
	title string,
	markdownHash string,
	recipients []companySummaryResolvedRecipient,
	actor string,
) (map[string]any, error) {
	operationKey := fmt.Sprintf("aims:company-weekly-summary:%s:r%d:publish:v1", periodKey, revision)
	recipientUIDs := make([]string, 0, len(recipients))
	for _, item := range recipients {
		recipientUIDs = append(recipientUIDs, item.UID)
	}
	command := map[string]any{
		"periodKey": periodKey, "summaryId": summaryID, "summaryVersionId": versionID,
		"revisionNo": revision, "title": title, "markdownSha256": markdownHash,
		"recipientUids": recipientUIDs, "documentType": companyWeeklySummaryDefaultDocumentType,
		"idempotencyKey": operationKey, "operatorUid": actor,
	}
	commandSHA256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return nil, err
	}
	identity := integrationoperation.Identity{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode,
		SourceApp: "aims", TargetApp: "codocs", OperationCode: companyWeeklySummaryOperationCode,
		SourceBizType: "company_weekly_summary", SourceBizCode: periodKey,
		IdempotencyKey: operationKey, CommandSHA256: commandSHA256,
	}
	if err := identity.Validate(); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, trusted.SQL(`
		INSERT INTO integration_operation (
		  operation_id, operation_key, correlation_key, sequence_no, depends_on_operation_key,
		  tenant_code, deployment_code, source_app, target_app, operation_code,
		  required_capability, source_biz_type, source_biz_code, idempotency_key,
		  command_schema_version, command_json, command_sha256, status,
		  original_request_id, original_actor_uid, service_client_id, created_by, updated_by,
		  next_attempt_at
		) VALUES (?, ?, ?, 1, NULL, ?, ?, 'aims', 'codocs', ?, ?, 'company_weekly_summary', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
	`), operationID, operationKey, operationKey, trusted.TenantCode, trusted.DeploymentCode,
		companyWeeklySummaryOperationCode, companyWeeklySummaryRequiredCapability,
		periodKey, operationKey, companyWeeklySummaryCommandSchema, string(commandJSON), commandSHA256,
		nullableText(trusted.RequestID), nullableText(actor), nullableText(trusted.ServiceClientID),
		nullableText(actor), nullableText(actor)); err != nil {
		return nil, err
	}
	return map[string]any{
		"linked": true, "operationId": operationID, "operationKey": operationKey,
		"operationStatus": string(integrationoperation.StatusPending),
	}, nil
}

func (a *Adapter) listCompanySummarySelections(ctx context.Context, summaryID int64) ([]map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, subject_type, subject_code, subject_name_snapshot, selected_by
		FROM company_weekly_summary_recipient_selections
		WHERE summary_id = ?
		ORDER BY subject_type, subject_name_snapshot, subject_code
	`, summaryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var subjectType, code, name, selectedBy string
		if err := rows.Scan(&id, &subjectType, &code, &name, &selectedBy); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "subjectType": subjectType, "subjectCode": code,
			"subjectName": name, "selectedBy": selectedBy,
		})
	}
	return items, rows.Err()
}

func (a *Adapter) listCompanySummaryDraftObligations(ctx context.Context, periodID int64) ([]map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT obligation.id, obligation.project_id, project.project_code, project.name,
		       obligation.responsible_uid_snapshot, obligation.due_status, obligation.late_flag,
		       report.id, report.status, report.current_reviewed_version_id
		FROM weekly_report_obligations obligation
		INNER JOIN aims_projects project ON project.id = obligation.project_id
		LEFT JOIN project_weekly_reports report ON report.obligation_id = obligation.id
		WHERE obligation.period_id = ?
		ORDER BY project.project_code, obligation.id
	`, periodID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var obligationID, projectID int64
		var projectCode, projectName, responsibleUID, dueStatus string
		var late int
		var reportID, reviewedVersionID sql.NullInt64
		var reportStatus sql.NullString
		if err := rows.Scan(
			&obligationID, &projectID, &projectCode, &projectName, &responsibleUID,
			&dueStatus, &late, &reportID, &reportStatus, &reviewedVersionID,
		); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"obligationId": obligationID, "projectId": projectID, "projectCode": projectCode,
			"projectName": projectName, "responsibleUid": responsibleUID, "dueStatus": dueStatus,
			"late": late == 1, "reportId": nullableInt64(reportID),
			"reportStatus": nullableString(reportStatus), "reviewedVersionId": nullableInt64(reviewedVersionID),
			"eligible": reviewedVersionID.Valid,
		})
	}
	return items, rows.Err()
}

func nullableTimeRFC3339(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time.UTC().Format(time.RFC3339Nano)
}

func completeCompanyWeeklySummaryPublishTx(
	ctx context.Context,
	tx *sql.Tx,
	command map[string]any,
	body map[string]any,
) error {
	versionID, err := bodyPositiveInt64(command, "summaryVersionId", "summary_version_id")
	if err != nil || versionID <= 0 {
		return httperror.New(http.StatusConflict, "company_weekly_summary_operation_invalid", "summary version identity is invalid")
	}
	periodKey := strings.TrimSpace(firstBodyText(command, "periodKey", "period_key"))
	markdownHash := strings.TrimSpace(firstBodyText(command, "markdownSha256", "markdown_sha256"))
	documentUUID := strings.TrimSpace(firstBodyText(body, "documentUuid", "document_uuid"))
	documentVersionID, versionErr := bodyPositiveInt64(body, "documentVersionId", "document_version_id")
	documentVersionNum, numberErr := bodyPositiveInt64(body, "documentVersionNum", "document_version_num")
	if periodKey == "" || markdownHash == "" || documentUUID == "" ||
		versionErr != nil || documentVersionID <= 0 || numberErr != nil || documentVersionNum <= 0 {
		return httperror.New(http.StatusConflict, "company_weekly_summary_codocs_receipt_incomplete", "Codocs document receipt is incomplete")
	}

	var summaryID, periodID int64
	var revision int
	var storedHash, publishStatus, publishedBy string
	err = tx.QueryRowContext(ctx, `
		SELECT version.summary_id, summary.period_id, version.revision_no,
		       version.markdown_sha256, version.publish_status, COALESCE(version.published_by, '')
		FROM company_weekly_summary_versions version
		INNER JOIN company_weekly_summaries summary ON summary.id = version.summary_id
		INNER JOIN weekly_reporting_periods period ON period.id = summary.period_id
		WHERE version.id = ? AND period.period_key = ?
		FOR UPDATE
	`, versionID, periodKey).Scan(
		&summaryID, &periodID, &revision, &storedHash, &publishStatus, &publishedBy,
	)
	if err != nil {
		return err
	}
	if storedHash != markdownHash {
		return httperror.New(http.StatusConflict, "company_weekly_summary_markdown_hash_mismatch", "summary Markdown hash does not match the published document")
	}
	if publishStatus == "published" {
		var storedDocumentUUID string
		var storedVersionID int64
		err := tx.QueryRowContext(ctx, `
			SELECT codocs_document_uuid, codocs_document_version_id
			FROM company_weekly_summary_versions
			WHERE id = ?
		`, versionID).Scan(&storedDocumentUUID, &storedVersionID)
		if err != nil {
			return err
		}
		if storedDocumentUUID != documentUUID || storedVersionID != documentVersionID {
			return httperror.New(http.StatusConflict, "company_weekly_summary_codocs_binding_conflict", "summary version is already bound to another Codocs version")
		}
		return nil
	}
	if publishStatus != "pending" && publishStatus != "failed" {
		return httperror.New(http.StatusConflict, "company_weekly_summary_version_not_publishable", "summary version is not publishable")
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE company_weekly_summary_versions
		SET publish_status = 'published',
		    codocs_document_uuid = ?,
		    codocs_document_version_id = ?,
		    codocs_version_num = ?,
		    published_at = UTC_TIMESTAMP(6)
		WHERE id = ?
	`, documentUUID, documentVersionID, documentVersionNum, versionID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE company_weekly_summaries
		SET status = 'published',
		    current_revision_no = ?,
		    current_version_id = ?,
		    codocs_document_uuid = ?,
		    updated_by = ?
		WHERE id = ?
	`, revision, versionID, documentUUID, nullableText(publishedBy), summaryID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE weekly_reporting_periods
		SET status = 'published'
		WHERE id = ?
	`, periodID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO time_entry_review_events (
		  time_entry_id, from_status, to_status, actor_uid, reason,
		  report_version_id, summary_version_id
		)
		SELECT entry.id, entry.review_status, 'approved', ?, 'company_weekly_summary_publish',
		       entry.locked_report_version_id, ?
		FROM time_entries entry
		INNER JOIN company_weekly_summary_items item
		  ON item.summary_version_id = ?
		 AND item.inclusion_status = 'included'
		 AND item.report_version_id = entry.locked_report_version_id
		WHERE entry.review_route = 'company_summary'
		  AND entry.review_status = 'submitted'
		ORDER BY entry.id
	`, publishedBy, versionID, versionID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE time_entries entry
		INNER JOIN company_weekly_summary_items item
		  ON item.summary_version_id = ?
		 AND item.inclusion_status = 'included'
		 AND item.report_version_id = entry.locked_report_version_id
		SET entry.review_status = 'approved',
		    entry.reviewed_by = ?,
		    entry.reviewed_at = UTC_TIMESTAMP(6),
		    entry.approved_summary_version_id = ?,
		    entry.row_version = entry.row_version + 1,
		    entry.return_reason = NULL
		WHERE entry.review_route = 'company_summary'
		  AND entry.review_status = 'submitted'
	`, versionID, nullableText(publishedBy), versionID); err != nil {
		return err
	}
	return insertCompanySummaryFactSnapshotsTx(ctx, tx, periodKey, versionID)
}

func insertCompanySummaryFactSnapshotsTx(
	ctx context.Context,
	tx *sql.Tx,
	periodKey string,
	versionID int64,
) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT item.obligation_id, obligation.project_id, project.project_code,
		       obligation.responsible_uid_snapshot, item.report_version_id,
		       version.selected_rag, version.fact_snapshot_sha256,
		       version.submitted_at, obligation.late_flag
		FROM company_weekly_summary_items item
		INNER JOIN weekly_report_obligations obligation ON obligation.id = item.obligation_id
		INNER JOIN aims_projects project ON project.id = obligation.project_id
		INNER JOIN project_weekly_report_versions version ON version.id = item.report_version_id
		WHERE item.summary_version_id = ?
		  AND item.inclusion_status = 'included'
		ORDER BY project.project_code, obligation.id
		FOR UPDATE
	`, versionID)
	if err != nil {
		return err
	}
	type fact struct {
		obligationID    int64
		projectID       int64
		projectCode     string
		subjectUID      string
		reportVersionID int64
		rag             string
		factHash        string
		submittedAt     time.Time
		late            int
	}
	facts := make([]fact, 0)
	for rows.Next() {
		var item fact
		if err := rows.Scan(
			&item.obligationID, &item.projectID, &item.projectCode, &item.subjectUID,
			&item.reportVersionID, &item.rag, &item.factHash, &item.submittedAt, &item.late,
		); err != nil {
			rows.Close()
			return err
		}
		facts = append(facts, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	var nextRevision uint64
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(revision), 0) + 1
		FROM project_management_fact_snapshots
		FOR UPDATE
	`).Scan(&nextRevision); err != nil {
		return err
	}
	for _, item := range facts {
		value := map[string]any{
			"schema":    "aims.project-management-fact.v1",
			"periodKey": periodKey, "projectId": item.projectID, "projectCode": item.projectCode,
			"projectManagerUid": item.subjectUID, "selectedRag": item.rag,
			"late": item.late == 1, "submittedAt": item.submittedAt.UTC().Format(time.RFC3339Nano),
		}
		sourceRefs := map[string]any{
			"companyWeeklySummaryVersionId": versionID, "obligationId": item.obligationID,
			"projectWeeklyReportVersionId":  item.reportVersionID,
			"projectWeeklyReportFactSha256": item.factHash,
		}
		valueJSON, err := canonicalJSON(value)
		if err != nil {
			return err
		}
		sourceJSON, err := canonicalJSON(sourceRefs)
		if err != nil {
			return err
		}
		var correctionOf sql.NullInt64
		err = tx.QueryRowContext(ctx, `
			SELECT id
			FROM project_management_fact_snapshots
			WHERE fact_code = 'project_weekly_governance'
			  AND period_key = ?
			  AND project_id = ?
			ORDER BY revision DESC
			LIMIT 1
		`, periodKey, item.projectID).Scan(&correctionOf)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO project_management_fact_snapshots (
			  revision, fact_code, period_key, subject_uid, project_id, project_code,
			  value_json, source_refs_json, source_sha256, correction_of_id
			) VALUES (?, 'project_weekly_governance', ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)
		`, nextRevision, periodKey, item.subjectUID, item.projectID, item.projectCode,
			string(valueJSON), string(sourceJSON), sha256Hex(sourceJSON), nullableInt64(correctionOf)); err != nil {
			return err
		}
		nextRevision++
	}
	return nil
}
