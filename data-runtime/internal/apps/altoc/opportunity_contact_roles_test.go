package altoc

import "testing"

func TestOpportunityContactRoleUpdatesNormalizesFields(t *testing.T) {
	updates := opportunityContactRoleUpdates(map[string]any{
		"role":           "decision_maker",
		"influenceLevel": "high",
		"attitude":       "supportive",
		"isPrimary":      "true",
		"remark":         " ",
	})

	if updates["role"] != "decision_maker" {
		t.Fatalf("role = %#v, want decision_maker", updates["role"])
	}
	if updates["influence_level"] != "high" {
		t.Fatalf("influence_level = %#v, want high", updates["influence_level"])
	}
	if updates["attitude"] != "supportive" {
		t.Fatalf("attitude = %#v, want supportive", updates["attitude"])
	}
	if updates["is_primary"] != true {
		t.Fatalf("is_primary = %#v, want true", updates["is_primary"])
	}
	if value, ok := updates["remark"]; !ok || value != nil {
		t.Fatalf("remark = %#v, want nil", updates["remark"])
	}
}

func TestOpportunityContactRoleUpdatesIgnoresUnknownFields(t *testing.T) {
	updates := opportunityContactRoleUpdates(map[string]any{
		"contact_id": 123,
		"role":       "sponsor",
	})

	if len(updates) != 1 {
		t.Fatalf("updates = %#v, want only role", updates)
	}
	if updates["role"] != "sponsor" {
		t.Fatalf("role = %#v, want sponsor", updates["role"])
	}
}
