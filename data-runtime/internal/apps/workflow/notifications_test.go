package workflow

import (
	"context"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestTaskNotificationIdentityUsesInsertedTaskIDs(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO flow_tasks").
		WithArgs(int64(9), 0, "A", "u1", "approve").
		WillReturnResult(sqlmock.NewResult(101, 1))
	mock.ExpectExec("INSERT INTO flow_tasks").
		WithArgs(int64(9), 0, "A", "u2", "approve").
		WillReturnResult(sqlmock.NewResult(102, 1))
	mock.ExpectExec("UPDATE flow_tasks SET generation_key").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), int64(101)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE flow_tasks SET generation_key").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), int64(102)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO flow_tasks").
		WithArgs(int64(9), 1, "B", "u3", "approve").
		WillReturnResult(sqlmock.NewResult(201, 1))
	mock.ExpectExec("UPDATE flow_tasks SET generation_key").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), int64(201)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO flow_tasks").
		WithArgs(int64(9), 0, "A", "u1", "approve").
		WillReturnResult(sqlmock.NewResult(301, 1))
	mock.ExpectExec("UPDATE flow_tasks SET generation_key").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), int64(301)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectRollback()

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	nodeA := map[string]any{
		"name": "A", "type": "approve",
		"resolved_assignees": []resolvedAssignee{{UID: "u1"}, {UID: "u2"}},
	}
	target := workflowNotificationTarget{AppCode: "aims", ResourceCode: "requirements", BizID: "REQ-9", InstanceID: 9}
	initialNotifications, status, nodeIndex, err := createInitialTasks(
		context.Background(), tx, target, 0, []map[string]any{nodeA},
		map[string]any{"initiator_name": "starter"}, "starter", "business", "/same", 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if status != "running" || nodeIndex != 0 || len(initialNotifications) != 1 {
		t.Fatalf("unexpected initial task result: status=%s node=%d notifications=%d", status, nodeIndex, len(initialNotifications))
	}
	nextIDs, err := createTasksForNode(context.Background(), tx, 9, 1, map[string]any{
		"name": "B", "type": "approve", "resolved_assignees": []resolvedAssignee{{UID: "u3"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	reentryIDs, err := createTasksForNode(context.Background(), tx, 9, 0, map[string]any{
		"name": "A", "type": "approve", "resolved_assignees": []resolvedAssignee{{UID: "u1"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	initial := initialNotifications[0]
	next := newWorkflowNotification([]string{"u3"}, "待办", "next", "/same", "workflow.task.created", taskEventVersion(nextIDs), "info", target, map[string]any{"taskIds": nextIDs})
	reentry := newWorkflowNotification([]string{"u1"}, "待办", "reentry", "/same", "workflow.task.created", taskEventVersion(reentryIDs), "info", target, map[string]any{"taskIds": reentryIDs})

	if initial.EventVersion != taskEventVersion([]int64{102, 101}) {
		t.Fatalf("unexpected initial event version: %s", initial.EventVersion)
	}
	if len(initial.IdempotencyKey) > 191 {
		t.Fatalf("notification idempotency key exceeds runtime boundary: %d", len(initial.IdempotencyKey))
	}
	if initial.IdempotencyKey == next.IdempotencyKey || initial.IdempotencyKey == reentry.IdempotencyKey || next.IdempotencyKey == reentry.IdempotencyKey {
		t.Fatal("initial, next-node, and same-node re-entry events must have distinct keys")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestActionNotificationIdentityIsStableAndComplete(t *testing.T) {
	tests := []struct {
		name      string
		eventType string
		severity  string
		actionID  int64
	}{
		{name: "reject", eventType: "workflow.instance.rejected", severity: "warning", actionID: 501},
		{name: "delegate", eventType: "workflow.task.delegated", severity: "info", actionID: 502},
		{name: "cancel", eventType: "workflow.instance.withdrawn", severity: "warning", actionID: 503},
		{name: "resubmit", eventType: "workflow.instance.resubmitted", severity: "info", actionID: 504},
		{name: "approved", eventType: "workflow.instance.approved", severity: "success", actionID: 505},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			version := actionEventVersion(test.actionID)
			target := workflowNotificationTarget{AppCode: "aims", ResourceCode: "requirements", BizID: "REQ-9", InstanceID: 9}
			first := newWorkflowNotification([]string{"u1"}, "same title", "same description", "/same", test.eventType, version, test.severity, target, map[string]any{"actionId": test.actionID})
			retry := newWorkflowNotification([]string{"different-recipient"}, "changed title", "changed description", "/changed", test.eventType, version, test.severity, target, map[string]any{"actionId": test.actionID})
			if first.IdempotencyKey != retry.IdempotencyKey {
				t.Fatal("the same committed action must keep the same key across delivery retries")
			}
			if first.EventType == "" || first.EventVersion == "" || first.Category == "" || first.Severity == "" || first.BizType == "" || first.BizID == nil || first.IdempotencyKey == "" || first.Metadata == nil {
				t.Fatalf("incomplete notification contract: %#v", first)
			}
			if first.Metadata["sourceApp"] != "workflow" {
				t.Fatalf("unexpected source app: %#v", first.Metadata["sourceApp"])
			}
		})
	}
}

func TestActionableNotificationCarriesBusinessTargetAndSafeFallback(t *testing.T) {
	target := workflowNotificationTarget{AppCode: "finance", ResourceCode: "payment_requests", BizID: "PAY-42", InstanceID: 88}
	task := newWorkflowNotification(
		[]string{"approver"}, "待办", "请审批", "", "workflow.task.created", taskEventVersion([]int64{701}), "info", target,
		map[string]any{"taskIds": []int64{701}},
	)
	if task.URL != "/workflow/tasks/701" || task.BizType != "payment_requests" || task.BizID != "PAY-42" {
		t.Fatalf("task notification=%+v", task)
	}
	if task.Metadata["targetAppCode"] != "finance" || task.Metadata["businessTargetAppCode"] != "finance" || task.Metadata["actionTargetAppCode"] != "workflow" || task.Metadata["bizKey"] != "finance:payment_requests:PAY-42" || task.Metadata["workflowInstanceId"] != int64(88) || task.Metadata["urlFallback"] != true {
		t.Fatalf("task metadata=%+v", task.Metadata)
	}
	if fmt.Sprint(task.Metadata["workflowTaskIds"]) != "[701]" {
		t.Fatalf("task identity=%+v", task.Metadata["workflowTaskIds"])
	}

	result := newWorkflowNotification(
		[]string{"initiator"}, "已撤回", "流程已撤回", "javascript:alert(1)", "workflow.instance.withdrawn", actionEventVersion(801), "warning", target,
		map[string]any{"actionId": int64(801)},
	)
	if result.URL != "/workflow/instances/88" || result.Metadata["actionableKey"] != "workflow:instance:88" {
		t.Fatalf("result notification=%+v", result)
	}
}

func TestDelegateNotificationKeepsExplicitGenerationKey(t *testing.T) {
	target := workflowNotificationTarget{AppCode: "finance", ResourceCode: "payments", BizID: "PAY-1", InstanceID: 9}
	notification := newWorkflowNotification(
		[]string{"u2"}, "委托", "请审批", "/workflow/tasks/7", "workflow.task.delegated", actionEventVersion(11), "info", target,
		map[string]any{"taskId": int64(7), "actionableKey": "workflow:task:7:delegate:11"},
	)
	if notification.Metadata["actionableKey"] != "workflow:task:7:delegate:11" {
		t.Fatalf("explicit delegate generation key was overwritten: %#v", notification.Metadata)
	}
}
