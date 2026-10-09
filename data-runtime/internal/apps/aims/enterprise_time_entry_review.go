package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type enterpriseReviewEntry struct{ ID, Version int64 }

func enterpriseReviewEntries(body map[string]any) ([]enterpriseReviewEntry, error) {
	bad := httperror.New(400, "time_entry_review_input_invalid", "Invalid review input")
	raw, ok := body["entries"].([]any)
	if !ok || len(raw) == 0 || len(raw) > 100 {
		return nil, bad
	}
	result := make([]enterpriseReviewEntry, 0, len(raw))
	previous := int64(0)
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok || len(entry) != 2 {
			return nil, bad
		}
		id, err := bodyInt64(entry, "id")
		if err != nil || id <= previous {
			return nil, bad
		}
		version, err := bodyInt64(entry, "rowVersion")
		if err != nil || version < 1 {
			return nil, bad
		}
		result = append(result, enterpriseReviewEntry{id, version})
		previous = id
	}
	return result, nil
}

// Hosted reviews use the existing service-command receipt in the same project,
// entry, event and receipt transaction. The standalone Aims route is unchanged.
func (a *Adapter) reviewEnterpriseProjectTimeEntries(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	identity := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !truthyQuery(query, "current_user_can_approve_timesheet") || identity.ActorUID == "" || identity.ActorUID != currentUserFrom(query, body) || identity.IdempotencyKey == "" || identity.CommandScope == nil {
		return nil, httperror.New(403, "timesheet_approve_permission_required", "Timesheet approval authorization required")
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	action, _ := body["action"].(string)
	reason, _ := body["reason"].(string)
	if (action != "approve" && action != "return") || (action == "return" && strings.TrimSpace(reason) == "") {
		return nil, httperror.New(400, "time_entry_review_input_invalid", "Invalid review input")
	}
	entries, err := enterpriseReviewEntries(body)
	if err != nil {
		return nil, err
	}
	tx, repo, err := a.beginTimeEntryWrite(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, rawProjectID, "", "time-entry-review"); err != nil {
		return nil, err
	}
	var leader string
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(leader_uid,'') FROM aims_projects WHERE id=? FOR UPDATE`, projectID).Scan(&leader)
	if err != nil {
		return nil, err
	}
	if leader != identity.ActorUID {
		var role string
		err = tx.QueryRowContext(ctx, `SELECT role FROM aims_project_members WHERE project_id=? AND BINARY uid=BINARY ? AND status='active' FOR UPDATE`, projectID, identity.ActorUID).Scan(&role)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if role != "manager" {
			var delegationID int64
			err = tx.QueryRowContext(ctx, `SELECT id FROM project_manager_delegations WHERE project_id=? AND BINARY delegate_uid=BINARY ? AND revoked_at IS NULL AND starts_at<=UTC_TIMESTAMP(6) AND ends_at>UTC_TIMESTAMP(6) ORDER BY starts_at DESC,id DESC LIMIT 1 FOR UPDATE`, projectID, identity.ActorUID).Scan(&delegationID)
			if err == sql.ErrNoRows {
				return nil, httperror.New(403, "project_manager_required", "Current project manager required")
			}
			if err != nil {
				return nil, err
			}
		}
	}
	for _, entry := range entries {
		var owningID int64
		var owner, reviewer, route string
		err = tx.QueryRowContext(ctx, `SELECT project_id,uid,COALESCE(reviewer_uid_snapshot,''),COALESCE(review_route,'') FROM time_entries WHERE id=? FOR UPDATE`, entry.ID).Scan(&owningID, &owner, &reviewer, &route)
		if err == sql.ErrNoRows {
			return nil, httperror.New(404, "time_entry_not_found", "Time entry not found")
		}
		if err != nil {
			return nil, err
		}
		if owningID != projectID {
			return nil, httperror.New(404, "time_entry_not_found", "Time entry not found")
		}
		if owner == identity.ActorUID {
			return nil, httperror.New(403, "time_entry_self_review_denied", "Self review denied")
		}
		if reviewer != identity.ActorUID || route != "project_manager" {
			return nil, httperror.New(403, "time_entry_reviewer_changed", "Reviewer assignment changed")
		}
	}
	commandEntries := make([]any, 0, len(entries))
	ids := make([]int64, 0, len(entries))
	for _, entry := range entries {
		commandEntries = append(commandEntries, []int64{entry.ID, entry.Version})
		ids = append(ids, entry.ID)
	}
	command := map[string]any{"projectId": rawProjectID, "action": action, "entries": commandEntries, "reason": reason}
	input, err := enterpriseDeliverableReceiptInput(ctx, "review", "aims:enterprise-host:execute", "time-entry-review.v1", command)
	if err != nil {
		return nil, err
	}
	input.OperationCode = "enterprise.aims.time-entry-reviews.review.v1"
	next := "approved"
	if action == "return" {
		next = "returned"
	}
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(writeCtx context.Context, _ *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		for _, entry := range entries {
			var status string
			var version int64
			if e := tx.QueryRowContext(writeCtx, `SELECT review_status,row_version FROM time_entries WHERE id=?`, entry.ID).Scan(&status, &version); e != nil {
				return iop.ReceiptBusinessResult{}, e
			}
			if status != "submitted" || version != entry.Version {
				return iop.ReceiptBusinessResult{}, httperror.New(409, "time_entry_review_version_conflict", "Time entry changed; reload before review")
			}
			if _, e := tx.ExecContext(writeCtx, `UPDATE time_entries SET review_status=?,row_version=row_version+1,reviewed_by=?,reviewed_at=UTC_TIMESTAMP(6),return_reason=? WHERE id=? AND review_status='submitted' AND row_version=?`, next, identity.ActorUID, nullableText(reason), entry.ID, entry.Version); e != nil {
				return iop.ReceiptBusinessResult{}, e
			}
			if _, e := tx.ExecContext(writeCtx, `INSERT INTO time_entry_review_events(time_entry_id,from_status,to_status,actor_uid,reason) VALUES(?,'submitted',?,?,?)`, entry.ID, next, identity.ActorUID, nullableText(reason)); e != nil {
				return iop.ReceiptBusinessResult{}, e
			}
		}
		value := map[string]any{"action": action, "entryIds": ids, "updatedCount": len(ids)}
		return iop.ReceiptBusinessResult{TargetBizType: "time-entry-review", TargetBizCode: strconv.FormatInt(projectID, 10), HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"action": action, "entryIds": ids, "updatedCount": len(ids), "receiptId": result.ReceiptID, "idempotent": result.Existing, "replayed": result.Existing}, nil
}
