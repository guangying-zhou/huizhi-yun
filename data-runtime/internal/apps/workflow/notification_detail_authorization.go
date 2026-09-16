package workflow

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type workflowNotificationAuthorizationDescriptor struct {
	Resource   string
	ID         string
	InstanceID int64
	TaskIDs    []int64
}

func (a *Adapter) authorizeNotificationDetail(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	uid := cleanAnyString(body["current_user"])
	if uid == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	descriptor, err := normalizeWorkflowNotificationAuthorizationDescriptor(asStringMap(body["descriptor"]))
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}

	authorized, reasonCode, err := a.workflowNotificationDetailAccess(ctx, uid, descriptor)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{
		"authorized": authorized,
		"reasonCode": reasonCode,
		"resource":   descriptor.Resource,
		"id":         descriptor.ID,
	}}, "workflow.notification_details.authorize", nil
}

func normalizeWorkflowNotificationAuthorizationDescriptor(raw map[string]any) (workflowNotificationAuthorizationDescriptor, error) {
	resource := cleanAnyString(raw["resource"])
	rawID := cleanAnyString(raw["id"])
	if resource == "workflow_instance" {
		instanceID, err := strconv.ParseInt(rawID, 10, 64)
		if err != nil || instanceID <= 0 {
			return workflowNotificationAuthorizationDescriptor{}, httperror.New(http.StatusBadRequest, "invalid_descriptor", "workflow instance descriptor is invalid")
		}
		return workflowNotificationAuthorizationDescriptor{Resource: resource, ID: strconv.FormatInt(instanceID, 10), InstanceID: instanceID}, nil
	}
	if resource != "workflow_task" {
		return workflowNotificationAuthorizationDescriptor{}, httperror.New(http.StatusBadRequest, "unsupported_descriptor", "notification detail resource is unsupported")
	}

	const prefix = "instance:"
	const separator = ":tasks:"
	if !strings.HasPrefix(rawID, prefix) {
		return workflowNotificationAuthorizationDescriptor{}, httperror.New(http.StatusBadRequest, "invalid_descriptor", "workflow task descriptor is invalid")
	}
	parts := strings.SplitN(strings.TrimPrefix(rawID, prefix), separator, 2)
	if len(parts) != 2 {
		return workflowNotificationAuthorizationDescriptor{}, httperror.New(http.StatusBadRequest, "invalid_descriptor", "workflow task descriptor is invalid")
	}
	instanceID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || instanceID <= 0 {
		return workflowNotificationAuthorizationDescriptor{}, httperror.New(http.StatusBadRequest, "invalid_descriptor", "workflow task instance is invalid")
	}
	taskIDs := make([]int64, 0)
	seen := map[int64]bool{}
	for _, value := range strings.Split(parts[1], ",") {
		taskID, parseErr := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if parseErr != nil || taskID <= 0 {
			return workflowNotificationAuthorizationDescriptor{}, httperror.New(http.StatusBadRequest, "invalid_descriptor", "workflow task id is invalid")
		}
		if !seen[taskID] {
			seen[taskID] = true
			taskIDs = append(taskIDs, taskID)
		}
	}
	if len(taskIDs) == 0 {
		return workflowNotificationAuthorizationDescriptor{}, httperror.New(http.StatusBadRequest, "invalid_descriptor", "workflow task ids are required")
	}
	sort.Slice(taskIDs, func(left, right int) bool { return taskIDs[left] < taskIDs[right] })
	return workflowNotificationAuthorizationDescriptor{
		Resource:   resource,
		ID:         workflowTaskAuthorizationIdentity(instanceID, taskIDs),
		InstanceID: instanceID,
		TaskIDs:    taskIDs,
	}, nil
}

func (a *Adapter) workflowNotificationDetailAccess(ctx context.Context, uid string, descriptor workflowNotificationAuthorizationDescriptor) (bool, string, error) {
	if descriptor.Resource == "workflow_task" {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(descriptor.TaskIDs)), ",")
		args := []any{uid, descriptor.InstanceID}
		for _, taskID := range descriptor.TaskIDs {
			args = append(args, taskID)
		}
		var count, pendingAssigned int64
		err := a.db.QueryRowContext(ctx, `
			SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'pending' AND assignee_uid = ? THEN 1 ELSE 0 END), 0)
			FROM flow_tasks
			WHERE instance_id = ? AND id IN (`+placeholders+`)
		`, args...).Scan(&count, &pendingAssigned)
		if err != nil {
			return false, "", err
		}
		if count != int64(len(descriptor.TaskIDs)) {
			return false, "descriptor_mismatch", nil
		}
		if pendingAssigned > 0 {
			return true, "allowed", nil
		}
	}

	var instanceExists, visible int64
	err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(CASE
			WHEN i.initiator_uid = ? OR EXISTS (
				SELECT 1 FROM flow_tasks related
				WHERE related.instance_id = i.id AND related.assignee_uid = ?
			) THEN 1 ELSE 0 END), 0)
		FROM flow_instances i
		WHERE i.id = ?
	`, uid, uid, descriptor.InstanceID).Scan(&instanceExists, &visible)
	if err != nil {
		return false, "", err
	}
	if instanceExists == 0 {
		return false, "not_found", nil
	}
	if visible > 0 {
		return true, "allowed", nil
	}
	return false, "restricted", nil
}
