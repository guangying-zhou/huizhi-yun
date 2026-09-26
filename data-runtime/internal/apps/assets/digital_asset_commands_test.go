package assets

import (
	"strings"
	"testing"
)

func TestDigitalAssetPayloadUsesCharacterLimitsForVarcharAndBytesForText(t *testing.T) {
	if _, err := DigitalAssetPayload(map[string]any{"digital_name": strings.Repeat("中", 255)}); err != nil {
		t.Fatal(err)
	}
	if _, err := DigitalAssetPayload(map[string]any{"digital_name": strings.Repeat("中", 256)}); err == nil {
		t.Fatal("accepted overlong varchar")
	}
	if _, err := DigitalAssetPayload(map[string]any{"notes": strings.Repeat("中", 21845)}); err != nil {
		t.Fatal(err)
	}
	if _, err := DigitalAssetPayload(map[string]any{"notes": strings.Repeat("中", 21846)}); err == nil {
		t.Fatal("accepted overlong text bytes")
	}
}

func TestDigitalAssetPayloadRetainsExplicitNullAndRejectsUnknownFields(t *testing.T) {
	payload, err := DigitalAssetPayload(map[string]any{"notes": nil, "storage_location": nil})
	if err != nil || payload["notes"] != nil || payload["storage_location"] != nil {
		t.Fatalf("explicit nullable clears must survive payload validation: %#v %v", payload, err)
	}
	if _, err := DigitalAssetPayload(map[string]any{"unexpected": "value"}); err == nil {
		t.Fatal("unknown field accepted")
	}
}
