package aims

import (
	"context"
	"testing"
)

func TestEnterpriseQualityRejectsBrowserFacts(t *testing.T) {
	for _, action := range []string{"submission-create", "submission-activate", "completeness", "waiver"} {
		for _, key := range []string{"current_user", "projectId", "current_user_is_qa", "current_user_can_waive_quality_reviews", "checklistResults"} {
			if ValidateEnterpriseQualityPayload(action, map[string]any{key: true}) == nil {
				t.Fatalf("%s accepted %s", action, key)
			}
		}
	}
	if ValidateEnterpriseQualityPayload("completeness", map[string]any{"action": "approve"}) == nil {
		t.Fatal("approve accepted as completeness")
	}
}
func TestEnterpriseQualityNeedsScopedPermitBeforeTransaction(t *testing.T) {
	a := &Adapter{}
	_, err := a.WriteEnterpriseDeliverableQuality(context.Background(), EnterpriseProjectUpdateIdentity{}, "1", "2", "waiver", map[string]any{"reason": "test"}, EnterpriseQualityFacts{})
	if err == nil {
		t.Fatal("missing permit accepted")
	}
}
