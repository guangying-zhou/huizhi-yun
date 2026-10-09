package altoc

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestServiceTicketDispatchContextReturnsTrustedJoinedCodes(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT\s+st\.\*,.*cu\.code AS customer_code.*ct\.code AS contract_code.*mc\.code AS maintenance_contract_code.*FROM service_ticket st`).
		WithArgs("ST-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "code", "customer_code", "customer_name", "contract_code", "maintenance_contract_code", "resolved_delivery_code", "resolved_service_agreement_code",
		}).AddRow(int64(1), "ST-1", "CU-1", "客户一", "CT-1", "MC-1", "CDA-1", "SA-1"))

	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_scopes", "altoc.read altoc:service_ticket:view")
	query.Set("current_user_data_access", "all")
	ticket, err := adapter.serviceTicketDispatchContext(context.Background(), "ST-1", query)
	if err != nil {
		t.Fatalf("serviceTicketDispatchContext: %v", err)
	}
	if ticket["customer_code"] != "CU-1" || ticket["contract_code"] != "CT-1" || ticket["maintenance_contract_code"] != "MC-1" {
		t.Fatalf("ticket = %#v, want trusted joined codes", ticket)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
