package aims

import (
	"context"
	"errors"
	"testing"
)

func TestEnterpriseProjectDocumentAccessibleACLAndAncestors(t *testing.T) {
	docs := []map[string]any{
		{"id": int64(1), "isFolder": true},
		{"id": int64(2), "parentId": int64(1), "uuid": "allowed"},
		{"id": int64(3), "uuid": "denied"},
		{"id": int64(4), "uuid": "missing"},
		{"id": int64(5), "documentSource": "repo"},
	}
	seen := []string{}
	check := func(_ context.Context, uuid, ref string, f EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		seen = append(seen, uuid)
		if f.ActorUID != "signed-actor" || ref != "codocs_document" {
			t.Fatal("context lost")
		}
		return map[string]any{"allowed": uuid == "allowed", "readonly": true, "reason": "granted_by_user", "permission": "view", "lifecycleStage": "formal", "confidentialityLevel": "L2"}, nil
	}
	out, err := filterEnterpriseProjectDocuments(context.Background(), docs, false, EnterpriseProjectDocumentAccessFacts{ActorUID: "signed-actor"}, check)
	if err != nil {
		t.Fatal(err)
	}
	items := out["items"].([]map[string]any)
	if len(items) != 2 || out["total"] != 1 {
		t.Fatalf("denied/repo exposed: %v", out)
	}
	if len(seen) != 3 || items[1]["accessReadonly"] != true || items[1]["accessReason"] != "granted_by_user" {
		t.Fatal("policy result lost")
	}
}
func TestEnterpriseProjectDocumentAccessibleDependencyFailureIsNotPartial(t *testing.T) {
	out, err := filterEnterpriseProjectDocuments(context.Background(), []map[string]any{{"id": int64(1), "uuid": "first"}, {"id": int64(2), "uuid": "fail"}}, true, EnterpriseProjectDocumentAccessFacts{}, func(_ context.Context, uuid, _ string, _ EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		if uuid == "fail" {
			return nil, errors.New("dependency unavailable")
		}
		return map[string]any{"allowed": true}, nil
	})
	if err == nil || out != nil {
		t.Fatal("partial list succeeded")
	}
}
func TestEnterpriseProjectDocumentAccessibleRepoUsesMembershipNotCodocs(t *testing.T) {
	calls := 0
	docs := []map[string]any{{"id": int64(1), "isFolder": true}, {"id": int64(2), "documentSource": "repo"}}
	out, err := filterEnterpriseProjectDocuments(context.Background(), docs, true, EnterpriseProjectDocumentAccessFacts{}, func(context.Context, string, string, EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		calls++
		return nil, nil
	})
	if err != nil || calls != 0 || len(out["items"].([]map[string]any)) != 2 || out["total"] != 1 {
		t.Fatal("repo membership changed")
	}
}
