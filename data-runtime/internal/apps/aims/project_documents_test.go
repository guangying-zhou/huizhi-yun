package aims

import "testing"

func TestResolveProjectDocumentBindingAcceptsLegacyDocumentID(t *testing.T) {
	binding, err := resolveProjectDocumentBinding(map[string]any{
		"documentId": "12be6109-19ea-4ff3-87e7-a185a0100791",
		"title":      "项目立项书",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if binding.Source != "codocs" {
		t.Fatalf("unexpected source: %q", binding.Source)
	}
	if !binding.CodocsUUID.Valid || binding.CodocsUUID.String != "12be6109-19ea-4ff3-87e7-a185a0100791" {
		t.Fatalf("unexpected codocs uuid: %#v", binding.CodocsUUID)
	}
	if binding.Title != "项目立项书" {
		t.Fatalf("unexpected title: %q", binding.Title)
	}
}

func TestResolveProjectDocumentBindingRequiresCodocsUUID(t *testing.T) {
	_, err := resolveProjectDocumentBinding(map[string]any{
		"title": "项目立项书",
	})
	if err == nil {
		t.Fatal("expected missing codocs uuid error")
	}
}

func TestMapProjectDocumentResponseUsesSettingsPageShape(t *testing.T) {
	item := mapProjectDocumentResponse(map[string]any{
		"id":              int64(7),
		"uuid":            "aims-doc-uuid",
		"title":           "项目立项书",
		"doc_category":    "project_proposal",
		"codocs_uuid":     "codocs-doc-uuid",
		"document_source": nil,
		"created_by":      "u1",
		"created_at":      "2026-06-15 10:00:00",
	})

	if item["docCategory"] != "project_proposal" {
		t.Fatalf("unexpected docCategory: %#v", item["docCategory"])
	}
	if item["codocsUuid"] != "codocs-doc-uuid" {
		t.Fatalf("unexpected codocsUuid: %#v", item["codocsUuid"])
	}
	if item["documentSource"] != "codocs" {
		t.Fatalf("unexpected documentSource: %#v", item["documentSource"])
	}
}
