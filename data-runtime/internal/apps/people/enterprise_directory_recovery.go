package people

import (
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
)

func DirectoryRecoveryPermission(op string) (string, string, bool) {
	switch op {
	case "directory-operations-list", "directory-operations-view":
		return "integration_operations", "view", true
	case "directory-operations-replay":
		return "integration_operations", "replay", true
	}
	return "", "", false
}
func IsDirectoryRecoveryOperation(op string) bool {
	_, _, ok := DirectoryRecoveryPermission(op)
	return ok
}
func ValidateDirectoryRecoveryInput(op string, i EnterpriseFactsInput) error {
	if !IsDirectoryRecoveryOperation(op) || i.EmployeeUID != "" || i.Search != "" || i.SensitiveAllowed {
		return factsError("people_recovery_input_invalid")
	}
	if op == "directory-operations-list" {
		if i.ID != "" || len(i.Payload) > 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 {
			return factsError("people_recovery_input_invalid")
		}
		return nil
	}
	if integrationoperation.ValidateOperationID(i.ID) != nil || i.Page != 0 || i.PageSize != 0 {
		return factsError("people_recovery_input_invalid")
	}
	if op == "directory-operations-view" {
		if len(i.Payload) > 0 {
			return factsError("people_recovery_input_invalid")
		}
		return nil
	}
	reason := FactsString(i.Payload, "reason")
	if len(i.Payload) != 2 || FactsVersion(i.Payload) == 0 || len([]rune(reason)) < 5 || len([]rune(reason)) > 200 || strings.TrimSpace(reason) != reason || strings.ContainsAny(reason, "\x00\r\n") {
		return factsError("people_recovery_input_invalid")
	}
	return nil
}
