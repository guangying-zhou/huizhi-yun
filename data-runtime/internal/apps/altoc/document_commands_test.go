package altoc

import (
	"errors"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestDocumentEntitySpecMapsTenderToQuotation(t *testing.T) {
	spec, entityID, err := documentEntitySpecAndID("tender", 42)
	if err != nil {
		t.Fatalf("documentEntitySpecAndID returned error: %v", err)
	}
	if entityID != 42 {
		t.Fatalf("entityID = %d, want 42", entityID)
	}
	if spec.Resource != "quotation" || spec.OwnerColumn != "owner_user_id" || spec.DepartmentColumn != "" {
		t.Fatalf("unexpected tender document spec: %#v", spec)
	}
}

func TestDocumentEntitySpecRejectsUnsupportedEntity(t *testing.T) {
	_, _, err := documentEntitySpecAndID("asset", 1)
	assertDocumentHTTPError(t, err, http.StatusBadRequest, "invalid_document_entity_type")
}

func TestDocumentLinkFieldsRequireReference(t *testing.T) {
	_, err := documentLinkFields(documentEntitySpecs["contract"], 10, map[string]any{
		"document_title": "合同正文",
	})
	assertDocumentHTTPError(t, err, http.StatusBadRequest, "missing_document_reference")
}

func TestDocumentLinkFieldsDefaultsLinkAndSourceType(t *testing.T) {
	fields, err := documentLinkFields(documentEntitySpecs["opportunity"], 11, map[string]any{
		"document_uuid":  " 00000000-0000-0000-0000-000000000001 ",
		"document_title": " 方案 ",
		"created_by":     "u1",
	})
	if err != nil {
		t.Fatalf("documentLinkFields returned error: %v", err)
	}
	if fields["entity_type"] != "opportunity" || fields["entity_id"] != int64(11) {
		t.Fatalf("unexpected entity fields: %#v", fields)
	}
	if fields["link_type"] != "general" || fields["source_type"] != "codocs" {
		t.Fatalf("unexpected defaults: %#v", fields)
	}
	if fields["document_uuid"] != "00000000-0000-0000-0000-000000000001" {
		t.Fatalf("document_uuid was not trimmed: %#v", fields["document_uuid"])
	}
}

func assertDocumentHTTPError(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s error", code)
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != status || httpErr.Code != code {
		t.Fatalf("expected %s %d, got %#v", code, status, err)
	}
}
