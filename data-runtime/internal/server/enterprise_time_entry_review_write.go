package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func enterpriseTimeEntryReviewWriteCanonical(r *http.Request, input enterpriseDelegatedInput, actor, key string) (string, error) {
	bad := httperror.New(400, "time_entry_review_input_invalid", "Invalid review input")
	if len(input.Payload) < 2 || len(input.Payload) > 3 {
		return "", bad
	}
	for name := range input.Payload {
		if name != "action" && name != "entries" && name != "reason" {
			return "", bad
		}
	}
	action, _ := input.Payload["action"].(string)
	if action != "approve" && action != "return" {
		return "", bad
	}
	reason, _ := input.Payload["reason"].(string)
	if len([]rune(reason)) > 1000 || reason != strings.TrimSpace(reason) || (action == "return" && reason == "") || (action == "approve" && reason != "") {
		return "", bad
	}
	raw, ok := input.Payload["entries"].([]any)
	if !ok || len(raw) < 1 || len(raw) > 100 {
		return "", bad
	}
	entries := make([]any, 0, len(raw))
	previous := int64(0)
	for _, item := range raw {
		value, ok := item.(map[string]any)
		if !ok || len(value) != 2 {
			return "", bad
		}
		id, idOK := value["id"].(float64)
		version, versionOK := value["rowVersion"].(float64)
		if !idOK || !versionOK || id <= float64(previous) || id > 9007199254740991 || version < 1 || version > 9007199254740991 || id != float64(int64(id)) || version != float64(int64(version)) {
			return "", bad
		}
		previous = int64(id)
		entries = append(entries, []any{previous, int64(version)})
	}
	if _, e := strconv.ParseInt(input.ProjectID, 10, 64); e != nil {
		return "", bad
	}
	return enterpriseAltocPermitFieldsCanonical([]any{"hzy-enterprise-timesheet-review-write.v1", r.Method, r.URL.RequestURI(), actor, input.Tenant, input.Deployment, input.ProjectID, action, entries, reason, key}), nil
}

func verifyEnterpriseTimeEntryReviewWriteSignature(r *http.Request, input enterpriseDelegatedInput, verified enterpriseRequestContext) error {
	canonical, err := enterpriseTimeEntryReviewWriteCanonical(r, input, verified.ActorUID, r.Header.Get("Idempotency-Key"))
	if err != nil {
		return err
	}
	token, signature := runtimeBearerToken(r), r.Header.Get("X-HZY-Enterprise-Timesheet-Review-Write-Signature")
	if token == "" || signature == "" {
		return httperror.New(403, "time_entry_review_signature_invalid", "Invalid review signature")
	}
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(canonical))
	if !hmac.Equal([]byte(signature), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return httperror.New(403, "time_entry_review_signature_invalid", "Invalid review signature")
	}
	return nil
}
