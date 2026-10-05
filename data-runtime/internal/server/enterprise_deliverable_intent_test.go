package server

import "testing"

func TestEnterpriseDeliverableIntentKey(t *testing.T) {
	for _, key := range []string{"8b4891f3-137d-4b7a-a45b-3c3fbf0e09d8", "deliverable:update:17"} {
		if !enterpriseDeliverableIntentKey.MatchString(key) {
			t.Fatalf("valid key %q rejected", key)
		}
	}
	for _, key := range []string{"", " has-space", "has space", "含中文", "a\nsecond"} {
		if enterpriseDeliverableIntentKey.MatchString(key) {
			t.Fatalf("invalid key %q accepted", key)
		}
	}
}
