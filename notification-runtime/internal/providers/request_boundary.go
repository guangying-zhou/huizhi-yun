package providers

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

var recipientSeparators = regexp.MustCompile(`[|,\s]+`)
var sourceAppPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,63}$`)

// ValidateSendBoundary binds caller-controlled notification fields to the
// verified service-token identity before provider delivery.
func ValidateSendBoundary(input SendRequest, trustedSourceApp string) (SendRequest, error) {
	recipients, err := NormalizeRecipientUIDs(input.ToUser)
	if err != nil {
		return SendRequest{}, err
	}
	input.ToUser = strings.Join(recipients, "|")
	normalized, err := NormalizeSendRequest(input)
	if err != nil {
		return SendRequest{}, err
	}

	sourceApp, err := BindTrustedSourceApp(normalized.SourceAppCode, trustedSourceApp)
	if err != nil {
		return SendRequest{}, err
	}
	normalized.SourceAppCode = sourceApp
	return normalized, nil
}

func BindTrustedSourceApp(requestSourceApp string, trustedSourceApp string) (string, error) {
	requested := strings.ToLower(strings.TrimSpace(requestSourceApp))
	trusted := strings.ToLower(strings.TrimSpace(trustedSourceApp))
	if requested == "" || !sourceAppPattern.MatchString(requested) {
		return "", httperror.New(http.StatusBadRequest, "invalid_source_app", "sourceAppCode is required and must be a valid application code")
	}
	if trusted == "" || !sourceAppPattern.MatchString(trusted) {
		return "", httperror.New(http.StatusForbidden, "missing_trusted_source_app", "Service token source application is unavailable")
	}
	if requested != trusted {
		return "", httperror.New(http.StatusForbidden, "source_app_mismatch", "sourceAppCode does not match the service token")
	}
	return trusted, nil
}

func NormalizeRecipientUIDs(value any) ([]string, error) {
	entries := make([]string, 0)
	switch item := value.(type) {
	case string:
		entries = append(entries, item)
	case []string:
		entries = append(entries, item...)
	case []any:
		for _, entry := range item {
			text, ok := entry.(string)
			if !ok {
				return nil, httperror.New(http.StatusBadRequest, "invalid_touser", "touser must contain only recipient UID strings")
			}
			entries = append(entries, text)
		}
	case nil:
		// Rejected below as an empty recipient set.
	default:
		return nil, httperror.New(http.StatusBadRequest, "invalid_touser", "touser must be a recipient UID string or array")
	}

	seen := make(map[string]struct{})
	recipients := make([]string, 0, len(entries))
	for _, entry := range entries {
		for _, rawUID := range recipientSeparators.Split(entry, -1) {
			uid := strings.TrimSpace(rawUID)
			if uid == "" {
				continue
			}
			if strings.EqualFold(uid, "@all") {
				return nil, httperror.New(http.StatusBadRequest, "broadcast_recipient_forbidden", "touser does not accept @all")
			}
			if _, exists := seen[uid]; exists {
				continue
			}
			seen[uid] = struct{}{}
			recipients = append(recipients, uid)
		}
	}
	if len(recipients) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_touser", "touser requires at least one recipient UID")
	}
	return recipients, nil
}
