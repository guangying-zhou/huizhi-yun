package assets

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/jsoncontract"
)

func requireBadRequest(t *testing.T, label string, err error) {
	t.Helper()
	var apiErr httperror.Error
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusBadRequest {
		t.Fatalf("%s: want 400, got %v", label, err)
	}
}

func TestContractJSONOrNilAcceptsValidAndAbsentValues(t *testing.T) {
	for _, tc := range []struct {
		label string
		body  map[string]any
		want  any
	}{
		{"absent", map[string]any{}, nil},
		{"explicit null", map[string]any{"tags": nil}, nil},
		{"blank string", map[string]any{"tags": "  "}, nil},
		{"array", map[string]any{"tags": []any{"a", "b"}}, `["a","b"]`},
		{"empty array", map[string]any{"tags": []any{}}, `[]`},
		{"json text", map[string]any{"tags": `["a"]`}, `["a"]`},
	} {
		got, err := contractJSONOrNil(tc.body, "tags", jsoncontract.StringList)
		if err != nil || got != tc.want {
			t.Fatalf("%s: got %v err %v want %v", tc.label, got, err, tc.want)
		}
	}
}

func TestContractJSONOrNilRejectsInvalidShapes(t *testing.T) {
	for label, value := range map[string]any{
		"object":        map[string]any{"a": 1},
		"number":        3,
		"bool":          true,
		"non string":    []any{"a", 1},
		"empty entry":   []any{""},
		"invalid text":  `["a"`,
		"plain text":    "a,b",
		"null in list":  []any{nil},
		"unmarshalable": func() {},
	} {
		_, err := contractJSONOrNil(map[string]any{"tags": value}, "tags", jsoncontract.StringList)
		requireBadRequest(t, label, err)
	}
	for label, value := range map[string]any{
		"missing url":  []any{map[string]any{"name": "a"}},
		"extra key":    []any{map[string]any{"name": "a", "url": "u", "size": 1}},
		"string entry": []any{"a"},
		"object":       map[string]any{"name": "a", "url": "u"},
	} {
		_, err := contractJSONOrNil(map[string]any{"attachments": value}, "attachments", jsoncontract.Attachments)
		requireBadRequest(t, "attachments "+label, err)
	}
	if got, err := contractJSONOrNil(map[string]any{"attachments": []any{map[string]any{"name": "a", "url": "https://example.test/a"}}}, "attachments", jsoncontract.Attachments); err != nil || got == nil {
		t.Fatalf("valid attachment rejected: %v %v", got, err)
	}
}

// The writers validate before opening a transaction, so an adapter without a
// database proves the rejection happens ahead of any SQL.
func TestAssetAndPurchaseOrderWritersRejectBadShapesBeforeSQL(t *testing.T) {
	a := &Adapter{}
	ctx := context.Background()
	_, err := a.createAsset(ctx, map[string]any{"tags": []any{1}}, "U1")
	requireBadRequest(t, "createAsset tags", err)
	requireBadRequest(t, "updateAsset tags", a.updateAsset(ctx, 1, map[string]any{"tags": "not json"}, "U1"))
	_, err = a.createPurchaseOrder(ctx, map[string]any{"attachments": "not json"}, "U1")
	requireBadRequest(t, "createPurchaseOrder attachments", err)
	requireBadRequest(t, "updatePurchaseOrder attachments", a.updatePurchaseOrder(ctx, 1, map[string]any{"attachments": []any{"x"}}, "U1"))
}
