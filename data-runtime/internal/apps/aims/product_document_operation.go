package aims

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

const productDocumentCreateOperationCode = "aims.codocs.product-document.create.v1"

func aimsIntegrationOperationCommandSchema(operationCode string) string {
	if operationCode == productCostRulesOperationCode {
		return "product-cost-rules.v1"
	}
	if operationCode == productFeedbackProgressOperationCode {
		return "product-feedback-progress.v1"
	}
	if operationCode == productFeedbackStatusOperationCode {
		return "product-feedback-status.v1"
	}
	if operationCode == productDocumentCreateOperationCode {
		return "product-document-create.v1"
	}
	return "v1"
}

func validProductDocumentCreationCommand(command map[string]any) bool {
	if len(command) != 6 || command["action"] != "create" {
		return false
	}
	for key, limit := range map[string]int{"actorUid": 64, "productCode": 64, "title": 200} {
		value, ok := command[key].(string)
		if !ok || value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.ContainsFunc(value, unicode.IsControl) {
			return false
		}
	}
	if strings.ContainsAny(command["productCode"].(string), "/\\") {
		return false
	}
	for _, key := range []string{"documentUuid", "templateUuid"} {
		value, ok := command[key].(string)
		parsed, err := uuid.Parse(value)
		if !ok || err != nil || parsed == uuid.Nil || parsed.String() != value {
			return false
		}
	}
	return command["documentUuid"] != command["templateUuid"]
}
