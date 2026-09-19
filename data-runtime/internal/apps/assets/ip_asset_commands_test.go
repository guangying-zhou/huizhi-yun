package assets

import "testing"

func TestIPAssetPayloadRetainsNullableClearsAndRejectsRequiredOrInvalidDates(t *testing.T) {
	payload, err := IPAssetPayload(map[string]any{"registration_no": nil, "ip_name": "名称", "apply_date": "2026-09-15"})
	if err != nil || payload["registration_no"] != nil {
		t.Fatalf("nullable clear lost: %#v %v", payload, err)
	}
	for _, body := range []map[string]any{{"ip_name": nil}, {"ip_type": ""}, {"status": ""}, {"apply_date": "2026-99-99"}} {
		if _, err := IPAssetPayload(body); err == nil {
			t.Fatalf("invalid IP payload accepted: %#v", body)
		}
	}
}
