package finance

import (
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const productCostReadOperation = "aims.finance.product-cost.read.v1"
const productCostReadCapability = "finance:product-cost:read"

type productCostReadCommand struct {
	ActorUID    string `json:"actorUid"`
	ProductCode string `json:"productCode"`
	ProjectCode string `json:"projectCode"`
	PeriodMonth string `json:"periodMonth"`
	Action      string `json:"action"`
}

// This validates the signed payload shape only. Runtime still must verify the
// signature context, exact capability, actor and tenant/deployment bindings.
func parseProductCostReadCommand(input map[string]any) (productCostReadCommand, error) {
	invalid := func() (productCostReadCommand, error) {
		return productCostReadCommand{}, httperror.New(403, "product_cost_command_invalid", "Invalid product cost read command")
	}
	if len(input) != 5 {
		return invalid()
	}
	values := make(map[string]string, 5)
	for _, key := range []string{"actorUid", "productCode", "projectCode", "periodMonth", "action"} {
		value, ok := input[key].(string)
		if !ok {
			return invalid()
		}
		values[key] = value
	}
	command := productCostReadCommand{ActorUID: values["actorUid"], ProductCode: values["productCode"], ProjectCode: values["projectCode"], PeriodMonth: values["periodMonth"], Action: values["action"]}
	month, err := time.Parse("2006-01", command.PeriodMonth)
	if err != nil || month.Year() < 1 || month.Format("2006-01") != command.PeriodMonth || command.Action != "read" ||
		!validProductAttributionKey(command.ActorUID, 64) || command.ActorUID == "@all" || strings.HasPrefix(command.ActorUID, "client:") ||
		!validProductAttributionKey(command.ProductCode, 64) || !validProductAttributionKey(command.ProjectCode, 50) {
		return invalid()
	}
	return command, nil
}
