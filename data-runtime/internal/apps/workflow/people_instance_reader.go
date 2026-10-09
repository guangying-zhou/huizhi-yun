package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var _ people.PeopleWorkflowReader = (*Adapter)(nil)

// Narrow owning interface; People never imports Workflow, nor receives a DB
// identity from HTTP. The mapping and transaction come from the same Registry.
func (a *Adapter) ReadPeopleWorkflowInstance(ctx context.Context, tx *sql.Tx, table func(string) (string, error), id string) (people.PeopleWorkflowInstance, error) {
	var v people.PeopleWorkflowInstance
	var raw []byte
	if a == nil || tx == nil || table == nil {
		return v, httperror.New(503, "people_workflow_unavailable", "Workflow unavailable")
	}
	t, e := table("flow_instances")
	if e != nil {
		return v, e
	}
	e = tx.QueryRowContext(ctx, "SELECT id,app_code,resource_code,action_code,biz_id,initiator_uid,status,form_data FROM "+t+" WHERE id=? FOR UPDATE", id).Scan(&v.ID, &v.App, &v.Resource, &v.Action, &v.BizID, &v.Actor, &v.Status, &raw)
	if e == sql.ErrNoRows {
		return v, httperror.New(404, "workflow_instance_not_found", "Workflow instance unavailable")
	}
	if e != nil {
		return v, e
	}
	if e = json.Unmarshal(raw, &v.Form); e != nil || v.Form == nil {
		return v, httperror.New(503, "workflow_form_unavailable", "Workflow form unavailable")
	}
	return v, nil
}
