package aims

import "testing"

func TestNormalizeAimsProjectRole(t *testing.T) {
	cases := map[string]string{
		"manager":   "manager",
		"viewer":    "viewer",
		"member":    "member",
		"developer": "member",
		"":          "member",
	}
	for input, expected := range cases {
		if actual := normalizeAimsProjectRole(input); actual != expected {
			t.Fatalf("normalizeAimsProjectRole(%q) = %q, want %q", input, actual, expected)
		}
	}
}
