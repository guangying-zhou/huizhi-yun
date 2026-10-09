package aims

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductCostReferencesRequireEveryRegisteredProduct(t *testing.T) {
	for _, mode := range []string{"complete", "missing", "case-mismatch", "empty"} {
		t.Run(mode, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			shares := []any{map[string]any{"productCode": "P2", "basisPoints": 3000}, map[string]any{"productCode": "P1", "basisPoints": 5000}}
			if mode == "empty" {
				shares = []any{}
			} else {
				rows := sqlmock.NewRows([]string{"product_code"}).AddRow("P1")
				if mode == "complete" {
					rows.AddRow("P2")
				}
				if mode == "case-mismatch" {
					rows.AddRow("p2")
				}
				mock.ExpectQuery("SELECT product_code FROM product_workspaces.*ORDER BY product_code FOR SHARE").WithArgs("P1", "P2").WillReturnRows(rows)
			}
			command := map[string]any{"actorUid": "U1", "projectCode": "PRJ1", "periodMonth": "2026-09", "expectedRevision": float64(2), "evidenceRef": "review", "shares": shares}
			err = validateProductCostReferences(context.Background(), tx, command)
			if mode == "missing" || mode == "case-mismatch" {
				if !errors.Is(err, errProductCostReferenceMissing) {
					t.Fatalf("%v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			mock.ExpectRollback()
			tx.Rollback()
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
