package altoc

import "testing"

func TestActivationProjectPlansGroupLinesByProjectRole(t *testing.T) {
	contract := map[string]any{"code": "CT-001", "name": "综合交付合同"}
	lines := []map[string]any{
		{
			"id":             int64(1),
			"code":           "CL-IMPL",
			"line_type":      "implementation_delivery",
			"name":           "实施服务",
			"project_policy": "required",
			"status":         "active",
		},
		{
			"id":             int64(2),
			"code":           "CL-MAINT",
			"line_type":      "maintenance_support",
			"name":           "维保服务",
			"project_policy": "required",
			"service_policy": "create",
			"status":         "active",
		},
		{
			"id":             int64(3),
			"code":           "CL-LIC",
			"line_type":      "own_software_license",
			"name":           "软件许可",
			"project_policy": "none",
			"status":         "active",
		},
	}
	obligations := []map[string]any{
		{"id": int64(10), "code": "OB-IMPL", "name": "实施验收", "contract_line_id": int64(1), "obligation_type": "acceptance"},
		{"id": int64(11), "code": "OB-MAINT", "name": "服务开通", "contract_line_id": int64(2), "obligation_type": "service"},
	}
	projectLinks := []map[string]any{
		{"project_code": "PRJ-MAINT", "project_role": "maintenance", "plan_key": "project-maintenance", "status": "active"},
	}

	plans := activationProjectPlans(contract, lines, obligations, projectLinks)
	if len(plans) != 2 {
		t.Fatalf("project plan count = %d, want 2: %#v", len(plans), plans)
	}

	implementation := plans[0]
	if implementation["project_role"] != "implementation" || implementation["plan_key"] != "project-implementation" {
		t.Fatalf("implementation plan = %#v", implementation)
	}
	if got := activationStringSlice(implementation["line_codes"]); len(got) != 1 || got[0] != "CL-IMPL" {
		t.Fatalf("implementation line codes = %#v", got)
	}
	if got := activationStringSlice(implementation["obligation_codes"]); len(got) != 1 || got[0] != "OB-IMPL" {
		t.Fatalf("implementation obligation codes = %#v", got)
	}

	maintenance := plans[1]
	if maintenance["project_role"] != "maintenance" || maintenance["project_code"] != "PRJ-MAINT" {
		t.Fatalf("maintenance existing-link plan = %#v", maintenance)
	}
	if got := activationStringSlice(maintenance["line_codes"]); len(got) != 1 || got[0] != "CL-MAINT" {
		t.Fatalf("maintenance line codes = %#v", got)
	}
}
