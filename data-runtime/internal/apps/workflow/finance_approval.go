package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

func (a *Adapter) ReadFinanceApprovalInstance(ctx context.Context, biz, no string) (*workflowapproval.Instance, error) {
	if a == nil || a.db == nil {
		return nil, httperror.New(503, "workflow_adapter_unavailable", "Workflow unavailable")
	}
	if !strings.HasPrefix(no, "APF-FIN-") {
		return nil, httperror.New(400, "finance_approval_read_invalid", "Invalid approval request")
	}
	row, e := queryOneMap(ctx, a.db, "SELECT id,instance_no,app_code,resource_code,action_code,biz_id,initiator_uid,status,callback_url,form_data FROM flow_instances WHERE app_code='finance' AND ((resource_code='invoices' AND action_code='request') OR (resource_code='expenses' AND action_code IN ('claim','project_expense','payment'))) AND biz_id=? AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.requestNo'))=? ORDER BY id DESC LIMIT 1", biz, no)
	if e != nil || row == nil {
		return nil, e
	}
	parsed, e := parseAnyJSON(row["form_data"])
	if e != nil {
		return nil, e
	}
	form, ok := parsed.(map[string]any)
	if !ok {
		return nil, httperror.New(503, "workflow_form_invalid", "Invalid form")
	}
	v := &workflowapproval.Instance{ID: cleanAnyString(row["id"]), No: cleanAnyString(row["instance_no"]), App: cleanAnyString(row["app_code"]), Resource: cleanAnyString(row["resource_code"]), Action: cleanAnyString(row["action_code"]), BizID: cleanAnyString(row["biz_id"]), Initiator: cleanAnyString(row["initiator_uid"]), Status: cleanAnyString(row["status"]), CallbackPath: cleanAnyString(row["callback_url"]), Form: form}
	action := "approve"
	if v.Status == "rejected" {
		action = "reject"
	}
	rows, e := queryMaps(ctx, a.db, "SELECT actor_uid FROM flow_actions WHERE instance_id=? AND action=? ORDER BY id", row["id"], action)
	if e != nil {
		return nil, e
	}
	for _, a := range rows {
		uid := cleanAnyString(a["actor_uid"])
		v.Operator = uid
		if uid != "" && uid != v.Initiator {
			v.NonSelf = append(v.NonSelf, uid)
		}
	}
	return v, nil
}
func isFrozenFinanceApproval(action *actionDefRecord, request CreateInstanceRequest) bool {
	return workflowapproval.FinanceRegistered(action.AppCode, action.ResourceCode, action.ActionCode) && strings.HasPrefix(cleanAnyString(request.FormData["requestNo"]), "APF-FIN-")
}
func replayFinanceApproval(ctx context.Context, tx *sql.Tx, action *actionDefRecord, request CreateInstanceRequest) (*InstanceAPIResponse, error) {
	form := request.FormData
	if len(form) != 6 || cleanAnyString(form["resource"]) != action.ResourceCode || cleanAnyString(form["bizId"]) != cleanAnyString(request.BizID) || cleanAnyString(form["requestedBy"]) != request.CurrentUser || !workflowapproval.FinanceCallbackPath(request.CallbackURL) || len(cleanAnyString(form["snapshotHash"])) != 64 {
		return nil, httperror.New(400, "finance_approval_request_invalid", "Frozen approval required")
	}
	var locked int64
	if e := tx.QueryRowContext(ctx, "SELECT id FROM flow_action_defs WHERE id=? AND status=1 FOR UPDATE", action.ID).Scan(&locked); e != nil {
		return nil, e
	}
	var id int64
	var no, actor, raw string
	e := tx.QueryRowContext(ctx, "SELECT id,instance_no,initiator_uid,CAST(form_data AS CHAR) FROM flow_instances WHERE app_code='finance' AND resource_code=? AND action_code=? AND biz_id=? AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.requestNo'))=? ORDER BY id DESC LIMIT 1 FOR UPDATE", action.ResourceCode, action.ActionCode, cleanAnyString(request.BizID), form["requestNo"]).Scan(&id, &no, &actor, &raw)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var stored map[string]any
	if json.Unmarshal([]byte(raw), &stored) != nil {
		return nil, httperror.New(503, "workflow_snapshot_invalid", "Invalid form")
	}
	existing, _ := json.Marshal(stored)
	incoming, _ := json.Marshal(form)
	if actor != request.CurrentUser || string(existing) != string(incoming) {
		return nil, httperror.New(409, "idempotency_payload_mismatch", "Approval intent differs")
	}
	return &InstanceAPIResponse{Code: 0, Data: map[string]any{"instance_id": id, "instance_no": no, "replayed": true}}, nil
}

func requireFinanceNonSelfApproval(instance map[string]any, actor string) error {
	if !workflowapproval.FinanceRegistered(cleanAnyString(instance["app_code"]), cleanAnyString(instance["resource_code"]), cleanAnyString(instance["action_code"])) {
		return nil
	}
	form, e := parseJSONObject(cleanAnyString(instance["form_data"]))
	if e == nil && !strings.HasPrefix(cleanAnyString(form["requestNo"]), "APF-FIN-") {
		return nil
	}
	if e != nil || cleanAnyString(form["requestedBy"]) == "" {
		return httperror.New(409, "finance_approval_frozen_request_required", "Frozen approval required")
	}
	if cleanAnyString(form["requestedBy"]) == actor {
		return httperror.New(403, "finance_self_approval_forbidden", "Self approval forbidden")
	}
	return nil
}
