package enterpriseapf

import (
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestAPFSalesSupportClosedInputs(t *testing.T) {
	if len(salesSupportOps) != 14 {
		t.Fatal("support operation count")
	}
	for op := range salesSupportOps {
		input := SalesInput{ID: "1", Payload: map[string]any{}}
		if op == "opportunity-stages-list" {
			input.ID = ""
			input.Payload["purpose"] = "opportunity-view"
		}
		if input.Payload == nil {
			t.Fatal("fixture")
		}
		if op[len(op)-5:] == "-list" {
			input.Payload["page"] = float64(1)
			input.Payload["pageSize"] = float64(20)
		} else {
			input.Payload["expectedVersion"] = float64(1)
		}
		if op == "opportunity-contact-roles-update" || op == "opportunity-contact-roles-delete" || op == "lead-documents-delete" || op == "opportunity-documents-delete" {
			input.Payload["childId"] = "2"
		}
		if op == "opportunity-contact-roles-create" || op == "opportunity-contact-roles-update" {
			for k, v := range map[string]any{"contactId": "2", "role": "end_user", "influence_level": "medium", "attitude": "neutral", "is_primary": false} {
				input.Payload[k] = v
			}
		}
		if op == "lead-documents-create" || op == "opportunity-documents-create" {
			input.Payload["document_uuid"] = "6104e341-43f1-4dd5-a41c-49c97eeab324"
			input.Payload["link_type"] = "general"
		}
		if e := ValidateSalesInput(op, input); e != nil {
			t.Fatal(op, e)
		}
		input.Payload["acl"] = true
		if e := ValidateSalesInput(op, input); httperrorStatus(e) != 400 {
			t.Fatal("forged field", op, e)
		}
	}
	cfg := SalesInput{Payload: map[string]any{"purpose": "lead-convert", "page": float64(1), "pageSize": float64(20)}}
	resource, action, ok := SalesSupportPermission("opportunity-stages-list", cfg)
	if !ok || resource != "lead" || action != "convert" {
		t.Fatal(resource, action)
	}
	cfg.Payload["purpose"] = "admin"
	if e := validateSalesSupport("opportunity-stages-list", cfg); httperrorStatus(e) != 400 {
		t.Fatal(e)
	}
}
func TestAPFSalesSupportIntentBindsEveryPayloadField(t *testing.T) {
	i := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(2), "childId": "3"}}
	a, _ := json.Marshal(SalesIntent(i))
	i.Payload["childId"] = "4"
	b, _ := json.Marshal(SalesIntent(i))
	if string(a) == string(b) {
		t.Fatal("child not signed")
	}
	i.Payload["childId"] = "3"
	i.Payload["expectedVersion"] = float64(3)
	b, _ = json.Marshal(SalesIntent(i))
	if string(a) == string(b) {
		t.Fatal("version not signed")
	}
}

func TestAPFSalesSupportDocumentFailureClassification(t *testing.T) {
	if salesDocumentFailure(nil) != nil {
		t.Fatal("nil changed")
	}
	for _, status := range []int{403, 404, 503} {
		err := httperror.New(status, "fixed", "fixed")
		if salesDocumentFailure(err) != err {
			t.Fatal(status)
		}
	}
	err := salesDocumentFailure(errors.New("raw dependency detail"))
	if httperrorStatus(err) != 503 || err.Error() == "raw dependency detail" {
		t.Fatal(err)
	}
}
