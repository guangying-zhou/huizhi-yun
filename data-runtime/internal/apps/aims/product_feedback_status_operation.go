package aims

import (
	"math"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

const productFeedbackStatusOperationCode = "aims.altoc.product-feedback.update-status.v1"

// Stored JSON is decoded by loadLeasedIntegrationOperation using json.Unmarshal.
func validProductFeedbackStatusCommand(command map[string]any) bool {
	if len(command) != 6 {
		return false
	}
	for key, limit := range map[string]int{"ticketCode": 30, "productCode": 64} {
		value, ok := command[key].(string)
		if !ok || value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.ContainsFunc(value, unicode.IsControl) || strings.ContainsAny(value, `/\`) {
			return false
		}
	}
	for _, key := range []string{"requestBizId", "canonicalRequestBizId"} {
		value, ok := command[key].(string)
		parsed, err := uuid.Parse(value)
		if !ok || err != nil || parsed == uuid.Nil || parsed.String() != value {
			return false
		}
	}
	switch command["decisionStatus"] {
	case "submitted", "evaluating", "accepted", "deferred", "rejected", "merged":
	default:
		return false
	}
	if (command["decisionStatus"] == "merged") != (command["requestBizId"] != command["canonicalRequestBizId"]) {
		return false
	}
	revision, ok := command["sourceRevision"].(float64)
	return ok && revision > 0 && revision <= 9007199254740991 && math.Trunc(revision) == revision
}
