package altoc

import (
	"context"
	"testing"
)

func TestDeliveryAssetStatusSyncRejectsLegacyBodyBeforeDatabaseAccess(t *testing.T) {
	adapter := &Adapter{}
	_, err := adapter.syncCustomerDeliveryAssetStatus(context.Background(), "CDA-1", map[string]any{"current_user_scopes": []any{"altoc:contract:delivery-asset-status:sync"}, "status": "accepted"})
	if err == nil {
		t.Fatal("legacy direct status body must not bypass target receipt")
	}
}
