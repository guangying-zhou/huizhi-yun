package altoc

import (
	"encoding/json"
	"testing"
)

func feedbackProgressFixture() map[string]any {
	return map[string]any{
		"ticketCode": "ST-1", "productCode": "P1", "requestBizId": "00000000-0000-4000-8000-000000000001", "canonicalRequestBizId": "00000000-0000-4000-8000-000000000002", "decisionStatus": "merged", "canonicalDecisionStatus": "accepted", "sourceRevision": 7,
		"versions": []any{map[string]any{"versionCode": "v1", "status": "released", "plannedReleaseDate": "2026-09-01", "releasedAt": "2026-09-03 10:00:00", "publicFeatureCount": 2, "deliveredFeatureCount": 1}},
	}
}

func TestProductFeedbackProgressContract(t *testing.T) {
	encode := func(v any) []byte {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	valid := feedbackProgressFixture()
	parsed, err := parseProductFeedbackProgress(encode(valid))
	if err != nil || parsed.CanonicalDecisionStatus != "accepted" || parsed.DecisionStatus != "merged" {
		t.Fatalf("%#v %v", parsed, err)
	}
	if _, err := parseProductFeedbackStatus(encode(valid)); err == nil {
		t.Fatal("v1 accepted a progress command")
	}
	for key := range valid {
		t.Run("missing-"+key, func(t *testing.T) {
			v := feedbackProgressFixture()
			delete(v, key)
			if _, err := parseProductFeedbackProgress(encode(v)); err == nil {
				t.Fatal("missing field accepted")
			}
		})
	}
	for _, change := range []struct {
		key   string
		value any
	}{
		{"sourceRevision", 0}, {"sourceRevision", 1.5}, {"sourceRevision", uint64(9007199254740992)}, {"sourceRevision", nil}, {"canonicalDecisionStatus", "merged"}, {"decisionStatus", "accepted"}, {"ticketCode", "ST/1"}, {"versions", nil}, {"privateCustomer", "secret"},
	} {
		v := feedbackProgressFixture()
		v[change.key] = change.value
		if _, err := parseProductFeedbackProgress(encode(v)); err == nil {
			t.Fatalf("accepted %s=%v", change.key, change.value)
		}
	}
	v := feedbackProgressFixture()
	v["versions"] = []any{}
	if _, err := parseProductFeedbackProgress(encode(v)); err != nil {
		t.Fatal(err)
	}
	v["canonicalRequestBizId"] = v["requestBizId"]
	v["decisionStatus"] = "accepted"
	if _, err := parseProductFeedbackProgress(encode(v)); err != nil {
		t.Fatal(err)
	}
	for _, change := range []struct {
		key   string
		value any
	}{
		{"publicFeatureCount", 0}, {"publicFeatureCount", nil}, {"deliveredFeatureCount", 3}, {"deliveredFeatureCount", nil}, {"status", "deployed"}, {"plannedReleaseDate", "2026-02-30"}, {"releasedAt", "2026-09-03"}, {"description", "secret"},
	} {
		v := feedbackProgressFixture()
		row := v["versions"].([]any)[0].(map[string]any)
		row[change.key] = change.value
		if _, err := parseProductFeedbackProgress(encode(v)); err == nil {
			t.Fatalf("accepted version %s=%v", change.key, change.value)
		}
	}
	v = feedbackProgressFixture()
	row := v["versions"].([]any)[0].(map[string]any)
	row["plannedReleaseDate"] = nil
	row["releasedAt"] = nil
	if _, err := parseProductFeedbackProgress(encode(v)); err != nil {
		t.Fatal(err)
	}
	delete(row, "releasedAt")
	if _, err := parseProductFeedbackProgress(encode(v)); err == nil {
		t.Fatal("omitted nullable date accepted")
	}
	v = feedbackProgressFixture()
	rows := v["versions"].([]any)
	v["versions"] = append(rows, rows[0])
	if _, err := parseProductFeedbackProgress(encode(v)); err == nil {
		t.Fatal("duplicate version accepted")
	}
}
