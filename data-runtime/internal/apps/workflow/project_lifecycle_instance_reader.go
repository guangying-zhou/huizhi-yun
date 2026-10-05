package workflow

import (
	"context"
	aims "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

var _ aims.AimsWorkflowInstanceReader = (*Adapter)(nil)

// ReadProjectLifecycleInstance is only a typed, read-only in-process dependency.
// It does not expose a new HTTP route or accept trusted/service/user flags.
// Aims checks the signed command and exact frozen identity before binding.
func (a *Adapter) ReadProjectLifecycleInstance(ctx context.Context, id string) (aims.ProjectLifecycleInstance, error) {
	if a == nil || a.db == nil {
		return aims.ProjectLifecycleInstance{}, httperror.New(503, "workflow_adapter_unavailable", "Workflow adapter unavailable")
	}
	instance, err := queryOneMap(ctx, a.db, "SELECT id,instance_no,biz_id,initiator_uid,app_code,resource_code,action_code,form_data FROM flow_instances WHERE id = ?", id)
	if err != nil {
		return aims.ProjectLifecycleInstance{}, err
	}
	if instance == nil {
		return aims.ProjectLifecycleInstance{}, httperror.New(http.StatusNotFound, "instance_not_found", "Workflow instance missing")
	}
	parsed, err := parseAnyJSON(instance["form_data"])
	if err != nil {
		return aims.ProjectLifecycleInstance{}, err
	}
	form, ok := parsed.(map[string]any)
	if !ok {
		return aims.ProjectLifecycleInstance{}, httperror.New(503, "workflow_instance_form_invalid", "Workflow instance form unavailable")
	}
	return aims.ProjectLifecycleInstance{InstanceID: cleanAnyString(instance["id"]), InstanceNo: cleanAnyString(instance["instance_no"]), BizID: cleanAnyString(instance["biz_id"]), InitiatorUID: cleanAnyString(instance["initiator_uid"]), AppCode: cleanAnyString(instance["app_code"]), ResourceCode: cleanAnyString(instance["resource_code"]), ActionCode: cleanAnyString(instance["action_code"]), Form: form}, nil
}
