package aims

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const productCostRulesOperationCode = "aims.finance.product-cost.rules.replace.v1"

func validProductCostRulesOperation(command map[string]any) bool {
	if len(command) != 6 {
		return false
	}
	for key, limit := range map[string]int{"actorUid": 64, "projectCode": 50, "periodMonth": 7, "evidenceRef": 500} {
		value, ok := command[key].(string)
		if !ok || !utf8.ValidString(value) || strings.TrimSpace(value) == "" || strings.ContainsFunc(value, unicode.IsControl) || len([]rune(value)) > limit {
			return false
		}
		if key != "evidenceRef" && (strings.TrimSpace(value) != value || strings.ContainsAny(value, "/\\")) {
			return false
		}
	}
	actor := command["actorUid"].(string)
	if actor == "@all" || strings.HasPrefix(actor, "client:") || len(command["evidenceRef"].(string)) > 500 {
		return false
	}
	period := command["periodMonth"].(string)
	month, err := time.Parse("2006-01", period)
	if err != nil || month.Year() < 1 || month.Format("2006-01") != period {
		return false
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return false
	}
	var parsed struct {
		ExpectedRevision int64 `json:"expectedRevision"`
		Shares           []struct {
			ProductCode string `json:"productCode"`
			BasisPoints int    `json:"basisPoints"`
		} `json:"shares"`
	}
	if json.Unmarshal(raw, &parsed) != nil || command["expectedRevision"] == nil || parsed.ExpectedRevision < 0 || parsed.ExpectedRevision >= 9007199254740991 {
		return false
	}
	rows, ok := command["shares"].([]any)
	if !ok || len(rows) > 10000 {
		return false
	}
	seen := map[string]bool{}
	total := 0
	for i, row := range rows {
		fields, ok := row.(map[string]any)
		if !ok || len(fields) != 2 {
			return false
		}
		share := parsed.Shares[i]
		code := share.ProductCode
		if code == "" || !utf8.ValidString(code) || utf8.RuneCountInString(code) > 64 || code != strings.TrimSpace(code) || strings.ContainsAny(code, "/\\") || strings.ContainsFunc(code, unicode.IsControl) || seen[code] || share.BasisPoints < 1 || share.BasisPoints > 10000 {
			return false
		}
		seen[code] = true
		total += share.BasisPoints
		if total > 10000 {
			return false
		}
	}
	return true
}

func productCostRulesTarget(command map[string]any) (string, string) {
	if !validProductCostRulesOperation(command) {
		return "", ""
	}
	raw, _ := json.Marshal(command)
	var value struct {
		ExpectedRevision int64 `json:"expectedRevision"`
	}
	_ = json.Unmarshal(raw, &value)
	return "product_cost_attribution_revision", fmt.Sprintf("%s:%s:%d", command["projectCode"], command["periodMonth"], value.ExpectedRevision+1)
}
