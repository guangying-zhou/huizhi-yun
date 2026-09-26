package unified

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

func contractString(v any, max int) bool {
	s, ok := v.(string)
	return ok && utf8.ValidString(s) && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, '\x00')
}
func contractSortOrder(v any) bool {
	n, ok := v.(json.Number)
	if !ok {
		return false
	}
	i, e := n.Int64()
	return e == nil && i >= -2147483648 && i <= 2147483647
}

func typedPayloadValid(value any, target any, hash string) bool {
	raw, e := json.Marshal(value)
	if e != nil {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		return false
	}
	canonical, e := json.Marshal(target)
	if e != nil {
		return false
	}
	stored, se := contractObject(raw)
	emitted, ee := contractObject(canonical)
	if se != nil || ee != nil || !contractJSONEqual(stored, emitted) {
		return false
	}
	sum := sha256.Sum256(canonical)
	return hash == hex.EncodeToString(sum[:])
}

// Reuse the public owning-domain payload types so receipt fingerprints retain
// struct field order, decimal formatting and omitempty semantics of the writer.
func planInputFingerprint(action string, input any, hash string) bool {
	switch action {
	case "product_versions:plan-edit":
		return typedPayloadValid(input, &productcenter.LightweightVersionPlanEdit{}, hash)
	case "product_versions:plan-item-create":
		return typedPayloadValid(input, &productcenter.LightweightVersionPlanItemCreate{}, hash)
	case "product_versions:plan-item-edit":
		return typedPayloadValid(input, &productcenter.LightweightVersionPlanItemEdit{}, hash)
	case "product_versions:plan-confirm":
		return typedPayloadValid(input, &productcenter.LightweightVersionPlanConfirm{}, hash)
	}
	return false
}
