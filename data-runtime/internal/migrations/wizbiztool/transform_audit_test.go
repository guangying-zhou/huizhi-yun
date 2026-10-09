package wizbiztool

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestContactStarLevelGolden(t *testing.T) {
	for _, c := range []struct{ source, target any }{{nil, nil}, {"0", nil}, {"1", "1"}, {"2", "2"}, {"3", "3"}, {"4", "4"}, {"5", "5"}, {"6", "6"}} {
		got, e := contactStarLevel(c.source)
		if e != nil || !reflect.DeepEqual(got, c.target) {
			t.Fatalf("rating golden mismatch: %v", c.source)
		}
	}
	for _, invalid := range []any{"-1", "7", "99", "00", "01", "1.0", "", 0, 1, map[string]any{"x": "0"}} {
		if _, e := contactStarLevel(invalid); e == nil {
			t.Fatal("invalid rating accepted")
		}
	}
	// Source canonical bytes distinguish old 0 from NULL even though target is NULL.
	zero, e := CanonicalRow(map[string]any{"stars": "0"})
	if e != nil {
		t.Fatal(e)
	}
	absent, e := CanonicalRow(map[string]any{"stars": nil})
	if e != nil || Digest(zero) == Digest(absent) {
		t.Fatal("source unrated evidence collapsed")
	}
	if Digest(zero) != "003d6be786acb74dbcd3dc2613f901a810287e9226c6fa621b506d3717dfdb74" || string(zero) != `{"stars":"0"}` {
		t.Fatalf("source golden encoding changed: %s", zero)
	}
}
func TestTransformAuditOnlyFixedCounts(t *testing.T) {
	sentinel := "PERSONAL-SOURCE-VALUE-MUST-NOT-LEAK"
	data := SourceData{"wb_organization": {{"org_id": "1", "org_type": "99", "org_status": "99", "org_name": sentinel, "parent_id": "1"}}, "wb_contactman": {{"contactman_id": "1", "org_id": "1", "cm_name": sentinel, "stars": "7", "chief": "99"}}}
	audit := AuditTransformValues(data, Profile{VaultWrite: "synthetic"})
	if audit.Ready || len(audit.Blockers) < 4 {
		t.Fatal("did not aggregate")
	}
	raw, _ := json.Marshal(audit)
	if strings.Contains(string(raw), sentinel) || strings.Contains(string(raw), "sourcePk") {
		t.Fatal("source data leaked")
	}
	changed := SourceData{}
	for k, v := range data {
		changed[k] = v
	}
	a := AuditTransformValues(changed, Profile{VaultWrite: "synthetic"})
	if !reflect.DeepEqual(a, audit) {
		t.Fatal("audit ordering nondeterministic")
	}
}
