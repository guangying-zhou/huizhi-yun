package assets

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func TestProductDocumentProofBindsActorProductAndExpiry(t *testing.T) {
	valid := func() url.Values {
		return url.Values{"current_user": {"u1"}, "current_user_product_document_actor": {"u1"}, "current_user_product_document_id": {"7"}, "current_user_product_document_code": {"P1"}, "current_user_product_document_uuid": {"doc"}, "current_user_product_document_expires": {strconv.FormatInt(time.Now().Add(10*time.Second).UnixMilli(), 10)}}
	}
	for _, key := range []string{"actor", "id", "code", "uuid", "expires"} {
		q := valid()
		q.Set("current_user_product_document_"+key, "")
		if err := requireProductDocumentProofTx(context.Background(), nil, 7, "doc", q); err == nil {
			t.Fatal("missing binding accepted", key)
		}
	}
	for _, duration := range []time.Duration{-time.Second, time.Hour} {
		q := valid()
		q.Set("current_user_product_document_expires", strconv.FormatInt(time.Now().Add(duration).UnixMilli(), 10))
		if err := requireProductDocumentProofTx(context.Background(), nil, 7, "doc", q); err == nil {
			t.Fatal("expiry accepted")
		}
	}
	for _, code := range []string{"P1", "RENAMED"} {
		db, m, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		m.ExpectBegin()
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		m.ExpectQuery(`SELECT product_code FROM product_assets WHERE id=\? FOR UPDATE`).WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"product_code"}).AddRow(code))
		err = requireProductDocumentProofTx(context.Background(), tx, 7, "doc", valid())
		if (err == nil) != (code == "P1") {
			t.Fatalf("identity check %s %v", code, err)
		}
		m.ExpectRollback()
		tx.Rollback()
		if err := m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
