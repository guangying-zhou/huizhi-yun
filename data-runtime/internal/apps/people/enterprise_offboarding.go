package people

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"time"
)

// Exact user actions; admin never supplies confirm/cancel implicitly.
func OffboardingPermission(op string) (string, string, bool) {
	switch op {
	case "offboarding-list", "offboarding-view":
		return "offboarding_tasks", "view", true
	case "offboarding-create", "offboarding-arrange":
		return "offboarding_tasks", "admin", true
	case "offboarding-confirm":
		return "offboarding_tasks", "confirm", true
	case "offboarding-cancel":
		return "offboarding_tasks", "cancel", true
	}
	return "", "", false
}
func IsOffboardingOperation(op string) bool { _, _, ok := OffboardingPermission(op); return ok }
func OffboardingCode(uid, date string) string {
	h := sha256.Sum256([]byte("people-offboarding.v1|" + uid + "|" + date))
	return "OFB-" + hex.EncodeToString(h[:20])
}
func ValidateOffboardingInput(op string, i EnterpriseFactsInput) error {
	if !IsOffboardingOperation(op) || i.SensitiveAllowed {
		return factsError("people_offboarding_input_invalid")
	}
	if op == "offboarding-list" {
		if i.ID != "" || i.EmployeeUID != "" || len(i.Payload) > 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || len([]rune(i.Search)) > 100 || strings.ContainsAny(i.Search, "\x00\r\n") {
			return factsError("people_page_invalid")
		}
		return nil
	}
	if i.Page != 0 || i.PageSize != 0 || i.Search != "" {
		return factsError("people_offboarding_input_invalid")
	}
	if op == "offboarding-create" {
		if i.ID != "" || len(i.Payload) != 1 || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`).MatchString(FactsString(i.Payload, "leaveAssignmentCode")) {
			return factsError("people_offboarding_input_invalid")
		}
	} else if !regexp.MustCompile(`^[1-9][0-9]{0,15}$`).MatchString(i.ID) {
		return factsError("people_identity_invalid")
	}
	if op == "offboarding-view" {
		if i.EmployeeUID != "" || len(i.Payload) != 0 {
			return factsError("people_offboarding_input_invalid")
		}
		return nil
	}
	if !factsUID.MatchString(i.EmployeeUID) || strings.HasPrefix(strings.ToLower(i.EmployeeUID), "dt-") {
		return factsError("people_uid_invalid")
	}
	if op == "offboarding-create" {
		return nil
	}
	if FactsVersion(i.Payload) == 0 {
		return factsError("people_version_required")
	}
	allowed := map[string]bool{"expectedVersion": true}
	switch op {
	case "offboarding-arrange":
		for _, prefix := range []string{"handover", "assetRecovery"} {
			uid := FactsString(i.Payload, prefix+"ResponsibleUid")
			due := FactsString(i.Payload, prefix+"DueAt")
			if !factsUID.MatchString(uid) || strings.HasPrefix(strings.ToLower(uid), "dt-") || uid == i.EmployeeUID {
				return factsError("people_offboarding_responsible_invalid")
			}
			date, err := time.Parse(time.RFC3339, due)
			if err != nil || date.Year() < 2000 || date.Nanosecond() != 0 {
				return factsError("people_offboarding_due_required")
			}
			allowed[prefix+"ResponsibleUid"] = true
			allowed[prefix+"DueAt"] = true
		}
	case "offboarding-confirm", "offboarding-cancel":
		typ := FactsString(i.Payload, "taskType")
		if typ != "handover" && typ != "asset_recovery_coordination" {
			return factsError("people_offboarding_task_invalid")
		}
		allowed["taskType"] = true
		if op == "offboarding-cancel" {
			reason := FactsString(i.Payload, "reason")
			if strings.TrimSpace(reason) != reason || reason == "" || len([]rune(reason)) > 500 || strings.ContainsAny(reason, "\x00\r\n") {
				return factsError("people_offboarding_reason_required")
			}
			allowed["reason"] = true
		}
	}
	for k := range i.Payload {
		if !allowed[k] {
			return factsError("people_offboarding_field_invalid")
		}
	}
	return nil
}
