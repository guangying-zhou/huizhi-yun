package aims

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func completionSchemaContractCommand(matter bool) map[string]any {
	hash := strings.Repeat("a", 64)
	key := "aims:work-item-completion:1:workflow-submit:v1"
	form := map[string]any{"completionRequestId": float64(1), "workItemId": float64(2), "projectId": float64(3), "snapshotSha256": hash}
	command := map[string]any{"completionRequestId": float64(1), "workItemId": float64(2), "projectId": float64(3), "workItemKey": "WI-2", "actorUid": "U1", "snapshotSha256": hash, "bizTitle": "Complete work item", "idempotencyKey": key, "bizContext": map[string]any{"project_id": float64(3)}, "formData": form}
	if matter {
		command["kind"] = "matter"
		command["idempotencyKey"] = "aims:work-item-completion:matter:1:workflow-submit:v2"
		form["kind"] = "matter"
		form["evidenceSummary"] = map[string]any{"deliverableCount": float64(0), "requiredDeliverableCount": float64(0), "commitCount": float64(0), "timeEntryCount": float64(1)}
	}
	return command
}

func TestCompletionSchemaContractRuntimeSucceedAndFailUseFrozenLeaseSchema(t *testing.T) {
	for _, tc := range []struct {
		phase  string
		matter bool
		schema string
		accept bool
	}{
		{"succeed", false, "v1", true}, {"succeed", true, "v2", true},
		{"fail", false, "v1", true}, {"fail", true, "v2", true},
		{"succeed", false, "v2", false}, {"succeed", true, "v1", false},
		{"fail", false, "v2", false}, {"fail", true, "v1", false},
	} {
		t.Run(tc.phase+"/"+tc.schema+"/"+map[bool]string{true: "matter", false: "target"}[tc.matter], func(t *testing.T) {
			adapter, mock, closeDB := newAimsSQLMockAdapter(t)
			defer closeDB()
			command := completionSchemaContractCommand(tc.matter)
			key := command["idempotencyKey"].(string)
			raw, err := json.Marshal(command)
			if err != nil {
				t.Fatal(err)
			}
			body := trustedAimsIntegrationOperationBody()
			body["operationId"] = testAimsIntegrationOperationID
			body["fencingToken"] = int64(8)
			body["httpStatus"] = http.StatusOK
			if tc.phase == "fail" {
				body["httpStatus"] = http.StatusServiceUnavailable
				body["errorCode"] = "downstream_unavailable"
				body["errorSummary"] = "safe downstream failure"
			} else {
				hash, err := integrationoperation.ValidateAndDigestCommand(command)
				if err != nil {
					t.Fatal(err)
				}
				body["targetReceiptId"] = "660e8400-e29b-41d4-a716-446655440010"
				body["receiptOperationId"] = testAimsIntegrationOperationID
				body["receiptOperationCode"] = workItemCompletionWorkflowOperation
				body["receiptIdempotencyKey"] = key
				body["receiptCommandSchemaVersion"] = tc.schema
				body["receiptCommandSha256"] = hash
				body["targetBizType"] = "work_item_completion_workflow"
				body["targetBizCode"] = "completion-request:1"
				body["responseSummarySha256"] = strings.Repeat("b", 64)
			}
			mock.ExpectQuery(`(?s)SELECT target_app, operation_code, command_schema_version, command_json.*FROM integration_operation.*WHERE operation_id = \?.*operation_key = \?.*tenant_code = \?.*deployment_code = \?.*source_app = 'aims'.*status = 'processing'.*locked_by = \?.*fencing_token = \?.*LIMIT 1`).
				WithArgs(testAimsIntegrationOperationID, key, "TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", testAimsIntegrationWorker, int64(8)).
				WillReturnRows(sqlmock.NewRows([]string{"target_app", "operation_code", "command_schema_version", "command_json"}).AddRow("workflow", workItemCompletionWorkflowOperation, tc.schema, string(raw)))
			marker := errors.New("reached record transaction")
			if tc.accept {
				mock.ExpectBegin().WillReturnError(marker)
			}
			_, _, err = adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/aims/integration-operations/"+key+":"+tc.phase, url.Values{}, body)
			if tc.accept {
				if !errors.Is(err, marker) {
					t.Fatalf("matching frozen schema did not reach record transaction: %v", err)
				}
			} else if failure, ok := err.(httperror.Error); !ok || failure.Code != "integration_operation_schema_mismatch" {
				t.Fatalf("mismatched frozen schema not rejected: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCompletionSchemaContractRuntimeLeaseAcceptsOnlyTargetV1AndMatterV2(t *testing.T) {
	for _, tc := range []struct {
		name   string
		kind   string
		schema string
		accept bool
	}{
		{"target-v1", "target", "v1", true},
		{"matter-v2", "matter", "v2", true},
		{"target-v2", "target", "v2", false},
		{"matter-v1", "matter", "v1", false},
		{"target-v3", "target", "v3", false},
		{"matter-v3", "matter", "v3", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			command := completionSchemaContractCommand(tc.kind == "matter")
			if accepted := validateServiceTicketDeliveryOperation("workflow", workItemCompletionWorkflowOperation, tc.schema, command) == nil; accepted != tc.accept {
				t.Fatalf("accepted=%v, want %v", accepted, tc.accept)
			}
		})
	}
	bad := completionSchemaContractCommand(true)
	bad["formData"].(map[string]any)["kind"] = "target"
	if validateServiceTicketDeliveryOperation("workflow", workItemCompletionWorkflowOperation, "v2", bad) == nil {
		t.Fatal("mixed matter command accepted")
	}
}
