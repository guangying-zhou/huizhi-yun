package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestEligibleProjectsForContractExactMatchDoesNotScanCustomerPage(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)FROM aims_projects\s+WHERE lifecycle_status <> 'archived' AND customer_code = \? AND contract_code = \?.*LIMIT \?`).
		WithArgs("CU-1", "CT-1", "CT-1", 2).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "customer_code", "contract_code"}).
			AddRow(int64(1), "PRJ-1", "CU-1", "CT-1").
			AddRow(int64(2), "PRJ-2", "CU-1", "CT-1"))

	query := url.Values{}
	query.Set("contract_code", "CT-1")
	query.Set("customer_code", "CU-1")
	query.Set("contract_match", "exact")
	query.Set("limit", "2")
	result, err := adapter.eligibleProjectsForContract(context.Background(), query)
	if err != nil {
		t.Fatalf("eligibleProjectsForContract: %v", err)
	}
	if result["total"] != 2 {
		t.Fatalf("result = %#v, want two exact candidates", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

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
