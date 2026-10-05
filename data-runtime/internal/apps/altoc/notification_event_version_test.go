package altoc

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestInsertAltocNotificationAuditTxReturnsPersistedAuditID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	expectAltocNotificationAuditInsert(mock, "lead", int64(42), "assign", "u1", int64(7001))

	auditID, err := insertAltocNotificationAuditTx(
		context.Background(),
		tx,
		"lead",
		int64(42),
		"assign",
		map[string]any{"owner_user_id": "u1"},
		map[string]any{"owner_user_id": "u2"},
		"u1",
	)
	if err != nil {
		t.Fatalf("insertAltocNotificationAuditTx: %v", err)
	}
	if auditID != 7001 {
		t.Fatalf("auditID = %d, want 7001", auditID)
	}

	mock.ExpectRollback()
	if err := tx.Rollback(); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestAltocNotificationEventVersionIsStablePerAuditAndDistinctAcrossABA(t *testing.T) {
	firstA := altocNotificationEventVersion(8001)
	retryFirstA := altocNotificationEventVersion(8001)
	b := altocNotificationEventVersion(8002)
	secondA := altocNotificationEventVersion(8003)

	if firstA != "audit:8001" || retryFirstA != firstA {
		t.Fatalf("same audit identity should be stable, got %q and %q", firstA, retryFirstA)
	}
	if firstA == b || firstA == secondA || b == secondA {
		t.Fatalf("distinct audit events must remain distinct: %q %q %q", firstA, b, secondA)
	}

	result := withAltocNotificationEventVersion(map[string]any{
		"changed": true,
		"lead":    map[string]any{"id": int64(42)},
	}, 8001)
	if result["changed"] != true || result["lead"] == nil {
		t.Fatalf("existing mutation result fields changed: %#v", result)
	}
	if result["notification_event_version"] != "audit:8001" {
		t.Fatalf("notification_event_version = %#v, want audit:8001", result["notification_event_version"])
	}
}

func TestCreateLeadReturnsAuditBackedNotificationEventVersion(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM lead WHERE code = \\?").
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	expectAltocTableColumns(mock, "lead",
		"code", "name", "org_name", "source_type", "need_summary", "contact_name",
		"status", "score", "owner_user_id", "next_action", "next_action_due_at", "created_by", "updated_by",
	)
	mock.ExpectExec("INSERT INTO `lead`").WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\) AS count.*TABLE_NAME = \\?").
		WithArgs("sales_task").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	expectAltocNotificationAuditInsert(mock, "lead", int64(42), "create", "u1", int64(7001))
	mock.ExpectQuery("(?s)SELECT \\*.*FROM `lead`.*WHERE id = \\?.*LIMIT 1").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "owner_user_id"}).
			AddRow(int64(42), "LE-1", "新线索", "u2"))
	mock.ExpectCommit()

	result, err := adapter.createLead(context.Background(), map[string]any{
		"name":                     "新线索",
		"org_name":                 "示例客户",
		"source_type":              "tender",
		"need_summary":             "采购需求",
		"contact_name":             "张三",
		"owner_user_id":            "u2",
		"next_action":              "联系客户",
		"next_action_due_at":       "2026-07-11",
		"current_user":             "u1",
		"current_user_data_access": "all",
	})
	if err != nil {
		t.Fatalf("createLead: %v", err)
	}
	if result["id"] != int64(42) || result["notification_event_version"] != "audit:7001" {
		t.Fatalf("unexpected createLead result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateOpportunityReturnsAuditBackedNotificationEventVersion(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT \\*.*FROM customer.*FOR UPDATE").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "owner_user_id", "owner_dept_code", "deleted_at"}).
			AddRow(int64(10), "CU-10", "示例客户", "u1", "D1", nil))
	expectAltocTableColumns(mock, "opportunity_stage", "id", "code", "is_enabled", "is_closed", "win_rate")
	mock.ExpectQuery("(?s)SELECT \\*.*FROM opportunity_stage.*ORDER BY sort_no ASC, id ASC").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "is_enabled", "is_closed", "win_rate"}).
			AddRow(int64(1), "initial_contact", 1, 0, 10))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM opportunity WHERE code = \\?").
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	expectAltocTableColumns(mock, "opportunity",
		"code", "name", "customer_id", "stage_id", "forecast_category", "status", "currency_code",
		"win_rate", "owner_user_id", "next_action", "next_action_due_at", "created_by", "updated_by",
	)
	mock.ExpectExec("INSERT INTO `opportunity`").WillReturnResult(sqlmock.NewResult(81, 1))
	mock.ExpectQuery("(?s)SELECT.*op\\.\\*.*FROM opportunity op.*WHERE op.id = \\?.*LIMIT 1").
		WithArgs(int64(81)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "owner_user_id", "customer_name", "stage_id"}).
			AddRow(int64(81), "OP-1", "新商机", "u2", "示例客户", int64(1)))
	expectAltocTableColumns(mock, "opportunity_stage_log", "opportunity_id", "to_stage_id", "changed_by", "change_reason")
	mock.ExpectExec("INSERT INTO `opportunity_stage_log`").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\) AS count.*TABLE_NAME = \\?").
		WithArgs("sales_task").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	expectAltocNotificationAuditInsert(mock, "opportunity", int64(81), "create", "u1", int64(7002))
	mock.ExpectCommit()

	result, err := adapter.createOpportunity(context.Background(), map[string]any{
		"name":                     "新商机",
		"customer_id":              10,
		"owner_user_id":            "u2",
		"next_action":              "提交方案",
		"next_action_due_at":       "2026-07-11",
		"current_user":             "u1",
		"current_user_data_access": "all",
	})
	if err != nil {
		t.Fatalf("createOpportunity: %v", err)
	}
	if result["id"] != int64(81) || result["notification_event_version"] != "audit:7002" {
		t.Fatalf("unexpected createOpportunity result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestAssignLeadReturnsAuditBackedNotificationEventVersion(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT \\*.*FROM `lead`.*FOR UPDATE").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_user_id", "owner_dept_code", "status", "deleted_at"}).
			AddRow(int64(42), "u1", "D1", "new", nil))
	mock.ExpectQuery("(?s)SELECT COLUMN_NAME.*TABLE_NAME = \\?").
		WithArgs("lead").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).
			AddRow("id").
			AddRow("owner_user_id").
			AddRow("status").
			AddRow("updated_by").
			AddRow("updated_at"))
	mock.ExpectExec("(?s)UPDATE `lead` SET.*owner_user_id = \\?.*status = 'following'.*updated_by = \\?.*updated_at = CURRENT_TIMESTAMP.*WHERE id = \\?").
		WithArgs("u2", "u1", int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAltocNotificationAuditInsert(mock, "lead", int64(42), "update", "u1", int64(7101))
	mock.ExpectQuery("(?s)SELECT \\*.*FROM `lead`.*WHERE id = \\?.*LIMIT 1").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_user_id", "owner_dept_code", "status"}).
			AddRow(int64(42), "u2", "D1", "following"))
	mock.ExpectCommit()

	result, err := adapter.assignLead(context.Background(), "42", map[string]any{
		"current_user":             "u1",
		"current_user_data_access": "all",
		"owner_user_id":            "u2",
	})
	if err != nil {
		t.Fatalf("assignLead: %v", err)
	}
	if result["changed"] != true || result["notification_event_version"] != "audit:7101" {
		t.Fatalf("unexpected assignLead result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestAssignOpportunityReturnsAuditBackedNotificationEventVersion(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT \\*.*FROM opportunity.*FOR UPDATE").
		WithArgs(int64(81)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_user_id", "owner_dept_code", "deleted_at"}).
			AddRow(int64(81), "u1", "D1", nil))
	mock.ExpectExec("(?s)UPDATE opportunity SET owner_user_id = \\?, updated_by = \\?, updated_at = CURRENT_TIMESTAMP WHERE id = \\?").
		WithArgs("u2", "u1", int64(81)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectAltocNotificationAuditInsert(mock, "opportunity", int64(81), "assign", "u1", int64(7201))
	mock.ExpectQuery("(?s)SELECT.*op\\.\\*.*FROM opportunity op.*WHERE op.id = \\?.*LIMIT 1").
		WithArgs(int64(81)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "owner_user_id", "owner_dept_code", "customer_name"}).
			AddRow(int64(81), "u2", "D1", "示例客户"))
	mock.ExpectCommit()

	result, err := adapter.assignOpportunity(context.Background(), "81", map[string]any{
		"current_user":             "u1",
		"current_user_data_access": "all",
		"owner_user_id":            "u2",
	})
	if err != nil {
		t.Fatalf("assignOpportunity: %v", err)
	}
	if result["changed"] != true || result["notification_event_version"] != "audit:7201" {
		t.Fatalf("unexpected assignOpportunity result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func expectAltocNotificationAuditInsert(mock sqlmock.Sqlmock, entityType string, entityID int64, action string, operator string, auditID int64) {
	mock.ExpectQuery("(?s)SELECT COLUMN_NAME.*TABLE_NAME = \\?").
		WithArgs("audit_log").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).
			AddRow("entity_type").
			AddRow("entity_id").
			AddRow("action").
			AddRow("old_value").
			AddRow("new_value").
			AddRow("operator_id"))
	mock.ExpectExec("INSERT INTO `audit_log` \\(`action`, `entity_id`, `entity_type`, `new_value`, `old_value`, `operator_id`\\) VALUES \\(\\?, \\?, \\?, \\?, \\?, \\?\\)").
		WithArgs(action, entityID, entityType, sqlmock.AnyArg(), sqlmock.AnyArg(), operator).
		WillReturnResult(sqlmock.NewResult(auditID, 1))
}

func expectAltocTableColumns(mock sqlmock.Sqlmock, table string, columns ...string) {
	rows := sqlmock.NewRows([]string{"COLUMN_NAME"})
	for _, column := range columns {
		rows.AddRow(column)
	}
	mock.ExpectQuery("(?s)SELECT COLUMN_NAME.*TABLE_NAME = \\?").
		WithArgs(table).
		WillReturnRows(rows)
}
