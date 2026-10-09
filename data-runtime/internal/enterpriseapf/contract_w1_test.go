package enterpriseapf

import (
	"context"
	"errors"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
	"testing"
)

func TestW1ContractHeaderReadBeforeAndAfterColumns(t *testing.T) {
	for _, kind := range []string{"legacy", "lines", "header"} {
		t.Run(kind, func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			m.ExpectBegin()
			tx, e := db.Begin()
			if e != nil {
				t.Fatal(e)
			}
			r := sqlmock.NewRows([]string{"id", "tax_rate"}).AddRow(1, nil)
			if kind != "legacy" {
				r = sqlmock.NewRows([]string{"id", "tax_rate", "amount_basis"}).AddRow(1, nil, kind)
			}
			m.ExpectQuery(`SELECT \* FROM altoc_contract WHERE id=\? FOR UPDATE`).WithArgs("1").WillReturnRows(r)
			header, e := contractHeaderAmount(context.Background(), tx, "altoc_contract", "1")
			if e != nil || header != (kind == "header") {
				t.Fatal(header, e)
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestW1ContractGuard(t *testing.T) {
	code := func(e error) string {
		var he httperror.Error
		if errors.As(e, &he) && he.Status == 409 {
			return he.Code
		}
		return fmt.Sprint(e)
	}
	followUp := map[string]bool{"contracts-annotate": true, "contracts-complete": true, "contracts-terminate": true}
	ops := []string{"contracts-update", "contract-lines-replace", "payment-terms-replace", "obligations-replace", "obligations-transition", "contracts-sign", "contracts-activate", "contract-projects-bind", "contracts-annotate", "contracts-complete", "contracts-terminate", "contracts-set-owner"}
	for _, op := range ops {
		// Before W1 columns exist both values are empty: existing commands are
		// untouched and the follow-up commands have no contract to apply to.
		for name, state := range map[string][2]string{"legacy": {"", ""}, "native": {"lines", "native"}} {
			want := "<nil>"
			if followUp[op] {
				want = "altoc_contract_operation_not_applicable"
			}
			if got := code(contractW1Guard(op, state[0], state[1])); got != want {
				t.Fatal(name, op, got)
			}
		}
		want := "altoc_contract_historical_operation_denied"
		// Project binding, the follow-up commands and reassigning the owner stay available.
		if op == "contract-projects-bind" || op == "contracts-set-owner" || followUp[op] {
			want = "<nil>"
		} else if op == "contract-lines-replace" {
			want = "altoc_contract_header_lines_locked"
		}
		if got := code(contractW1Guard(op, "header", "historical_import")); got != want {
			t.Fatal("historical", op, got)
		}
		want = "<nil>"
		if op == "contract-lines-replace" {
			want = "altoc_contract_header_lines_locked"
		} else if followUp[op] {
			want = "altoc_contract_operation_not_applicable"
		}
		if got := code(contractW1Guard(op, "header", "native")); got != want {
			t.Fatal("native header", op, got)
		}
	}
	// Every write command is classified above, and only the two closing commands
	// require contract:close; every pre-existing write command is still "edit",
	// so idempotency-key and locking decisions for them are unchanged.
	for _, op := range append(ops, "contracts-create", "contracts-from-quotation") {
		resource, action, ok := ContractPermission(op)
		want := "edit"
		if op == "contracts-complete" || op == "contracts-terminate" {
			want = "close"
		}
		if !ok || resource != "contract" || action != want {
			t.Fatal("permission", op, resource, action)
		}
	}
	for _, op := range []string{"billing-schedules-list", "contract-projects-list"} {
		if _, action, ok := ContractPermission(op); !ok || action != "view" {
			t.Fatal("read permission", op, action)
		}
	}
}

func TestW1ContractFollowUpInput(t *testing.T) {
	v := map[string]any{"expectedVersion": float64(1)}
	with := func(extra map[string]any) map[string]any {
		out := map[string]any{}
		for k, x := range v {
			out[k] = x
		}
		for k, x := range extra {
			out[k] = x
		}
		return out
	}
	valid := map[string]map[string]any{
		"contracts-annotate":  with(map[string]any{"remark": "note", "contact_id": "7"}),
		"contracts-complete":  with(nil),
		"contracts-terminate": with(map[string]any{"reason": "customer cancelled"}),
	}
	for op, payload := range valid {
		if e := ValidateContractInput(op, ContractInput{ID: "1", Payload: payload}); e != nil {
			t.Fatal(op, e)
		}
	}
	// Clearing the contact is allowed.
	if e := ValidateContractInput("contracts-annotate", ContractInput{ID: "1", Payload: with(map[string]any{"contact_id": nil})}); e != nil {
		t.Fatal(e)
	}
	invalid := map[string]ContractInput{
		"annotate without change":   {ID: "1", Payload: with(nil)},
		"annotate status":           {ID: "1", Payload: with(map[string]any{"status": "completed"})},
		"annotate name":             {ID: "1", Payload: with(map[string]any{"name": "renamed"})},
		"annotate numeric contact":  {ID: "1", Payload: with(map[string]any{"contact_id": float64(7)})},
		"annotate rows":             {ID: "1", Payload: with(map[string]any{"remark": "x"}), Rows: []map[string]any{{}}},
		"terminate without reason":  {ID: "1", Payload: with(nil)},
		"terminate empty reason":    {ID: "1", Payload: with(map[string]any{"reason": ""})},
		"terminate without version": {ID: "1", Payload: map[string]any{"reason": "x"}},
		"complete with remark":      {ID: "1", Payload: with(map[string]any{"remark": "x"})},
	}
	ops := map[string]string{"annotate": "contracts-annotate", "terminate": "contracts-terminate", "complete": "contracts-complete"}
	for name, input := range invalid {
		if ValidateContractInput(ops[strings.Fields(name)[0]], input) == nil {
			t.Fatal(name)
		}
	}
}
