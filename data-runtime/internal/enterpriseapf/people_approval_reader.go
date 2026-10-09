package enterpriseapf

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"strconv"
)

// Always use the explicitly injected standalone reader. Registry presence must
// never silently switch the source of approval authority.
func (s PeopleFactsService) readApproval(ctx context.Context, id string) (*workflowapproval.Instance, error) {
	n, err := strconv.ParseUint(id, 10, 64)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != id {
		return nil, httperror.New(400, "people_workflow_id_invalid", "Instance invalid")
	}
	if s.ApprovalReader == nil {
		return nil, httperror.New(503, "people_workflow_unavailable", "Workflow unavailable")
	}
	v, err := s.ApprovalReader.ReadPeopleApprovalInstance(ctx, id)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, httperror.New(404, "workflow_instance_not_found", "Workflow instance unavailable")
	}
	if v.ID != id || !workflowapproval.PeopleRegistered(v.App, v.Resource, v.Action) || v.CallbackPath != workflowapproval.CallbackPath {
		return nil, httperror.New(403, "people_workflow_binding_invalid", "Workflow binding invalid")
	}
	return v, nil
}
