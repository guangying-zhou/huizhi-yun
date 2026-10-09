package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"regexp"
	"strings"
)

func isProjectLifecycleAction(action *actionDefRecord) bool {
	return action.AppCode == "aims" && action.ResourceCode == "projects" && (action.ActionCode == "pause" || action.ActionCode == "resume" || action.ActionCode == "finish")
}

func isFrozenProjectLifecycleRequest(action *actionDefRecord, request CreateInstanceRequest) bool {
	return isProjectLifecycleAction(action) && strings.HasPrefix(cleanAnyString(request.FormData["requestNo"]), "PLC-")
}

// The frozen request number is the stable creation key. Serialize on the owning
// definition before checking it so concurrent retries cannot create two instances.
// Existing final instances are immutable; a new business intent gets a new one.
func replayProjectLifecycleRequest(ctx context.Context, tx *sql.Tx, action *actionDefRecord, request CreateInstanceRequest) (*InstanceAPIResponse, error) {
	requestNo := cleanAnyString(request.FormData["requestNo"])
	if !regexp.MustCompile(`^PLC-[a-f0-9]{64}$`).MatchString(requestNo) || cleanAnyString(request.FormData["projectId"]) != cleanAnyString(request.BizID) || cleanAnyString(request.FormData["actionCode"]) != action.ActionCode || cleanAnyString(request.FormData["requestedBy"]) != request.CurrentUser {
		return nil, httperror.New(400, "project_lifecycle_request_invalid", "Frozen lifecycle request required")
	}
	var locked int64
	if err := tx.QueryRowContext(ctx, "SELECT id FROM flow_action_defs WHERE id=? AND status=1 FOR UPDATE", action.ID).Scan(&locked); err != nil {
		return nil, err
	}
	var instanceID int64
	var instanceNo, actor, biz, raw string
	err := tx.QueryRowContext(ctx, `SELECT id,instance_no,initiator_uid,biz_id,CAST(form_data AS CHAR) FROM flow_instances WHERE app_code='aims' AND resource_code='projects' AND action_code=? AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.requestNo'))=? FOR UPDATE`, action.ActionCode, requestNo).Scan(&instanceID, &instanceNo, &actor, &biz, &raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var stored map[string]any
	if json.Unmarshal([]byte(raw), &stored) != nil {
		return nil, httperror.New(503, "project_lifecycle_snapshot_invalid", "Frozen instance unavailable")
	}
	existing, _ := json.Marshal(stored)
	incoming, _ := json.Marshal(request.FormData)
	if actor != request.CurrentUser || biz != cleanAnyString(request.BizID) || string(existing) != string(incoming) {
		return nil, httperror.New(409, "idempotency_payload_mismatch", "Lifecycle request intent changed")
	}
	return &InstanceAPIResponse{Code: 0, Data: map[string]any{"instance_id": instanceID, "instance_no": instanceNo, "mode": "replayed"}}, nil
}
