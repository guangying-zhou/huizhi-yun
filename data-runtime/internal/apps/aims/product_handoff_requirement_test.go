package aims

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

func productHandoffFixture() productcenter.PlanningHandoffInput {
	return productcenter.PlanningHandoffInput{PlanningDeliveryCheck: productcenter.PlanningDeliveryCheck{ItemBizID: "00000000-0000-4000-8000-000000000001", CycleBizID: "00000000-0000-4000-8000-000000000002", ExpectedRevision: 1, ExpectedItemRevision: 1, ExpectedCycleRevision: 1, ExpectedQueueRevision: 1}, ProjectCode: "PRJ", SliceKey: "default", Operation: "link", RequirementID: 88, ScopeSummary: "身份登录", Reason: "安排交付"}
}

func TestProductHandoffTargetEligibility(t *testing.T) {
	for _, tc := range []struct {
		name, category, lifecycle string
		authorized                int64
		stage                     int
		status                    string
		pass                      bool
	}{
		{"wrong-authorized-project", "product_dev", "active", 43, 0, "", false},
		{"non-product-project", "delivery", "active", 42, 0, "", false},
		{"inactive-project", "product_dev", "archived", 42, 0, "", false},
		{"missing-product-binding", "product_dev", "active", 42, 1, "", false},
		{"foreign-requirement", "product_dev", "active", 42, 2, "", false},
		{"deprecated-requirement", "product_dev", "active", 42, 2, "deprecated", false},
		{"baseline-preserved", "product_dev", "active", 42, 2, "baselined", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, m, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			m.ExpectBegin()
			m.ExpectQuery("SELECT id,category,lifecycle_status FROM aims_projects WHERE project_code=\\? FOR UPDATE").WithArgs("PRJ").WillReturnRows(sqlmock.NewRows([]string{"id", "category", "lifecycle_status"}).AddRow(42, tc.category, tc.lifecycle))
			if tc.stage >= 1 {
				q := m.ExpectQuery("SELECT id,version_id FROM aims_project_products WHERE project_id=\\? AND BINARY product_code=\\? FOR UPDATE").WithArgs(int64(42), "P")
				if tc.stage == 1 {
					q.WillReturnError(sql.ErrNoRows)
				} else {
					q.WillReturnRows(sqlmock.NewRows([]string{"id", "version_id"}).AddRow(1, nil))
				}
			}
			if tc.stage == 2 {
				q := m.ExpectQuery("SELECT status FROM requirement_items WHERE id=\\? AND project_id=\\? FOR UPDATE").WithArgs(int64(88), int64(42))
				if tc.status == "" {
					q.WillReturnError(sql.ErrNoRows)
				} else {
					q.WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow(tc.status))
				}
			}
			m.ExpectRollback()
			tx, err := a.DB().BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			id, err := a.resolveProductHandoffRequirementTx(context.Background(), tx, "P", "pm", tc.authorized, productHandoffFixture())
			if tc.pass {
				if err != nil || id != 88 {
					t.Fatalf("linked: %d %v", id, err)
				}
			} else if err == nil {
				t.Fatal("invalid target accepted")
			}
			if err := tx.Rollback(); err != nil {
				t.Fatal(err)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductHandoffRejectsProjectVersionRestriction(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectBegin()
	m.ExpectQuery("SELECT id,category,lifecycle_status FROM aims_projects").WithArgs("PRJ").WillReturnRows(sqlmock.NewRows([]string{"id", "category", "lifecycle_status"}).AddRow(42, "product_dev", "active"))
	m.ExpectQuery("SELECT id,version_id FROM aims_project_products").WithArgs(int64(42), "P").WillReturnRows(sqlmock.NewRows([]string{"id", "version_id"}).AddRow(1, 10))
	m.ExpectRollback()
	tx, err := a.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	input := productHandoffFixture()
	input.PlannedVersionID = 11
	if _, err = a.resolveProductHandoffRequirementTx(context.Background(), tx, "P", "pm", 42, input); err == nil {
		t.Fatal("project version restriction bypassed")
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductHandoffCreatesDraftWithScopeChapterInCallerTransaction(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectBegin()
	m.ExpectQuery("SELECT id,category,lifecycle_status FROM aims_projects").WithArgs("PRJ").WillReturnRows(sqlmock.NewRows([]string{"id", "category", "lifecycle_status"}).AddRow(42, "product_dev", "active"))
	m.ExpectQuery("SELECT id,version_id FROM aims_project_products").WithArgs(int64(42), "P").WillReturnRows(sqlmock.NewRows([]string{"id", "version_id"}).AddRow(1, nil))
	m.ExpectQuery("SELECT project_code FROM aims_projects").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"project_code"}).AddRow("PRJ"))
	m.ExpectQuery("SELECT COALESCE\\(MAX\\(req_number\\), 0\\) FROM requirement_items").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(0))
	m.ExpectQuery("(?s)SELECT id.*FROM work_items.*tier = 'target'.*type = 'requirement'").WithArgs(int64(42)).WillReturnError(sql.ErrNoRows)
	m.ExpectExec("(?s)INSERT INTO requirement_items.*'draft'").WithArgs(int64(42), int64(1), "PRJ-REQ-001", "统一登录", "functional", nil, "P2", "internal", nil, nil, "身份登录", "pm").WillReturnResult(sqlmock.NewResult(88, 1))
	m.ExpectQuery("SELECT COALESCE\\(MAX\\(sort_order\\), -1\\).*FROM requirement_contents").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(-1))
	m.ExpectExec("(?s)INSERT INTO requirement_contents.*'draft'").WithArgs(int64(42), nil, int64(2), "统一登录", "身份登录", int64(0), "pm", "pm").WillReturnResult(sqlmock.NewResult(99, 1))
	m.ExpectExec("UPDATE requirement_contents SET content_original_id").WithArgs(int64(99), int64(99)).WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectExec("(?s)INSERT INTO requirement_item_contents").WithArgs(int64(88), int64(99), "pm").WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectExec("(?s)UPDATE project_documents.*imported_dirty").WithArgs(int64(42)).WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectRollback()
	tx, err := a.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	input := productHandoffFixture()
	input.Operation = "create"
	input.RequirementID = 0
	input.Title = "统一登录"
	id, err := a.resolveProductHandoffRequirementTx(context.Background(), tx, "P", "pm", 42, input)
	if err != nil || id != 88 {
		t.Fatalf("draft: %d %v", id, err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
