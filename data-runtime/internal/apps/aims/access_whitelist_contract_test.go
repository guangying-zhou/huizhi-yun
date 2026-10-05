package aims

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestAccessWhitelistJSONTextAcceptsOnlyContractArrays(t *testing.T) {
	for _, tc := range []struct {
		label string
		body  map[string]any
		want  string
	}{
		{"absent", map[string]any{}, ""},
		{"nil", map[string]any{"accessWhitelist": nil}, ""},
		{"blank text", map[string]any{"accessWhitelist": "  "}, ""},
		{"snake key", map[string]any{"access_whitelist": []any{"U1", "U2"}}, `["U1","U2"]`},
		{"camel key", map[string]any{"accessWhitelist": []string{"U1"}}, `["U1"]`},
		{"empty array", map[string]any{"accessWhitelist": []any{}}, `[]`},
		{"json text", map[string]any{"accessWhitelist": ` ["U1"] `}, `["U1"]`},
	} {
		got, err := accessWhitelistJSONText(tc.body, "access_whitelist", "accessWhitelist")
		if err != nil || got != tc.want {
			t.Fatalf("%s: got %q err %v want %q", tc.label, got, err, tc.want)
		}
	}
}

func TestAccessWhitelistJSONTextRejectsEverythingElse(t *testing.T) {
	many := make([]any, 1001)
	for i := range many {
		many[i] = fmt.Sprintf("U%d", i)
	}
	for label, value := range map[string]any{
		"object":        map[string]any{"U1": true},
		"number":        1,
		"plain text":    "U1,U2",
		"invalid json":  `["U1"`,
		"json object":   `{"a":1}`,
		"null literal":  "null",
		"non string":    []any{"U1", 2},
		"null element":  []any{nil},
		"duplicate":     []any{"U1", "U1"},
		"untrimmed":     []any{" U1"},
		"empty uid":     []any{""},
		"too long":      []any{strings.Repeat("u", 129)},
		"too many":      many,
		"unmarshalable": func() {},
	} {
		_, err := accessWhitelistJSONText(map[string]any{"accessWhitelist": value}, "accessWhitelist")
		var apiErr httperror.Error
		if !errors.As(err, &apiErr) || apiErr.Status != http.StatusBadRequest || apiErr.Code != "project_whitelist_invalid" {
			t.Fatalf("%s: want 400 project_whitelist_invalid, got %v", label, err)
		}
	}
}
