package integrationoperation

import (
	"errors"
	"strings"
	"testing"
)

func validIdentity() Identity {
	return Identity{
		TenantCode:     "tenant-1",
		DeploymentCode: "prod-ca-1",
		SourceApp:      "aims",
		TargetApp:      "people",
		OperationCode:  "aims.people.contributions.sync.v1",
		SourceBizType:  "project-period",
		SourceBizCode:  "PRJ-1:2026-07",
		IdempotencyKey: "aims:project:PRJ-1:contributions:2026-07:v1",
		CommandSHA256:  strings.Repeat("a", 64),
	}
}

func TestIdentityValidationAndImmutability(t *testing.T) {
	original := validIdentity()
	if err := original.Validate(); err != nil {
		t.Fatalf("valid identity rejected: %v", err)
	}
	if err := ValidateImmutableIdentity(original, original); err != nil {
		t.Fatalf("identical identity rejected: %v", err)
	}

	changed := original
	changed.TargetApp = "finance"
	if err := ValidateImmutableIdentity(original, changed); !errors.Is(err, ErrImmutableIdentity) {
		t.Fatalf("changed target error = %v, want ErrImmutableIdentity", err)
	}
	changed = original
	changed.CommandSHA256 = strings.Repeat("b", 64)
	if err := ValidateImmutableIdentity(original, changed); !errors.Is(err, ErrImmutableIdentity) {
		t.Fatalf("changed digest error = %v, want ErrImmutableIdentity", err)
	}

	invalid := original
	invalid.SourceApp = invalid.TargetApp
	if err := invalid.Validate(); !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("same app error = %v, want ErrInvalidIdentity", err)
	}
	invalid = original
	invalid.CommandSHA256 = "not-a-digest"
	if err := invalid.Validate(); !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("bad digest error = %v, want ErrInvalidIdentity", err)
	}
}

func TestValidateSafeCommand(t *testing.T) {
	safe := map[string]any{
		"source_app":   "aims",
		"project_code": "PRJ-1",
		"items":        []any{map[string]any{"employee_uid": "u-1", "hours": 8}},
	}
	if err := ValidateSafeCommand(safe); err != nil {
		t.Fatalf("safe command rejected: %v", err)
	}
	digest, err := ValidateAndDigestCommand(safe)
	if err != nil || len(digest) != 64 {
		t.Fatalf("ValidateAndDigestCommand() = (%q, %v)", digest, err)
	}
	digestAgain, err := ValidateAndDigestCommand(safe)
	if err != nil || digestAgain != digest {
		t.Fatalf("digest is not deterministic: %q != %q (%v)", digestAgain, digest, err)
	}

	unsafe := []any{
		map[string]any{"authorization": "Bearer abc"},
		map[string]any{"metadata": map[string]any{"access_token": "abc"}},
		map[string]any{"callback_url": ""},
		map[string]any{"destination": "https://internal.example/run"},
		map[string]any{"note": "Bearer abc.def"},
		map[string]any{"value": "abcdefgh.ijklmnop.qrstuvwx"},
		map[string]any{"value": "sk-abcdefghijklmnop"},
	}
	for index, command := range unsafe {
		if err := ValidateSafeCommand(command); !errors.Is(err, ErrUnsafePersistenceContent) {
			t.Errorf("unsafe command %d error = %v, want ErrUnsafePersistenceContent", index, err)
		}
	}
}

func TestErrorSummarySafetyAndSanitization(t *testing.T) {
	if err := ValidateSafeErrorSummary("service token request failed with status 403"); err != nil {
		t.Fatalf("non-secret diagnostic rejected: %v", err)
	}
	unsafe := "POST https://runtime.internal/v1 failed; Authorization: Bearer abc.def.ghi; password=hunter2"
	if err := ValidateSafeErrorSummary(unsafe); !errors.Is(err, ErrUnsafePersistenceContent) {
		t.Fatalf("unsafe summary error = %v, want ErrUnsafePersistenceContent", err)
	}
	safe := SanitizeErrorSummary(unsafe, 200)
	if err := ValidateSafeErrorSummary(safe); err != nil {
		t.Fatalf("sanitized summary remains unsafe: %q (%v)", safe, err)
	}
	for _, leaked := range []string{"runtime.internal", "abc.def.ghi", "hunter2"} {
		if strings.Contains(safe, leaked) {
			t.Errorf("sanitized summary leaked %q: %q", leaked, safe)
		}
	}

	truncated := SanitizeErrorSummary("一二三四五六", 4)
	if truncated != "一二三四" {
		t.Fatalf("unicode truncation = %q, want %q", truncated, "一二三四")
	}
}
