package wizbiztool

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"strings"
	"testing"
)

func TestGateFailureRedactsDriverAndObjectValues(t *testing.T) {
	for _, tc := range []struct {
		name  string
		run   func(targetQuery) error
		query string
		want  string
	}{
		{"server", func(q targetQuery) error {
			return CheckTarget(context.Background(), q, Profile{}, enterprise.Binding{})
		}, "SELECT @@server_uuid", "check=server_identity,object=target_database"},
		{"principal", func(q targetQuery) error { return CheckTargetPrivileges(context.Background(), q, Profile{}) }, "SELECT CURRENT_USER", "check=principal,object=target_account"},
		{"baseline", func(q targetQuery) error {
			_, e := baselineTablePresent(context.Background(), q, "private_customer_identifier")
			return e
		}, "SELECT COUNT", "check=baseline_presence_query,object=registered_table"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			m.ExpectQuery(tc.query).WillReturnError(errors.New("password=SECRET SQL personal_identifier"))
			err := tc.run(db)
			if !errors.Is(err, ErrTarget) || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("classification: %v", err)
			}
			for _, v := range []string{"SECRET", "SQL", "personal_identifier", "private_customer_identifier"} {
				if strings.Contains(err.Error(), v) {
					t.Fatal("unredacted diagnostic")
				}
			}
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestPlanGateClassificationPreservesSentinelAndRedactsUnknown(t *testing.T) {
	for _, base := range []error{ErrTarget, ErrProfile, ErrSourceBinding, ErrRuntimeBuild, ErrDependency, ErrConflict, ErrInput} {
		if !errors.Is(planGateFailure(base, "dependencies"), base) {
			t.Fatal("sentinel lost")
		}
	}
	err := planGateFailure(errors.New("password=SECRET SQL personal_identifier"), "dependencies")
	if err.Error() != "migration_target_identity_invalid [check=dependencies,object=plan_gate]" {
		t.Fatal("unsafe diagnostic")
	}
	precise := gateFailure(ErrTarget, "principal", "target_account")
	if planGateFailure(precise, "target_identity") != precise {
		t.Fatal("precise classification lost")
	}
}

func TestWriteFailureKeepsOnlyFixedClassification(t *testing.T) {
	err := writeFailure(errors.New("SECRET SQL bank account"), "object_insert", "bank_account")
	if !errors.Is(err, ErrWrite) || err.Error() != "migration_write_failed [check=object_insert_other,object=bank_account]" {
		t.Fatal("unsafe write diagnostic")
	}
}
