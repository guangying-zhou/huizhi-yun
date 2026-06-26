package aims

import "testing"

func TestProjectNestedRestAllowsNestedSegments(t *testing.T) {
	projectID, rest, ok := projectNestedRest("/v1/aims/projects/42/releases/7/features/9", "/v1/aims/projects/", "/releases/")
	if !ok {
		t.Fatal("expected nested release route to match")
	}
	if projectID != "42" || rest != "7/features/9" {
		t.Fatalf("unexpected match: projectID=%q rest=%q", projectID, rest)
	}
}

func TestProjectNestedRestRejectsNestedProjectID(t *testing.T) {
	_, _, ok := projectNestedRest("/v1/aims/projects/42/extra/releases/7", "/v1/aims/projects/", "/releases/")
	if ok {
		t.Fatal("expected route with nested project id to be rejected")
	}
}
