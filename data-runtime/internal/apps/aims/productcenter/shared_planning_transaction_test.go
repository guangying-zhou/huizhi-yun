package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestSharedPlanningEarlyValidationAbortsTransaction(t *testing.T) {
	ctx := context.Background()
	id := CommandIdentity{Action: "wrong-action"}
	p := AuthorizationPermit{}
	cases := map[string]func(*sql.Tx) (CommandResult, error){
		"version": func(tx *sql.Tx) (CommandResult, error) {
			return CreateProductCenterVersionInTransaction(ctx, tx, id, p, ProductVersionDraft{})
		},
		"plan": func(tx *sql.Tx) (CommandResult, error) {
			return EditLightweightVersionPlanInTransaction(ctx, tx, id, p, LightweightVersionPlanEdit{})
		},
		"adopt": func(tx *sql.Tx) (CommandResult, error) {
			return CreateLightweightVersionPlanItemInTransaction(ctx, tx, id, p, p, p, p, LightweightVersionPlanItemCreate{})
		},
		"edit": func(tx *sql.Tx) (CommandResult, error) {
			return EditLightweightVersionPlanItemInTransaction(ctx, tx, id, p, LightweightVersionPlanItemEdit{})
		},
		"remove": func(tx *sql.Tx) (CommandResult, error) {
			return DeleteLightweightVersionPlanItemInTransaction(ctx, tx, id, p, LightweightVersionPlanItemDelete{})
		},
		"confirm": func(tx *sql.Tx) (CommandResult, error) {
			return ConfirmLightweightVersionPlanInTransaction(ctx, tx, id, p, p, LightweightVersionPlanConfirm{})
		},
		"handoff": func(tx *sql.Tx) (CommandResult, error) {
			return HandoffPlanningItemInTransaction(ctx, tx, id, p, p, PlanningHandoffInput{}, PlanningHandoffTarget{})
		},
	}
	for name, call := range cases {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectRollback()
			if _, err = call(tx); err == nil {
				t.Fatal("invalid command accepted")
			}
			if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("early failure left caller transaction committable", err)
			}
			if _, err = call(nil); err == nil {
				t.Fatal("nil transaction accepted")
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
