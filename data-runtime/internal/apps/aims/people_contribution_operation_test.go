package aims

import "testing"

func TestContributionScopeDigestAvoidsSanitizationCollision(t *testing.T) {
	first := contributionScopeDigest("PROJECT/A", "CYCLE:1")
	second := contributionScopeDigest("PROJECT-A", "CYCLE-1")
	if first == second {
		t.Fatal("distinct raw contribution scopes must not share an operation scope key")
	}
	if len(first) != 64 || len(second) != 64 {
		t.Fatalf("scope digests must be bounded SHA-256 hex values: %q %q", first, second)
	}
}

func TestContributionOperationCreatorFallsBackToTrustedServiceClient(t *testing.T) {
	if got := contributionOperationCreator("", "AIMS-DISPATCHER"); got != "AIMS-DISPATCHER" {
		t.Fatalf("creator = %q", got)
	}
	if got := contributionOperationCreator("operator-1", "AIMS-DISPATCHER"); got != "operator-1" {
		t.Fatalf("creator = %q", got)
	}
}
