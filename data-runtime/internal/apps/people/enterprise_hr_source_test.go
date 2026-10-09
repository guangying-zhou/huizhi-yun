package people

import (
	"encoding/json"
	"testing"
)

func TestHRSourceClosedCommands(t *testing.T) {
	for kind := range HRSourceContracts {
		for _, phase := range []string{"prepare", "confirm"} {
			if _, _, ok := FactsPermission("hr-" + kind + "-" + phase); !ok {
				t.Fatal(kind)
			}
		}
	}
	if _, _, ok := FactsPermission("hr-anything-prepare"); ok {
		t.Fatal("open operation")
	}
	for _, raw := range []map[string]any{{"actorUid": "forged"}, {"objectScopes": []any{"all"}}, {"sourceApp": "people"}} {
		if _, e := NormalizeHRSourceCommand("jobs-start", raw); e == nil {
			t.Fatal("untrusted source")
		}
	}
	for _, n := range []any{float64(-1), 1.5, json.Number("-1"), json.Number("1x"), float64(1e20)} {
		if _, e := NormalizeHRSourceCommand("changes", map[string]any{"snapshotRunId": n, "snapshotHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "departmentCodes": []any{"A"}}); e == nil {
			t.Fatal("bad revision", n)
		}
	}
	raw := map[string]any{"mappings": []any{map[string]any{"externalDepartmentId": "123", "canonicalDeptCode": "A"}}}
	if _, e := NormalizeHRSourceCommand("mappings", raw); e != nil {
		t.Fatal(e)
	}
	raw["mappings"] = []any{map[string]any{"externalDepartmentId": "123", "canonicalDeptCode": "A", "actorUid": "fake"}}
	if _, e := NormalizeHRSourceCommand("mappings", raw); e == nil {
		t.Fatal("extra field")
	}
	i := EnterpriseFactsInput{ID: "dingtalk", Payload: map[string]any{"expectedVersion": float64(1), "command": map[string]any{}, "sourceReady": true}}
	if e := ValidateFactsInput("hr-jobs-start-prepare", i); e != nil {
		t.Fatal(e)
	}
	i.SensitiveAllowed = true
	if e := ValidateFactsInput("hr-jobs-start-prepare", i); e == nil {
		t.Fatal("extra signed fact")
	}
}
