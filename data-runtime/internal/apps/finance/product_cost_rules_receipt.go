package finance

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Supply this handler to ReceiptRepository.Execute only after validating the
// command signature and fresh project rule-edit permission (also on replay).
// The shared repository owns commit/rollback of both history and receipt.
func productCostRulesReceiptHandler(actorUID, projectCode, periodMonth string) integrationoperation.ReceiptHandler {
	return func(ctx context.Context, tx *sql.Tx, raw json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		empty := integrationoperation.ReceiptBusinessResult{}
		var input map[string]any
		if !json.Valid(raw) {
			return empty, fmt.Errorf("invalid product cost rules JSON")
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if err := decoder.Decode(&input); err != nil {
			return empty, err
		}
		command, rules, err := parseProductCostRulesCommand(input)
		if err != nil {
			return empty, err
		}
		if command.ActorUID != actorUID || command.ProjectCode != projectCode || command.PeriodMonth != periodMonth {
			return empty, fmt.Errorf("product cost rules authorized context mismatch")
		}
		if err := replaceProductCostAttribution(ctx, tx, rules, command.ExpectedRevision, actorUID); err != nil {
			return empty, err
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "product_cost_attribution_revision", TargetBizCode: fmt.Sprintf("%s:%s:%d", projectCode, periodMonth, rules.Revision), HTTPStatus: http.StatusOK,
			Value: map[string]any{"projectCode": projectCode, "periodMonth": periodMonth, "revision": rules.Revision},
		}, nil
	}
}
