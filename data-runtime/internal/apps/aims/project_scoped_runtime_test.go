package aims

import "testing"

func TestProjectScopedGenericCollection(t *testing.T) {
	projectID, collection, ok := projectScopedGenericCollection("/v1/aims/projects/42/work-items")
	if !ok || projectID != "42" || collection != "work-items" {
		t.Fatalf("unexpected match projectID=%q collection=%q ok=%v", projectID, collection, ok)
	}

	_, _, ok = projectScopedGenericCollection("/v1/aims/projects/42/work-items/7")
	if ok {
		t.Fatal("expected nested item path to be rejected")
	}

	_, _, ok = projectScopedGenericCollection("/v1/aims/projects/42/members")
	if ok {
		t.Fatal("expected members path to use dedicated handler")
	}
}

func TestProjectScopedGenericCollectionSupportsWrite(t *testing.T) {
	if !projectScopedGenericCollectionSupportsWrite("work-items") {
		t.Fatal("expected work-items collection to allow guarded writes")
	}
	if projectScopedGenericCollectionSupportsWrite("gitlab-commits") {
		t.Fatal("expected gitlab-commits collection to remain read-only")
	}
}
