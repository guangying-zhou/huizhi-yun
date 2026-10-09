package independentverify

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"
	"unicode/utf8"
)

var ErrVerify = errors.New("migration_verify_mismatch")

// CanonicalSource deliberately has its own encoder; it does not use apply's
// canonical implementation or encoding/json's HTML/Unicode escape policy.
func CanonicalSource(row map[string]any) ([]byte, error) {
	keys := []string{}
	for key := range row {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteByte('{')
	for i, key := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		if err := quote(&b, key); err != nil {
			return nil, err
		}
		b.WriteByte(':')
		switch value := row[key].(type) {
		case nil:
			b.WriteString("null")
		case string:
			if err := quote(&b, value); err != nil {
				return nil, err
			}
		case map[string]any:
			if len(value) != 2 || value["$redacted"] != "vault" {
				return nil, ErrVerify
			}
			ref, ok := value["secretRef"].(string)
			if !ok || !strings.HasPrefix(ref, "hzybase://vault/finance.bank-account.BA-W") || !strings.HasSuffix(ref, ".account-no") {
				return nil, ErrVerify
			}
			b.WriteString(`{"$redacted":"vault","secretRef":`)
			if err := quote(&b, ref); err != nil {
				return nil, err
			}
			b.WriteByte('}')
		default:
			return nil, ErrVerify
		}
	}
	b.WriteByte('}')
	return []byte(b.String()), nil
}
func quote(b *strings.Builder, text string) error {
	if !utf8.ValidString(text) {
		return ErrVerify
	}
	b.WriteByte('"')
	const digits = "0123456789abcdef"
	for _, r := range text {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 32 {
				b.WriteString(`\u00`)
				b.WriteByte(digits[byte(r)>>4])
				b.WriteByte(digits[byte(r)&15])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return nil
}
func SHA(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }

// CanonicalBaseline independently encodes SQL bytes before canonical JSON.
// Never decode arbitrary binary values as UTF-8 or replace invalid bytes.
func CanonicalBaseline(row map[string]any) ([]byte, error) {
	encoded := make(map[string]any, len(row))
	const digits = "0123456789abcdef"
	for name, value := range row {
		if value == nil {
			encoded[name] = nil
			continue
		}
		text, ok := value.(string)
		if !ok {
			return nil, ErrVerify
		}
		var out strings.Builder
		for i := 0; i < len(text); i++ {
			out.WriteByte(digits[text[i]>>4])
			out.WriteByte(digits[text[i]&15])
		}
		encoded[name] = out.String()
	}
	return CanonicalSource(encoded)
}
