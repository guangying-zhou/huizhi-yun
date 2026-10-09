package integrationoperation

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

var ErrUnsafePersistenceContent = errors.New("unsafe integration operation persistence content")

const DefaultErrorSummaryRunes = 1000

var (
	urlPattern            = regexp.MustCompile(`(?i)\b(?:https?|wss?|ftp)://[^\s<>"']+`)
	bearerPattern         = regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+`)
	jwtPattern            = regexp.MustCompile(`\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`)
	secretValuePattern    = regexp.MustCompile(`(?i)\b(?:authorization|cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+`)
	providerSecretPattern = regexp.MustCompile(`\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b`)
)

func normalizedFieldName(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, value)
}

func sensitiveFieldName(value string) bool {
	normalized := normalizedFieldName(value)
	if normalized == "" {
		return false
	}
	for _, fragment := range []string{
		"authorization", "cookie", "password", "passwd", "secret", "token", "credential", "privatekey", "apikey", "accesskey",
	} {
		if strings.Contains(normalized, fragment) {
			return true
		}
	}
	return strings.HasSuffix(normalized, "url") || strings.HasSuffix(normalized, "uri")
}

func unsafeStringReason(value string) string {
	switch {
	case urlPattern.MatchString(value):
		return "url"
	case bearerPattern.MatchString(value), jwtPattern.MatchString(value), secretValuePattern.MatchString(value), providerSecretPattern.MatchString(value):
		return "secret"
	default:
		return ""
	}
}

func ValidateSafeCommand(command any) error {
	payload, err := json.Marshal(command)
	if err != nil {
		return fmt.Errorf("%w: command is not JSON serializable", ErrUnsafePersistenceContent)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var normalized any
	if err := decoder.Decode(&normalized); err != nil {
		return fmt.Errorf("%w: command is not valid JSON", ErrUnsafePersistenceContent)
	}
	return validateSafeCommandValue(normalized, "command")
}

func validateSafeCommandValue(value any, path string) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			childPath := path + "." + key
			if sensitiveFieldName(key) {
				return fmt.Errorf("%w: forbidden field at %s", ErrUnsafePersistenceContent, childPath)
			}
			if err := validateSafeCommandValue(child, childPath); err != nil {
				return err
			}
		}
	case []any:
		for index, child := range typed {
			if err := validateSafeCommandValue(child, fmt.Sprintf("%s[%d]", path, index)); err != nil {
				return err
			}
		}
	case string:
		if reason := unsafeStringReason(typed); reason != "" {
			return fmt.Errorf("%w: forbidden %s at %s", ErrUnsafePersistenceContent, reason, path)
		}
	}
	return nil
}

func ValidateAndDigestCommand(command any) (string, error) {
	if err := ValidateSafeCommand(command); err != nil {
		return "", err
	}
	payload, err := json.Marshal(command)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:]), nil
}

func ValidateSafeErrorSummary(summary string) error {
	if reason := unsafeStringReason(summary); reason != "" {
		return fmt.Errorf("%w: error summary contains %s", ErrUnsafePersistenceContent, reason)
	}
	return nil
}

func SanitizeErrorSummary(summary string, maxRunes int) string {
	if maxRunes <= 0 {
		maxRunes = DefaultErrorSummaryRunes
	}
	safe := urlPattern.ReplaceAllString(summary, "[redacted-url]")
	safe = bearerPattern.ReplaceAllString(safe, "[redacted-secret]")
	safe = jwtPattern.ReplaceAllString(safe, "[redacted-secret]")
	safe = secretValuePattern.ReplaceAllString(safe, "[redacted-secret]")
	safe = providerSecretPattern.ReplaceAllString(safe, "[redacted-secret]")
	safe = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, safe)
	safe = strings.Join(strings.Fields(safe), " ")
	runes := []rune(safe)
	if len(runes) > maxRunes {
		safe = string(runes[:maxRunes])
	}
	return safe
}
