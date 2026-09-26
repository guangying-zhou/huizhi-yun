package enterprisescheduler

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var recoverySHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type ManualRecoveryRecord struct {
	OperationID    string
	OperationCode  string
	IdempotencyKey string
	Reason         string
}

type ManualRecoveryRequiredError struct{ Record ManualRecoveryRecord }

func (e *ManualRecoveryRequiredError) Error() string {
	return "integration operation requires manual recovery: " + e.Record.Reason
}

// RecoverableProvider exposes the target-side receipt lookup required before a
// worker repeats a delivery whose outcome is uncertain.
type RecoverableProvider interface {
	LookupReceipt(context.Context, integrationoperation.ReceiptEvidence) (*integrationoperation.ReceiptEvidence, error)
	Deliver(context.Context, integrationoperation.ReceiptEvidence, []byte) (integrationoperation.ReceiptEvidence, error)
}

// DeliverOrRecover first asks the target for a receipt under the frozen command
// identity. Only an absent receipt permits a new provider side effect.
func DeliverOrRecover(ctx context.Context, provider RecoverableProvider, expected integrationoperation.ReceiptEvidence, command []byte) (integrationoperation.ReceiptEvidence, bool, error) {
	if provider == nil {
		return integrationoperation.ReceiptEvidence{}, false, fmt.Errorf("recoverable provider is required")
	}
	if strings.TrimSpace(expected.OperationID) == "" || strings.TrimSpace(expected.OperationCode) == "" ||
		strings.TrimSpace(expected.IdempotencyKey) == "" || expected.CommandSchemaVersion != "v1" ||
		!recoverySHA256Pattern.MatchString(expected.CommandSHA256) || strings.TrimSpace(expected.TargetBizType) == "" ||
		strings.TrimSpace(expected.TargetBizCode) == "" || !recoverySHA256Pattern.MatchString(expected.ResponseSummarySHA256) {
		return integrationoperation.ReceiptEvidence{}, false, &ManualRecoveryRequiredError{Record: ManualRecoveryRecord{
			OperationID: expected.OperationID, OperationCode: expected.OperationCode,
			IdempotencyKey: expected.IdempotencyKey, Reason: "unrecognized frozen command identity",
		}}
	}
	receipt, err := provider.LookupReceipt(ctx, expected)
	if err != nil {
		return integrationoperation.ReceiptEvidence{}, false, err
	}
	if receipt != nil {
		if err := integrationoperation.ValidateReceiptEvidence(expected, *receipt); err != nil {
			return integrationoperation.ReceiptEvidence{}, false, err
		}
		return *receipt, true, nil
	}
	received, err := provider.Deliver(ctx, expected, command)
	if err != nil {
		return integrationoperation.ReceiptEvidence{}, false, err
	}
	if err := integrationoperation.ValidateReceiptEvidence(expected, received); err != nil {
		return integrationoperation.ReceiptEvidence{}, false, err
	}
	return received, false, nil
}
