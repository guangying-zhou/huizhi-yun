package workflow

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

type workflowNotificationTarget struct {
	AppCode      string
	ResourceCode string
	BizID        string
	InstanceID   int64
}

func actionEventVersion(actionID int64) string {
	return fmt.Sprintf("flow_actions:%d", actionID)
}

func taskEventVersion(taskIDs []int64) string {
	ordered := append([]int64(nil), taskIDs...)
	sort.Slice(ordered, func(left, right int) bool { return ordered[left] < ordered[right] })
	parts := make([]string, 0, len(ordered))
	for _, taskID := range ordered {
		parts = append(parts, strconv.FormatInt(taskID, 10))
	}
	digest := sha256.Sum256([]byte(strings.Join(parts, ",")))
	return fmt.Sprintf("flow_tasks:sha256:%x", digest)
}

func taskActionableKey(taskIDs []int64) string {
	return "workflow:tasks:" + strings.TrimPrefix(taskEventVersion(taskIDs), "flow_tasks:")
}

func delegatedTaskActionableKey(taskID int64, actionID int64) string {
	return fmt.Sprintf("workflow:task:%d:delegate:%d", taskID, actionID)
}

func notificationTargetFromInstance(instance map[string]any) workflowNotificationTarget {
	return workflowNotificationTarget{
		AppCode:      cleanAnyString(instance["app_code"]),
		ResourceCode: cleanAnyString(instance["resource_code"]),
		BizID:        cleanAnyString(instance["biz_id"]),
		InstanceID:   anyInt64(instance["id"]),
	}
}

func actionableWorkflowURL(rawURL string, taskIDs []int64, instanceID int64) (string, bool) {
	value := strings.TrimSpace(rawURL)
	if value != "" && !strings.ContainsAny(value, "\r\n") {
		parsed, err := url.Parse(value)
		if err == nil {
			if parsed.IsAbs() && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" {
				return value, false
			}
			if !parsed.IsAbs() && parsed.Host == "" && strings.HasPrefix(parsed.Path, "/") && !strings.HasPrefix(value, "//") {
				return value, false
			}
		}
	}
	if len(taskIDs) == 1 {
		return fmt.Sprintf("/workflow/tasks/%d", taskIDs[0]), true
	}
	return fmt.Sprintf("/workflow/instances/%d", instanceID), true
}

func newWorkflowNotification(toUser []string, title string, description string, rawURL string, eventType string, eventVersion string, severity string, target workflowNotificationTarget, metadata map[string]any) WorkflowNotification {
	if metadata == nil {
		metadata = map[string]any{}
	}
	taskIDs := int64List(metadata["taskIds"])
	if taskID := anyInt64(metadata["taskId"]); taskID > 0 && len(taskIDs) == 0 {
		taskIDs = []int64{taskID}
	}
	resolvedURL, usedFallback := actionableWorkflowURL(rawURL, taskIDs, target.InstanceID)
	bizType := target.ResourceCode
	bizID := target.BizID
	if bizType == "" {
		bizType = "workflow_instance"
	}
	if bizID == "" {
		bizID = strconv.FormatInt(target.InstanceID, 10)
	}
	metadata["eventVersion"] = eventVersion
	metadata["sourceApp"] = "workflow"
	metadata["targetAppCode"] = target.AppCode
	metadata["businessTargetAppCode"] = target.AppCode
	metadata["actionTargetAppCode"] = map[bool]string{true: "workflow", false: target.AppCode}[usedFallback]
	metadata["workflowInstanceId"] = target.InstanceID
	metadata["workflowInstanceKey"] = fmt.Sprintf("workflow:instance:%d", target.InstanceID)
	metadata["bizKey"] = fmt.Sprintf("%s:%s:%s", target.AppCode, bizType, bizID)
	metadata["urlFallback"] = usedFallback
	if len(taskIDs) > 0 {
		metadata["workflowTaskIds"] = taskIDs
		metadata["authorizationDescriptor"] = map[string]any{
			"resource": "workflow_task",
			"id":       workflowTaskAuthorizationIdentity(target.InstanceID, taskIDs),
		}
		if cleanAnyString(metadata["actionableKey"]) == "" {
			metadata["actionableKey"] = taskActionableKey(taskIDs)
		}
	} else {
		metadata["authorizationDescriptor"] = map[string]any{
			"resource": "workflow_instance",
			"id":       strconv.FormatInt(target.InstanceID, 10),
		}
		metadata["actionableKey"] = fmt.Sprintf("workflow:instance:%d", target.InstanceID)
	}
	return WorkflowNotification{
		ToUser:         toUser,
		Title:          title,
		Description:    description,
		URL:            resolvedURL,
		EventType:      eventType,
		EventVersion:   eventVersion,
		Category:       "approval",
		Severity:       severity,
		BizType:        bizType,
		BizID:          bizID,
		IdempotencyKey: "workflow:" + eventType + ":" + eventVersion,
		Metadata:       metadata,
	}
}

func workflowTaskAuthorizationIdentity(instanceID int64, taskIDs []int64) string {
	ordered := append([]int64(nil), taskIDs...)
	sort.Slice(ordered, func(left, right int) bool { return ordered[left] < ordered[right] })
	unique := make([]string, 0, len(ordered))
	var previous int64
	for index, taskID := range ordered {
		if taskID <= 0 || (index > 0 && taskID == previous) {
			continue
		}
		unique = append(unique, strconv.FormatInt(taskID, 10))
		previous = taskID
	}
	return fmt.Sprintf("instance:%d:tasks:%s", instanceID, strings.Join(unique, ","))
}

func int64List(value any) []int64 {
	result := make([]int64, 0)
	switch items := value.(type) {
	case []int64:
		return append(result, items...)
	case []any:
		for _, item := range items {
			if id := anyInt64(item); id > 0 {
				result = append(result, id)
			}
		}
	}
	return result
}
