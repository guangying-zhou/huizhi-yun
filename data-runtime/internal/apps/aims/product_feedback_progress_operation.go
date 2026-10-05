package aims

import (
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const productFeedbackProgressOperationCode = "aims.altoc.product-feedback.update-progress.v1"

func validProductFeedbackProgressCommand(command map[string]any) bool {
	if len(command) != 8 {
		return false
	}
	status := map[string]any{}
	for _, key := range []string{"ticketCode", "productCode", "requestBizId", "canonicalRequestBizId", "decisionStatus", "sourceRevision"} {
		status[key] = command[key]
	}
	if !validProductFeedbackStatusCommand(status) {
		return false
	}
	switch command["canonicalDecisionStatus"] {
	case "submitted", "evaluating", "accepted", "deferred", "rejected":
	default:
		return false
	}
	if command["requestBizId"] == command["canonicalRequestBizId"] && command["decisionStatus"] != command["canonicalDecisionStatus"] {
		return false
	}
	versions, ok := command["versions"].([]any)
	if !ok || versions == nil || len(versions) > 1000 {
		return false
	}
	seen := map[string]bool{}
	for _, raw := range versions {
		v, ok := raw.(map[string]any)
		if !ok || len(v) != 6 {
			return false
		}
		code, ok := v["versionCode"].(string)
		if !ok || code == "" || strings.TrimSpace(code) != code || !utf8.ValidString(code) || utf8.RuneCountInString(code) > 64 || strings.ContainsFunc(code, unicode.IsControl) || strings.ContainsAny(code, `/\`) || seen[code] {
			return false
		}
		seen[code] = true
		switch v["status"] {
		case "planning", "developing", "released", "archived":
		default:
			return false
		}
		total, ok := v["publicFeatureCount"].(float64)
		if !ok || total < 1 || total > 9007199254740991 || math.Trunc(total) != total {
			return false
		}
		delivered, ok := v["deliveredFeatureCount"].(float64)
		if !ok || delivered < 0 || delivered > total || math.Trunc(delivered) != delivered {
			return false
		}
		for key, layout := range map[string]string{"plannedReleaseDate": "2006-01-02", "releasedAt": "2006-01-02 15:04:05"} {
			value, exists := v[key]
			if !exists {
				return false
			}
			if value == nil {
				continue
			}
			date, ok := value.(string)
			if !ok {
				return false
			}
			parsed, err := time.Parse(layout, date)
			if err != nil || parsed.Format(layout) != date {
				return false
			}
		}
	}
	return true
}
