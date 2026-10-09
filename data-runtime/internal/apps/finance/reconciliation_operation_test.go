package finance

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type financeCommandMatcher struct{}

func (financeCommandMatcher) Match(value driver.Value) bool {
	raw, ok := value.(string)
	if !ok {
		return false
	}
	var command map[string]any
	if json.Unmarshal([]byte(raw), &command) != nil {
		return false
	}
	return command["contractCode"] == "CTR-TRUSTED" && command["reconciliationCode"] == "REC-1" && command["receivablePlanCode"] == "RP-1"
}

func TestEnqueueAltocFinanceSummaryUsesTrustedRuntimeResultInReconciliationTransaction(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database}
	mock.ExpectBegin()
	tx, err := database.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	body := jsonBody{
		"contractCode": "CTR-FORGED",
		integrationoperation.TrustedTenantCodeKey:      "tenant-1",
		integrationoperation.TrustedDeploymentCodeKey:  "deployment-1",
		integrationoperation.TrustedSourceAppKey:       "finance",
		integrationoperation.TrustedServiceClientIDKey: "finance.runtime",
		integrationoperation.TrustedRequestIDKey:       "request-1",
	}
	reconciliation := map[string]any{
		"code": "REC-1", "contract_code": "CTR-TRUSTED", "receivable_plan_code": "RP-1",
		"contractSummary":       map[string]any{"contractCode": "CTR-TRUSTED", "reconciledAmount": "10.00"},
		"receivablePlanSummary": map[string]any{"receivablePlanCode": "RP-1", "receivedAmount": "10.00"},
	}
	mock.ExpectExec(regexp.QuoteMeta("INSERT IGNORE INTO integration_operation")).WithArgs(
		sqlmock.AnyArg(), "finance:reconciliation:REC-1:altoc-summary:v1", "finance:reconciliation:REC-1:altoc-summary:v1",
		"tenant-1", "deployment-1", financeAltocSummaryOperationCode, financeAltocSummaryCapability,
		"REC-1", "finance:reconciliation:REC-1:altoc-summary:v1", financeCommandMatcher{}, sqlmock.AnyArg(),
		"request-1", nil, "finance.runtime", "finance.runtime", "finance.runtime",
	).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT operation_id,command_sha256,status FROM integration_operation`).WithArgs("tenant-1", "deployment-1", "finance:reconciliation:REC-1:altoc-summary:v1").WillReturnRows(
		sqlmock.NewRows([]string{"operation_id", "command_sha256", "status"}).AddRow("8c834dac-5c95-4c3f-a8d8-99dc12c0e881", commandDigest(t, reconciliation), "pending"),
	)
	result, err := adapter.enqueueAltocFinanceSummaryOperationTx(context.Background(), tx, reconciliation, "CTR-TRUSTED", "RP-1", body)
	if err != nil {
		t.Fatal(err)
	}
	if result["operationKey"] != "finance:reconciliation:REC-1:altoc-summary:v1" {
		t.Fatalf("unexpected result: %#v", result)
	}
	mock.ExpectRollback()
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func commandDigest(t *testing.T, reconciliation map[string]any) string {
	t.Helper()
	command := map[string]any{
		"contractCode": "CTR-TRUSTED", "reconciliationCode": "REC-1", "receivablePlanCode": "RP-1",
		"contractSummary": reconciliation["contractSummary"], "receivablePlanSummary": reconciliation["receivablePlanSummary"],
	}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(digest)
}
