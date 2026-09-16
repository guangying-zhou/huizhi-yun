package workflow

import (
	"reflect"
	"testing"
)

func TestActionableLifecycleEffectsGroupOnlyExactTaskGeneration(t *testing.T) {
	tasks := []map[string]any{
		{"assignee_uid": "u2", "actionable_key": "workflow:tasks:g1", "actionable_version": "flow_tasks:g1"},
		{"assignee_uid": "u1", "actionable_key": "workflow:tasks:g1", "actionable_version": "flow_tasks:g1"},
		{"assignee_uid": "u3", "actionable_key": "workflow:task:3:delegate:9", "actionable_version": "flow_actions:9"},
	}

	effects := actionableLifecycleEffectsForTasks(tasks, "flow_actions:10", "cancelled")
	if len(effects) != 2 {
		t.Fatalf("expected exact generation groups, got %#v", effects)
	}
	if effects[0].ActionableKey != "workflow:task:3:delegate:9" || !reflect.DeepEqual(effects[0].Recipients, []string{"u3"}) {
		t.Fatalf("unexpected delegated generation: %#v", effects[0])
	}
	if effects[1].ActionableKey != "workflow:tasks:g1" || !reflect.DeepEqual(effects[1].Recipients, []string{"u1", "u2"}) {
		t.Fatalf("unexpected node generation: %#v", effects[1])
	}
}

func TestLifecycleForTaskClosesOnlyCurrentParallelApprover(t *testing.T) {
	task := map[string]any{
		"actionable_key":     "workflow:tasks:parallel",
		"actionable_version": "flow_tasks:parallel",
	}
	effect := lifecycleForTask(task, "flow_actions:11", "resolved", "u2")
	if !reflect.DeepEqual(effect.Recipients, []string{"u2"}) || effect.State != "resolved" {
		t.Fatalf("unexpected current approver lifecycle: %#v", effect)
	}
}

func TestActionablePrerequisitesKeepOnlyNewPendingProjectionNotifications(t *testing.T) {
	base := WorkflowNotification{EventType: "workflow.instance.approved"}
	created := WorkflowNotification{EventType: "workflow.task.created"}
	returned := WorkflowNotification{EventType: "workflow.instance.rejected", Metadata: map[string]any{"rejectStrategy": "to_previous"}}
	rejected := WorkflowNotification{EventType: "workflow.instance.rejected", Metadata: map[string]any{"rejectStrategy": "to_initiator"}}
	result := actionablePrerequisiteNotifications([]WorkflowNotification{base, created, returned, rejected})
	if !reflect.DeepEqual(result, []WorkflowNotification{created, returned}) {
		t.Fatalf("unexpected prerequisite notification set: %#v", result)
	}
}
