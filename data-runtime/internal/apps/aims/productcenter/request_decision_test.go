package productcenter

import "testing"

func TestRequestDecisionTransitionMatrix(t *testing.T) {
	allowed := map[string]map[string]bool{
		"submitted": {"evaluating": true}, "evaluating": {"accepted": true, "deferred": true, "rejected": true},
		"deferred": {"evaluating": true}, "accepted": {"evaluating": true, "rejected": true},
	}
	for _, from := range []string{"submitted", "evaluating", "accepted", "deferred", "rejected", "merged"} {
		for _, to := range []string{"submitted", "evaluating", "accepted", "deferred", "rejected", "merged"} {
			err := ValidateRequestTransition(from, RequestDecision{Status: to, Reason: "评审原因", ImpactNote: "保留原执行，另行协调"})
			if (err == nil) != allowed[from][to] {
				t.Fatalf("%s -> %s: %v", from, to, err)
			}
		}
	}
	if err := ValidateRequestTransition("submitted", RequestDecision{Status: "evaluating"}); err != nil {
		t.Fatal(err)
	}
	requireProductRule(t, ValidateRequestTransition("evaluating", RequestDecision{Status: "accepted"}), "product_request_reason_invalid")
	requireProductRule(t, ValidateRequestTransition("accepted", RequestDecision{Status: "rejected", Reason: "重新评估"}), "product_request_impact_required")
}
