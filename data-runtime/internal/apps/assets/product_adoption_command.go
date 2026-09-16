package assets

import (
	"encoding/json"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const productAdoptionReadOperation = "aims.assets.product-adoption.read.v1"
const productAdoptionReadCapability = "assets:product-adoption:read"

type productAdoptionReadCommand struct {
	ActorUID    string `json:"actorUid"`
	ProductCode string `json:"productCode"`
	Action      string `json:"action"`
	Page        int    `json:"page"`
	PageSize    int    `json:"pageSize"`
}

// Parsing is not authentication. The service boundary must additionally verify
// the Foundation signature, exact capability and tenant/deployment binding.
func parseProductAdoptionReadCommand(command map[string]any) (productAdoptionReadCommand, error) {
	var result productAdoptionReadCommand
	invalid := func() (productAdoptionReadCommand, error) {
		return productAdoptionReadCommand{}, httperror.New(403, "product_adoption_command_invalid", "Invalid signed product adoption query")
	}
	if len(command) != 5 {
		return invalid()
	}
	for _, key := range []string{"actorUid", "productCode", "action", "page", "pageSize"} {
		if value, ok := command[key]; !ok || value == nil {
			return invalid()
		}
	}
	for _, key := range []string{"actorUid", "productCode", "action"} {
		value, ok := command[key].(string)
		if !ok || !utf8.ValidString(value) || value == "" || value != strings.TrimSpace(value) || strings.ContainsFunc(value, unicode.IsControl) {
			return invalid()
		}
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return invalid()
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return invalid()
	}
	if utf8.RuneCountInString(result.ActorUID) > 64 || utf8.RuneCountInString(result.ProductCode) > 64 || strings.Contains(result.ProductCode, "/") || result.Action != "read" || result.Page < 1 || result.Page > 1000000 || result.PageSize < 1 || result.PageSize > 200 {
		return invalid()
	}
	return result, nil
}
