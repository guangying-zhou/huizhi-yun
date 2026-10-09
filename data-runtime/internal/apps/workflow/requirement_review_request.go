package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

// Narrow, owning read port wired only by Runtime construction. It supplies the
// formal persisted result/form; no SQL/table or arbitrary app comes from Aims.
func (a *Adapter) ReadAimsRequirementReviewInstance(ctx context.Context, batchID, instanceID, actor, action string) (map[string]any, error) {
	if !regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(batchID) || actor == "" || (action != "requirement_baseline" && action != "requirement_change") {
		return nil, httperror.New(400, "requirement_workflow_read_invalid", "Invalid review identity")
	}
	args := []any{batchID, actor, action}
	extra := ""
	if instanceID != "" {
		if !regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(instanceID) {
			return nil, httperror.New(409, "requirement_workflow_binding_mismatch", "Invalid instance")
		}
		extra = " AND id=?"
		args = append(args, instanceID)
	}
	result, err := queryOneMap(ctx, a.db, `SELECT id,instance_no,app_code,resource_code,action_code,biz_id,initiator_uid,status,form_data FROM flow_instances WHERE app_code='aims' AND resource_code='requirements' AND biz_id=? AND BINARY initiator_uid=BINARY ? AND action_code=?`+extra+` ORDER BY id DESC LIMIT 1`, args...)
	if err != nil || result == nil {
		return result, err
	}
	var form map[string]any
	if json.Unmarshal([]byte(cleanAnyString(result["form_data"])), &form) != nil {
		return nil, httperror.New(503, "requirement_workflow_snapshot_invalid", "Workflow form unavailable")
	}
	result["form_data"] = form
	decision, err := queryOneMap(ctx, a.db, `SELECT actor_uid FROM flow_actions WHERE instance_id=? AND action IN ('approve','reject') ORDER BY id DESC LIMIT 1`, result["id"])
	if err != nil {
		return nil, err
	}
	if decision != nil {
		result["approval_operator_uid"] = decision["actor_uid"]
	}
	return result, nil
}
func isFrozenRequirementReviewRequest(action *actionDefRecord, request CreateInstanceRequest) bool {
	return strings.HasPrefix(cleanAnyString(request.FormData["requestNo"]), "RRB-") && action.AppCode == "aims" && action.ResourceCode == "requirements" && (action.ActionCode == "requirement_baseline" || action.ActionCode == "requirement_change")
}

// Each review is a one-shot business object. Serialize creation on its action
// definition and replay the original immutable instance, including final ones.
func replayRequirementReviewRequest(ctx context.Context, tx *sql.Tx, action *actionDefRecord, request CreateInstanceRequest) (*InstanceAPIResponse, error) {
	form := request.FormData
	bid := cleanAnyString(request.BizID)
	hash := cleanAnyString(form["snapshotHash"])
	if len(form) != 5 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(hash) || !regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(bid) || cleanAnyString(form["batchId"]) != bid || cleanAnyString(form["requestedBy"]) != request.CurrentUser || cleanAnyString(form["requestNo"]) != fmt.Sprintf("RRB-%s-%s", bid, hash) || !regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(cleanAnyString(form["projectId"])) {
		return nil, httperror.New(400, "requirement_review_request_invalid", "Frozen review request required")
	}
	var locked int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM flow_action_defs WHERE id=? AND status=1 FOR UPDATE", action.ID).Scan(&locked); err != nil {
		return nil, err
	}
	var id int64
	var no, actor, raw string
	err := tx.QueryRowContext(ctx, `SELECT id,instance_no,initiator_uid,CAST(form_data AS CHAR) FROM flow_instances WHERE app_code='aims' AND resource_code='requirements' AND action_code=? AND biz_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE`, action.ActionCode, bid).Scan(&id, &no, &actor, &raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var stored map[string]any
	if json.Unmarshal([]byte(raw), &stored) != nil {
		return nil, httperror.New(503, "requirement_workflow_snapshot_invalid", "Stored review unavailable")
	}
	incoming, _ := json.Marshal(form)
	existing, _ := json.Marshal(stored)
	if actor != request.CurrentUser || string(incoming) != string(existing) {
		return nil, httperror.New(409, "idempotency_payload_mismatch", "Review intent differs")
	}
	return &InstanceAPIResponse{Code: 0, Data: map[string]any{"instance_id": id, "instance_no": no, "replayed": true}}, nil
}

// A frozen review is a one-shot result, not a mutable resubmission round.
func requireMutableRequirementReviewInstance(instance map[string]any) error {
	if workflowapproval.Registered(cleanAnyString(instance["app_code"]), cleanAnyString(instance["resource_code"]), cleanAnyString(instance["action_code"])) {
		return httperror.New(409, "altoc_approval_round_closed", "Submit a new Altoc request after rejection")
	}
	if cleanAnyString(instance["app_code"]) != "aims" || cleanAnyString(instance["resource_code"]) != "requirements" {
		return nil
	}
	action := cleanAnyString(instance["action_code"])
	if action != "requirement_baseline" && action != "requirement_change" {
		return nil
	}
	form, err := parseJSONObject(cleanAnyString(instance["form_data"]))
	if err != nil {
		return err
	}
	if strings.HasPrefix(cleanAnyString(form["requestNo"]), "RRB-") {
		return httperror.New(409, "requirement_review_batch_closed", "Create a new review batch after rejection")
	}
	return nil
}
