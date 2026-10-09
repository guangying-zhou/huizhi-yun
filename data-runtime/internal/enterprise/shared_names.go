package enterprise

// SharedPhysicalNames is the single frozen registry of logical names addressed
// through Resolved.Table. No compatibility view may select one domain for them.
var SharedPhysicalNames = []string{
	"integration_operation", "integration_operation_attempt",
	"integration_operation_dead_letter_actionable", "service_command_receipt",
	"work_item_status_catalog", "workflow_status_catalog",
}

func IsSharedPhysicalName(name string) bool {
	for _, shared := range SharedPhysicalNames {
		if shared == name {
			return true
		}
	}
	return false
}
