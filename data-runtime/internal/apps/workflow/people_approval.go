package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"regexp"
	"strconv"
)

var _ workflowapproval.PeopleReader = (*Adapter)(nil)

func (a *Adapter) ReadPeopleApprovalInstance(ctx context.Context, id string) (*workflowapproval.Instance, error) {
	if a == nil || a.db == nil {
		return nil, httperror.New(503, "workflow_adapter_unavailable", "Workflow unavailable")
	}
	n, e := strconv.ParseUint(id, 10, 64)
	if e != nil || n == 0 || strconv.FormatUint(n, 10) != id {
		return nil, httperror.New(400, "people_workflow_id_invalid", "Instance invalid")
	}
	row, e := queryOneMap(ctx, a.db, "SELECT id,instance_no,app_code,resource_code,action_code,biz_id,initiator_uid,status,callback_url,form_data FROM flow_instances WHERE id=?", id)
	if e != nil || row == nil {
		return nil, e
	}
	form, e := parseAnyJSON(row["form_data"])
	if e != nil {
		return nil, e
	}
	data, ok := form.(map[string]any)
	if !ok {
		return nil, httperror.New(503, "workflow_form_invalid", "Invalid form")
	}
	return &workflowapproval.Instance{ID: cleanAnyString(row["id"]), No: cleanAnyString(row["instance_no"]), App: cleanAnyString(row["app_code"]), Resource: cleanAnyString(row["resource_code"]), Action: cleanAnyString(row["action_code"]), BizID: cleanAnyString(row["biz_id"]), Initiator: cleanAnyString(row["initiator_uid"]), Status: cleanAnyString(row["status"]), CallbackPath: cleanAnyString(row["callback_url"]), Form: data}, nil
}

var peopleApprovalSnapshotHash = regexp.MustCompile(`^[a-f0-9]{64}$`)

func isFrozenPeopleApproval(action *actionDefRecord, request CreateInstanceRequest) bool {
	hash, ok := request.FormData["snapshotHash"].(string)
	return workflowapproval.PeopleRegistered(action.AppCode, action.ResourceCode, action.ActionCode) && ok && peopleApprovalSnapshotHash.MatchString(hash)
}

// The action lock serializes lookup and creation even when no instance exists.
// This replays the frozen intent; it does not waive the ordinary active guard.
func replayPeopleApproval(ctx context.Context, tx *sql.Tx, action *actionDefRecord, request CreateInstanceRequest) (*InstanceAPIResponse, error) {
	form := request.FormData
	if !isFrozenPeopleApproval(action, request) || form["requestedBy"] != request.CurrentUser || request.CurrentUser == "" || cleanAnyString(form["id"]) == "" || cleanAnyString(form["employee_uid"]) == "" || cleanAnyString(form["assignment_code"]) != cleanAnyString(request.BizID) || request.CallbackURL != workflowapproval.CallbackPath {
		return nil, httperror.New(400, "people_approval_request_invalid", "Frozen approval required")
	}
	incoming, e := json.Marshal(form)
	if e != nil {
		return nil, httperror.New(400, "people_approval_request_invalid", "Invalid form")
	}
	var locked int64
	if e = tx.QueryRowContext(ctx, "SELECT id FROM flow_action_defs WHERE id=? AND status=1 FOR UPDATE", action.ID).Scan(&locked); e != nil {
		return nil, e
	}
	var id int64
	var no, actor, raw string
	e = tx.QueryRowContext(ctx, "SELECT id,instance_no,initiator_uid,CAST(form_data AS CHAR) FROM flow_instances WHERE app_code=? AND resource_code=? AND action_code=? AND biz_id=? AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.snapshotHash'))=? ORDER BY id DESC LIMIT 1 FOR UPDATE", action.AppCode, action.ResourceCode, action.ActionCode, cleanAnyString(request.BizID), form["snapshotHash"]).Scan(&id, &no, &actor, &raw)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var stored map[string]any
	if json.Unmarshal([]byte(raw), &stored) != nil || stored == nil {
		return nil, httperror.New(503, "workflow_snapshot_invalid", "Invalid form")
	}
	existing, e := json.Marshal(stored)
	if e != nil {
		return nil, httperror.New(503, "workflow_snapshot_invalid", "Invalid form")
	}
	if actor != request.CurrentUser || string(existing) != string(incoming) {
		return nil, httperror.New(409, "idempotency_payload_mismatch", "Approval intent differs")
	}
	return &InstanceAPIResponse{Code: 0, Data: map[string]any{"instance_id": id, "instance_no": no, "replayed": true}}, nil
}
