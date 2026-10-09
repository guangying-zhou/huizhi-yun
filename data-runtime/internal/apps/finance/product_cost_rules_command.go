package finance

import (
	"encoding/json"
	"math"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type productCostRulesCommand struct {
	ActorUID         string `json:"actorUid"`
	ProjectCode      string `json:"projectCode"`
	PeriodMonth      string `json:"periodMonth"`
	ExpectedRevision int64  `json:"expectedRevision"`
	EvidenceRef      string `json:"evidenceRef"`
	Shares           []struct {
		ProductCode string `json:"productCode"`
		BasisPoints int    `json:"basisPoints"`
	} `json:"shares"`
}

// Only a whole-project edit can replace the complete revision. A product-view
// permission is insufficient. The boundary must authenticate the actor and
// authorize project rule editing before invoking the transactional store.
func parseProductCostRulesCommand(input map[string]any) (productCostRulesCommand, productCostAttributionRules, error) {
	invalid := func() (productCostRulesCommand, productCostAttributionRules, error) {
		return productCostRulesCommand{}, productCostAttributionRules{}, httperror.New(400, "product_cost_rules_invalid", "Invalid complete product cost rules")
	}
	if len(input) != 6 {
		return invalid()
	}
	for _, key := range []string{"actorUid", "projectCode", "periodMonth", "expectedRevision", "evidenceRef", "shares"} {
		if value, ok := input[key]; !ok || value == nil {
			return invalid()
		}
	}
	rows, ok := input["shares"].([]any)
	if !ok || len(rows) > 10000 {
		return invalid()
	}
	for _, row := range rows {
		fields, ok := row.(map[string]any)
		if !ok || len(fields) != 2 || fields["productCode"] == nil || fields["basisPoints"] == nil {
			return invalid()
		}
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return invalid()
	}
	var command productCostRulesCommand
	if json.Unmarshal(encoded, &command) != nil || command.ExpectedRevision < 0 || command.ExpectedRevision == math.MaxInt64 {
		return invalid()
	}
	actorCheck := map[string]any{"actorUid": command.ActorUID, "productCode": "validation", "projectCode": command.ProjectCode, "periodMonth": command.PeriodMonth, "action": "read"}
	if _, err := parseProductCostReadCommand(actorCheck); err != nil {
		return invalid()
	}
	rules := productCostAttributionRules{ProjectCode: command.ProjectCode, PeriodMonth: command.PeriodMonth, Revision: command.ExpectedRevision + 1, EvidenceRef: command.EvidenceRef, Shares: make([]productCostShare, 0, len(command.Shares))}
	for _, share := range command.Shares {
		rules.Shares = append(rules.Shares, productCostShare{ProductCode: share.ProductCode, BasisPoints: share.BasisPoints})
	}
	if _, err := distributeProductCost("0.00", "CNY", rules); err != nil {
		return invalid()
	}
	return command, rules, nil
}
