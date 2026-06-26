package aims

import "testing"

func TestProjectCodeFromContractPlan(t *testing.T) {
	tests := []struct {
		name         string
		contractCode string
		planKey      string
		projectRole  string
		want         string
	}{
		{
			name:         "default delivery keeps legacy contract code",
			contractCode: "CT-001",
			planKey:      "delivery-main",
			projectRole:  "delivery",
			want:         "PRJ-CT-001",
		},
		{
			name:         "maintenance plan gets stable suffix",
			contractCode: "CT-001",
			planKey:      "project-maintenance",
			projectRole:  "maintenance",
			want:         "PRJ-CT-001-MAINTENANCE",
		},
		{
			name:         "role is fallback when plan key is missing",
			contractCode: "CT-001",
			projectRole:  "implementation",
			want:         "PRJ-CT-001-IMPLEMENTATION",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := projectCodeFromContractPlan(tt.contractCode, tt.planKey, tt.projectRole); got != tt.want {
				t.Fatalf("projectCodeFromContractPlan() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCategoryForProjectRole(t *testing.T) {
	if got := categoryForProjectRole("maintenance"); got != "maintenance" {
		t.Fatalf("maintenance category = %q", got)
	}
	if got := categoryForProjectRole("development"); got != "product_dev" {
		t.Fatalf("development category = %q", got)
	}
	if got := categoryForProjectRole("implementation"); got != "delivery" {
		t.Fatalf("implementation category = %q", got)
	}
}
