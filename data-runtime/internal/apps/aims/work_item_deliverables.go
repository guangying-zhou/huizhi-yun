package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var workItemDeliverableStatuses = map[string]bool{
	"pending":   true,
	"submitted": true,
	"approved":  true,
	"rejected":  true,
}

func (a *Adapter) updateWorkItemDeliverable(ctx context.Context, rawWorkItemID string, rawDeliverableID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	workItemID, projectID, deliverableID, err := a.workItemDeliverableProject(ctx, rawWorkItemID, rawDeliverableID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}
	if !validDeliverableReceiptIdentity(ctx) {
		if err := a.requireDeliverableMilestoneCompletionUnlocked(ctx, deliverableID); err != nil {
			return nil, err
		}
		if hasAnyBodyKey(body, "documentUuid", "document_uuid", "documentSource", "document_source") {
			if err := a.requireNoOpenDeliverableQualityReview(ctx, deliverableID); err != nil {
				return nil, err
			}
		}
		if firstBodyText(body, "status") == "approved" {
			if err := a.requireDeliverableQualityBeforeApproval(ctx, deliverableID); err != nil {
				return nil, err
			}
		}
	}

	sets := make([]string, 0, 12)
	args := make([]any, 0, 12)
	appendNullableBodySet := func(column string, keys ...string) {
		if !hasAnyBodyKey(body, keys...) {
			return
		}
		sets = append(sets, column+" = ?")
		args = append(args, nullableText(firstBodyText(body, keys...)))
	}

	appendNullableBodySet("evidence_url", "evidenceUrl", "evidence_url")
	appendNullableBodySet("evidence_note", "evidenceNote", "evidence_note")
	appendNullableBodySet("document_uuid", "documentUuid", "document_uuid")
	appendNullableBodySet("document_title", "documentTitle", "document_title")
	if hasAnyBodyKey(body, "documentSource", "document_source") {
		documentSource := firstBodyText(body, "documentSource", "document_source")
		if documentSource == "" {
			documentSource = "codocs"
		}
		sets = append(sets, "document_source = ?")
		args = append(args, documentSource)
	}
	appendNullableBodySet("repo_project_code", "repoProjectCode", "repo_project_code")
	appendNullableBodySet("repo_file_path", "repoFilePath", "repo_file_path")
	appendNullableBodySet("repo_commit_id", "repoCommitId", "repo_commit_id")

	status := firstBodyText(body, "status")
	if status != "" {
		if !workItemDeliverableStatuses[status] {
			return nil, httperror.New(http.StatusBadRequest, "invalid_deliverable_status", "status must be pending/submitted/approved/rejected")
		}
		sets = append(sets, "status = ?")
		args = append(args, status)
		if status == "submitted" {
			sets = append(sets, "submitted_by = ?", "submitted_at = CURRENT_TIMESTAMP")
			args = append(args, uid)
		}
	} else if workItemDeliverableShouldAutoSubmit(body) {
		sets = append(sets, "status = ?", "submitted_by = ?", "submitted_at = CURRENT_TIMESTAMP")
		args = append(args, "submitted", uid)
	}

	if len(sets) == 0 {
		return map[string]any{
			"workItemId":    workItemID,
			"deliverableId": deliverableID,
			"updated":       false,
		}, nil
	}

	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, deliverableID)
	tx, receipts, err := a.beginDeliverableWrite(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var lockedProjectID int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM aims_projects WHERE id = ? FOR UPDATE", projectID).Scan(&lockedProjectID); err != nil {
		return nil, err
	}
	if err := requireEnterpriseDeliverableProjectScopeTx(ctx, tx, uid, projectID, false); err != nil {
		return nil, err
	}
	if _, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); enabled {
		var actual int64
		if err := tx.QueryRowContext(ctx, "SELECT project_id FROM work_items WHERE id=? FOR UPDATE", workItemID).Scan(&actual); err != nil {
			return nil, err
		}
		if actual != projectID {
			return nil, httperror.New(403, "work_item_project_mismatch", "Work item changed project")
		}
	}
	if err := requireEnterpriseDeliverableOwnerTx(ctx, tx, projectID, deliverableID, workItemID); err != nil {
		return nil, err
	}
	receipt, err := executeEnterpriseDeliverableReceipt(ctx, tx, receipts, "work-item-update", "aims:work-item-deliverables:edit", "work-deliverable-update.v1", "work-item-deliverable", map[string]any{"workItemId": workItemID, "deliverableId": deliverableID, "payload": body}, map[string]any{"workItemId": workItemID, "deliverableId": deliverableID, "updated": true}, func() (map[string]any, string, error) {
		if err := lockExistingMatterDeliverableWriteTx(ctx, tx, projectID, deliverableID); err != nil {
			return nil, "", err
		}
		if receipts != nil {
			if err := requireDeliverableMilestoneCompletionUnlockedTx(ctx, tx, deliverableID); err != nil {
				return nil, "", err
			}
		}
		if receipts != nil && hasAnyBodyKey(body, "documentUuid", "document_uuid", "documentSource", "document_source") {
			if err := requireNoOpenDeliverableQualityReviewTx(ctx, tx, deliverableID); err != nil {
				return nil, "", err
			}
		}
		if receipts != nil && status == "approved" {
			if err := a.requireDeliverableQualityBeforeApproval(context.WithValue(ctx, enterpriseMilestoneTxKey{}, tx), deliverableID); err != nil {
				return nil, "", err
			}
		}
		_, err := tx.ExecContext(ctx, "UPDATE deliverables SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
		if err != nil {
			return nil, "", fmt.Errorf("update work item deliverable: %w", err)
		}
		// lockExistingMatterDeliverableWriteTx already locked this exact row
		// and project; zero changed rows means the submitted values were equal.
		return map[string]any{"workItemId": workItemID, "deliverableId": deliverableID, "updated": true}, deliverableReceiptCode(deliverableID), nil
	})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	deliverables, err := a.executionDeliverables(ctx, strconv.FormatInt(workItemID, 10))
	if err != nil {
		return nil, fmt.Errorf("reload updated work item deliverable: %w", err)
	}
	var updatedDeliverable *executionDeliverable
	for index := range deliverables {
		if deliverables[index].ID == deliverableID {
			updatedDeliverable = &deliverables[index]
			break
		}
	}
	if updatedDeliverable == nil {
		return nil, httperror.New(http.StatusNotFound, "deliverable_not_found", "deliverable not found")
	}

	out := map[string]any{
		"workItemId":    workItemID,
		"deliverableId": deliverableID,
		"updated":       true,
		"deliverable":   updatedDeliverable,
	}
	if receipts != nil {
		out["receiptId"] = receipt["receiptId"]
		out["idempotent"] = receipt["idempotent"]
	}
	return out, nil
}

func (a *Adapter) workItemDeliverableProject(ctx context.Context, rawWorkItemID string, rawDeliverableID string) (int64, int64, int64, error) {
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return 0, 0, 0, err
	}
	deliverableID, err := parseID(rawDeliverableID, "deliverable_id")
	if err != nil {
		return 0, 0, 0, err
	}

	var projectID int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT wi.project_id
		FROM work_items wi
		JOIN deliverables d ON d.id = ? AND (d.target_id = wi.id OR d.matter_id = wi.id)
		WHERE wi.id = ?
		LIMIT 1
	`, deliverableID, workItemID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return 0, 0, 0, httperror.New(http.StatusNotFound, "deliverable_not_found", "deliverable not found")
	}
	if err != nil {
		return 0, 0, 0, err
	}
	return workItemID, projectID, deliverableID, nil
}

func workItemDeliverableShouldAutoSubmit(body map[string]any) bool {
	hasCodocsBinding := (firstBodyText(body, "documentSource", "document_source") == "codocs" && firstBodyText(body, "documentUuid", "document_uuid") != "") ||
		firstBodyText(body, "documentUuid", "document_uuid") != ""
	hasRepoBinding := (firstBodyText(body, "documentSource", "document_source") == "repo" && firstBodyText(body, "repoProjectCode", "repo_project_code") != "" && firstBodyText(body, "repoFilePath", "repo_file_path") != "") ||
		(firstBodyText(body, "repoProjectCode", "repo_project_code") != "" && firstBodyText(body, "repoFilePath", "repo_file_path") != "")
	return hasCodocsBinding || hasRepoBinding
}
