package altoc

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestAssetsStatusWatermarkSkipsOutOfOrderAndRejectsSameRevisionDifferentHash(t *testing.T) {
	for _, tc := range []struct {
		name                    string
		incoming, applied       uint64
		incomingSHA, appliedSHA string
		wantApply               bool
		wantMismatch            bool
	}{
		{name: "B then A out of order", incoming: 1, applied: 2, incomingSHA: "a", appliedSHA: "b", wantApply: false},
		{name: "same revision same hash", incoming: 2, applied: 2, incomingSHA: "b", appliedSHA: "b", wantApply: false},
		{name: "same revision different hash", incoming: 2, applied: 2, incomingSHA: "evil", appliedSHA: "b", wantMismatch: true},
		{name: "higher revision applies", incoming: 3, applied: 2, incomingSHA: "c", appliedSHA: "b", wantApply: true},
		{name: "first revision applies after lock row materialization", incoming: 1, applied: 0, incomingSHA: "a", appliedSHA: "0000000000000000000000000000000000000000000000000000000000000000", wantApply: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
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
			mock.ExpectExec(`INSERT INTO assets_delivery_status_projection`).WithArgs("CDA-1").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectQuery(`SELECT applied_revision,command_sha256 FROM assets_delivery_status_projection`).WithArgs("CDA-1").WillReturnRows(sqlmock.NewRows([]string{"applied_revision", "command_sha256"}).AddRow(tc.applied, tc.appliedSHA))
			apply, err := claimAssetsStatusRevisionTx(context.Background(), tx, "CDA-1", map[string]any{"sourceRevision": tc.incoming}, tc.incomingSHA)
			if tc.wantMismatch {
				if !errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch) {
					t.Fatalf("error=%v", err)
				}
			} else if err != nil || apply != tc.wantApply {
				t.Fatalf("apply=%v err=%v", apply, err)
			}
			mock.ExpectRollback()
			_ = tx.Rollback()
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
