package aims

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/jsoncontract"
)

// accessWhitelistJSONText returns the JSON text to store in
// aims_projects.access_whitelist, or "" when the caller sent none. Unlike
// bodyJSONText it never passes an arbitrary string through: the value must be a
// JSON array of unique trimmed uid strings (jsoncontract.AccessWhitelist), the
// same contract the unified-enterprise cutover gate enforces on copied rows.
func accessWhitelistJSONText(body map[string]any, keys ...string) (string, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		var encoded []byte
		if text, isText := value.(string); isText {
			text = strings.TrimSpace(text)
			if text == "" {
				return "", nil
			}
			encoded = []byte(text)
		} else {
			marshalled, err := json.Marshal(value)
			if err != nil {
				return "", invalidAccessWhitelist()
			}
			encoded = marshalled
		}
		if !jsoncontract.AccessWhitelist(encoded) {
			return "", invalidAccessWhitelist()
		}
		return string(encoded), nil
	}
	return "", nil
}

func invalidAccessWhitelist() error {
	return httperror.New(http.StatusBadRequest, "project_whitelist_invalid", "access_whitelist must be a JSON array of unique user ids")
}
