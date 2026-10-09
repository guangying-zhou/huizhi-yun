package migrationlock

import "testing"

func TestTargetLockIdentitySharedAcrossUUIDCasing(t *testing.T) {
	if Name("ABC-DEF", "business") != Name("abc-def", "business") {
		t.Fatal("server UUID casing split the cutover lock")
	}
	if Name("abc-def", "business") == Name("abc-def", "other") {
		t.Fatal("different targets share lock")
	}
	if len(Name("abc-def", "business")) > 64 {
		t.Fatal("MySQL lock name exceeds limit")
	}
}
