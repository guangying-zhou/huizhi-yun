package altoc

import (
	"context"
	"testing"
)

func TestFinanceSummarySyncRejectsLegacyUnreceiptedBodyBeforeDatabaseAccess(t *testing.T) {
	adapter := &Adapter{}
	_, err := adapter.syncContractFinanceSummary(context.Background(), "CTR-1", map[string]any{
		"current_user_scopes": []any{"altoc:contract:finance-summary:sync"},
		"contractSummary":     map[string]any{"contractCode": "CTR-1"},
	})
	if err == nil {
		t.Fatal("legacy direct summary body must not bypass service-command receipt")
	}
}
