package openingproof_test

import (
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool"
	"github.com/huizhi-yun/data-runtime/internal/openingproof"
	"testing"
)

func TestOpeningWireProofMatchesReviewedOfflineTool(t *testing.T) {
	p := wizbiztool.OpeningPlan{Version: "wizbiz-opening-plan.v1", BatchCode: "MARKED", Rows: []wizbiztool.OpeningRow{{SourcePK: "1", ContractCode: "CT-W000001", Code: "BS-W000001", Amount: "100.00"}}, Total: "100.00", Baseline: map[string][]wizbiztool.BaselineRow{"altoc_contract": {{Key: "<&中文", SHA256: "marked"}}}, Audit: &wizbiztool.FollowupAudit{Version: "v1", Verified: true, Proofs: []wizbiztool.FollowupAuditProof{{Table: "altoc_contract", FormalReceipt: true}}, DifferenceClasses: []wizbiztool.AuditDifferenceClass{{Table: "altoc_contract", Check: "test"}}}}
	p.ReviewHash = wizbiztool.OpeningPlanHash(p)
	raw, _ := json.Marshal(p)
	var decoded openingproof.OpeningPlan
	if e := json.Unmarshal(raw, &decoded); e != nil {
		t.Fatal(e)
	}
	if e := openingproof.ReviewOpeningPlan(decoded, p.ReviewHash); e != nil {
		t.Fatal(e)
	}
	decoded.Rows[0].Amount = "101.00"
	if openingproof.ReviewOpeningPlan(decoded, p.ReviewHash) == nil {
		t.Fatal("changed plan")
	}
	for _, v := range []string{"<&中文", "\u2028", `literal\u2028`, "\\\""} {
		row := map[string]any{"key": v, "null": nil}
		a, e := wizbiztool.CanonicalRow(row)
		if e != nil {
			t.Fatal(e)
		}
		b, e := openingproof.CanonicalRow(row)
		if e != nil || string(a) != string(b) {
			t.Fatalf("canonical drift: %s / %s %v", a, b, e)
		}
	}
}
