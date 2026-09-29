package workflow

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Derive evidence inside the terminal transition transaction. Earlier submission
// rounds cannot supply approvers for a resubmitted instance.
func bindCompletionApprovalEvidence(ctx context.Context, tx *sql.Tx, callback *WorkflowCallback, instance map[string]any, actionID int64) error {
	if callback.URL != aimsCompletionWorkflowCallback {
		return nil
	}
	action := "approve"
	status := cleanAnyString(callback.Payload["status"])
	if status != "approved" && status != "rejected" {
		return httperror.New(409, "completion_approval_evidence_invalid", "Unsupported approval terminal status")
	}
	if status == "rejected" {
		action = "reject"
	}
	rows, err := queryMaps(ctx, tx, `SELECT id, actor_uid, action FROM flow_actions
		WHERE instance_id = ? AND action = ?
		AND id > COALESCE((SELECT MAX(previous.id) FROM flow_actions previous WHERE previous.instance_id = ? AND previous.action = 'resubmit'), 0)
		ORDER BY id`, instance["id"], action, instance["id"])
	if err != nil {
		return err
	}
	actors, nonSelf := []string{}, []string{}
	seen := map[string]bool{}
	operator := ""
	for _, row := range rows {
		uid := cleanAnyString(row["actor_uid"])
		if uid == "" {
			return httperror.New(409, "completion_approval_evidence_invalid", "Approval actor evidence unavailable")
		}
		if anyInt64(row["id"]) == actionID {
			operator = uid
		}
		if !seen[uid] {
			seen[uid] = true
			actors = append(actors, uid)
			if uid != cleanAnyString(instance["initiator_uid"]) {
				nonSelf = append(nonSelf, uid)
			}
		}
	}
	if operator == "" {
		return httperror.New(409, "completion_approval_evidence_invalid", "Terminal approval actor unavailable")
	}
	callback.Payload["approval_actor_uids"] = actors
	callback.Payload["non_self_approval_actor_uids"] = nonSelf
	callback.Payload["approval_operator_uid"] = operator
	return nil
}

func bindCompletionCancellationEvidence(ctx context.Context, tx *sql.Tx, callback *WorkflowCallback, instance map[string]any, actionID int64) error {
	if callback.URL != aimsCompletionWorkflowCallback {
		return nil
	}
	if cleanAnyString(callback.Payload["status"]) != "cancelled" {
		return httperror.New(409, "completion_cancellation_evidence_invalid", "Cancellation evidence requires cancelled status")
	}
	withdraw, err := queryOneMap(ctx, tx, "SELECT actor_uid FROM flow_actions WHERE id = ? AND instance_id = ? AND action = 'withdraw'", actionID, instance["id"])
	if err != nil {
		return err
	}
	if withdraw == nil || cleanAnyString(withdraw["actor_uid"]) == "" || cleanAnyString(withdraw["actor_uid"]) != cleanAnyString(instance["initiator_uid"]) {
		return httperror.New(409, "completion_cancellation_evidence_invalid", "Trusted initiator withdrawal is required")
	}
	callback.Payload["cancellation_actor_uid"] = cleanAnyString(withdraw["actor_uid"])
	return nil
}
