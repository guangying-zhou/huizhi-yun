// Package wizbiztool owns the offline WizBiz migration lane. It never reads
// environment credentials and is not a business-query dependency.
package wizbiztool

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

var ErrInput = errors.New("migration_input_invalid")

// CanonicalRow accepts only source text, NULL, or the exact vault redaction.
// SQL numeric precision and NULL/empty distinctions are never normalized.
func CanonicalRow(row map[string]any) ([]byte, error) {
	keys := make([]string, 0, len(row))
	for key := range row {
		if !utf8.ValidString(key) {
			return nil, ErrInput
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out bytes.Buffer
	out.WriteByte('{')
	for i, key := range keys {
		if i > 0 {
			out.WriteByte(',')
		}
		if err := writeString(&out, key); err != nil {
			return nil, err
		}
		out.WriteByte(':')
		switch value := row[key].(type) {
		case nil:
			out.WriteString("null")
		case string:
			if err := writeString(&out, value); err != nil {
				return nil, err
			}
		case VaultRedaction:
			if !validSecretRef(value.SecretRef) {
				return nil, ErrInput
			}
			out.WriteString(`{"$redacted":"vault","secretRef":`)
			_ = writeString(&out, value.SecretRef)
			out.WriteByte('}')
		default:
			return nil, ErrInput
		}
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}
func writeString(out *bytes.Buffer, value string) error {
	if !utf8.ValidString(value) {
		return ErrInput
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if encoder.Encode(value) != nil {
		return ErrInput
	}
	// Restore only JSON's separator escapes, not user-provided literal escape
	// sequences: decoding the quoted string below is avoided by counting slashes.
	raw := bytes.TrimSuffix(encoded.Bytes(), []byte{'\n'})
	for i := 0; i < len(raw); {
		if raw[i] == '\\' && i+1 < len(raw) {
			if raw[i+1] == '\\' {
				out.Write(raw[i : i+2])
				i += 2
				continue
			}
			if i+6 <= len(raw) && (string(raw[i:i+6]) == `\u2028` || string(raw[i:i+6]) == `\u2029`) {
				if raw[i+5] == '8' {
					out.WriteString("\u2028")
				} else {
					out.WriteString("\u2029")
				}
				i += 6
				continue
			}
			out.Write(raw[i : i+2])
			i += 2
			continue
		}
		out.WriteByte(raw[i])
		i++
	}
	return nil
}

type VaultRedaction struct{ SecretRef string }

func Digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }

// TableDigest takes row digests already ordered by native SQL primary key.
func TableDigest(rows []string) (string, error) {
	for _, r := range rows {
		if len(r) != 64 {
			return "", ErrInput
		}
		if _, err := hex.DecodeString(r); err != nil || strings.ToLower(r) != r {
			return "", ErrInput
		}
	}
	return Digest([]byte(strings.Join(rows, "\n"))), nil
}
func ObjectCode(family, sourcePK string) (string, error) {
	prefixes := map[string]string{"customer": "CU", "contact": "CN", "contract": "CT", "bank-account": "BA", "legal-entity": "ENT"}
	prefix, ok := prefixes[family]
	if !ok {
		return "", ErrInput
	}
	id, err := strconv.ParseUint(sourcePK, 10, 64)
	if err != nil || id == 0 || strconv.FormatUint(id, 10) != sourcePK {
		return "", ErrInput
	}
	digits := sourcePK
	if len(digits) < 6 {
		digits = strings.Repeat("0", 6-len(digits)) + digits
	}
	return prefix + "-W" + digits, nil
}
func SecretRef(accountCode string) (string, error) {
	if !strings.HasPrefix(accountCode, "BA-W") {
		return "", ErrInput
	}
	code, err := ObjectCode("bank-account", strings.TrimLeft(strings.TrimPrefix(accountCode, "BA-W"), "0"))
	if err != nil || code != accountCode {
		return "", ErrInput
	}
	return "hzybase://vault/finance.bank-account." + accountCode + ".account-no", nil
}
func validSecretRef(value string) bool {
	code := strings.TrimSuffix(strings.TrimPrefix(value, "hzybase://vault/finance.bank-account."), ".account-no")
	ref, err := SecretRef(code)
	return err == nil && ref == value
}

// CanonicalBaseline encodes every non-NULL SQL byte sequence as hex. This
// remains injective for binary columns and distinguishes NULL from empty;
// source serialization and its frozen golden vectors are unchanged.
func CanonicalBaseline(row map[string]any) ([]byte, error) {
	encoded := make(map[string]any, len(row))
	for key, value := range row {
		if value == nil {
			encoded[key] = nil
			continue
		}
		text, ok := value.(string)
		if !ok {
			return nil, ErrInput
		}
		encoded[key] = hex.EncodeToString([]byte(text))
	}
	return CanonicalRow(encoded)
}
