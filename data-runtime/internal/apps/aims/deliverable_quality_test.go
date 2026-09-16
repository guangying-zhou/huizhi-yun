package aims

import (
	"encoding/json"
	"testing"
)

func TestNormalizeQAChecklistItemsRejectsDuplicateCodes(t *testing.T) {
	_, err := normalizeQAChecklistItems([]any{
		map[string]any{"code": "DOC-1", "label": "结构完整"},
		map[string]any{"code": "DOC-1", "label": "内容准确"},
	})
	if err == nil {
		t.Fatal("expected duplicate checklist code to be rejected")
	}
}

func TestValidateRequiredQAChecklistResultsRequiresEveryMandatoryItem(t *testing.T) {
	checklist := json.RawMessage(`[
	  {"code":"DOC-1","label":"结构完整","required":true},
	  {"code":"DOC-2","label":"格式一致","required":false}
	]`)
	if err := validateRequiredQAChecklistResults(checklist, []map[string]any{
		{"code": "DOC-2", "passed": true},
	}); err == nil {
		t.Fatal("expected missing required item to be rejected")
	}
	if err := validateRequiredQAChecklistResults(checklist, []map[string]any{
		{"code": "DOC-1", "passed": true},
	}); err != nil {
		t.Fatalf("expected required item pass to succeed, got %v", err)
	}
}

func TestNormalizeQAChecklistResultsRejectsDuplicateCodes(t *testing.T) {
	_, err := normalizeQAChecklistResults([]any{
		map[string]any{"code": "DOC-1", "passed": true},
		map[string]any{"code": "DOC-1", "passed": false},
	})
	if err == nil {
		t.Fatal("expected duplicate result code to be rejected")
	}
}
