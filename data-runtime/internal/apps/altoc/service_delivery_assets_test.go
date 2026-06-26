package altoc

import (
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestFormalDeliveryAssetCodeForStatusSyncRejectsPlanCodes(t *testing.T) {
	_, err := formalDeliveryAssetCodeForStatusSync("DAP-1", map[string]any{
		"deliveryAssetCode": "CDAP-CL-1",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_delivery_asset_code" {
		t.Fatalf("error = %#v, want 400 invalid_delivery_asset_code", err)
	}
}

func TestFormalDeliveryAssetCodeForStatusSyncDoesNotReusePlanPathAsFormalCode(t *testing.T) {
	code, err := formalDeliveryAssetCodeForStatusSync("DAP-1", map[string]any{
		"sourcePlanCode": "DAP-1",
	})
	if err != nil {
		t.Fatalf("formalDeliveryAssetCodeForStatusSync: %v", err)
	}
	if code != "" {
		t.Fatalf("code = %q, want empty formal code when only a plan code is present", code)
	}
}

func TestFormalDeliveryAssetCodeForStatusSyncUsesFormalPathCode(t *testing.T) {
	code, err := formalDeliveryAssetCodeForStatusSync("CDA-1", map[string]any{})
	if err != nil {
		t.Fatalf("formalDeliveryAssetCodeForStatusSync: %v", err)
	}
	if code != "CDA-1" {
		t.Fatalf("code = %q, want formal path code", code)
	}
}
