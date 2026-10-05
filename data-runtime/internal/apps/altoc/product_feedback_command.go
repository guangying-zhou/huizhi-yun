package altoc

import (
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const altocProductFeedbackOperation = "altoc.aims.product-request.create-from-feedback.v1"
const altocProductFeedbackCapability = "aims:product-request:create-from-feedback"
const altocProductFeedbackSchema = "product-feedback-create.v1"

// The snapshot covers only the source facts sent to AIMS. It is compared while
// holding the ticket row lock; service priority is deliberately not a product score.
func altocProductFeedbackSnapshot(ticket map[string]any) (map[string]any, string, error) {
	text := func(key string) string {
		if ticket[key] == nil {
			return ""
		}
		if value, ok := ticket[key].([]byte); ok {
			return string(value)
		}
		return fmt.Sprint(ticket[key])
	}
	snapshot := map[string]any{"ticketCode": text("code"), "productCode": text("product_code"), "ticketType": text("ticket_type"), "title": text("title"), "description": text("description")}
	if snapshot["ticketType"] != "requirement" {
		return nil, "", httperror.New(http.StatusConflict, "product_feedback_ticket_type", "only requirement tickets can become product feedback")
	}
	for key, limit := range map[string]int{"ticketCode": 30, "productCode": 64, "title": 200} {
		value := snapshot[key].(string)
		if value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.ContainsFunc(value, unicode.IsControl) || (key != "title" && strings.ContainsAny(value, `/\`)) {
			return nil, "", httperror.New(http.StatusConflict, "product_feedback_source_invalid", "ticket product, code or title is invalid")
		}
	}
	description := snapshot["description"].(string)
	if !utf8.ValidString(description) || utf8.RuneCountInString(description) > 10000 || strings.ContainsRune(description, 0) {
		return nil, "", httperror.New(http.StatusConflict, "product_feedback_source_invalid", "ticket description exceeds feedback input limits")
	}
	digest, err := integrationoperation.ValidateAndDigestCommand(snapshot)
	return snapshot, digest, err
}
