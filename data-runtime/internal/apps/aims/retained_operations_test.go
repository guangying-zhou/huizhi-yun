package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestHostWorkerStopsDiscardedManualProducersBeforeDatabase(t *testing.T) {
	a := &Adapter{}
	a.ConfigureRetainedAimsOperations(true)
	_, _, handled, err := a.handleProductCostFreezeRuntime(context.Background(), "POST", "/v1/aims/internal/product-cost-rules:freeze", url.Values{}, nil)
	var rejected httperror.Error
	if !handled || !errors.As(err, &rejected) || rejected.Code != "aims_operation_retired" {
		t.Fatalf("cost freeze: %v", err)
	}
	_, err = a.freezePeopleContributionSnapshot(context.Background(), "1", url.Values{}, nil)
	if !errors.As(err, &rejected) || rejected.Code != "aims_operation_retired" {
		t.Fatalf("contribution: %v", err)
	}
	result, err := a.enqueueMilestoneReceivableBillableOperationTx(context.Background(), nil, 1, sql.NullInt64{Valid: true, Int64: 1}, sql.NullString{}, sql.NullString{}, nil)
	if err != nil || result["retired"] != true {
		t.Fatalf("receivable: %v %v", result, err)
	}
}
