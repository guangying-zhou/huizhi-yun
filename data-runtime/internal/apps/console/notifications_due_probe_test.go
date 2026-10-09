package console

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"strings"
	"testing"
)

func TestEnterpriseDueReceiptProbeNeverCreatesNotification(t *testing.T) {
	for _, found := range []bool{false, true} {
		t.Run(map[bool]string{false: "absent", true: "existing"}[found], func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			a := &Adapter{db: db}
			body := map[string]any{"sourceAppCode": "enterprise", "createdBy": "enterprise.runtime", "category": "reminder", "severity": "warning", "title": "到期", "bizType": "apf_due_checkpoint", "idempotencyKey": "apf-due:sales-due:lead:1:1", "requestHash": strings.Repeat("a", 64), "metadataJson": "{}", "recipients": []any{"Owner"}, "channels": []any{"in_app"}, "probeOnly": true}
			m.ExpectBegin()
			q := m.ExpectQuery("SELECT notification_id,request_hash.*FROM portal_notifications").WithArgs("enterprise", body["idempotencyKey"])
			if found {
				q.WillReturnRows(sqlmock.NewRows([]string{"notification_id", "request_hash"}).AddRow("N1", body["requestHash"]))
			} else {
				q.WillReturnError(sql.ErrNoRows)
			}
			m.ExpectCommit()
			out, e := a.PublishCanonicalNotification(context.Background(), body)
			if e != nil {
				t.Fatal(e)
			}
			data := out["data"].(map[string]any)
			if found {
				if data["notificationId"] != "N1" || data["replayed"] != true {
					t.Fatal(out)
				}
			} else if data["found"] != false {
				t.Fatal(out)
			}
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
			// A body claim cannot turn another app/client into a permitted probe.
			for _, field := range []string{"sourceAppCode", "createdBy", "bizType"} {
				bad := map[string]any{}
				for k, v := range body {
					bad[k] = v
				}
				bad[field] = "other"
				if _, e = a.PublishCanonicalNotification(context.Background(), bad); e == nil {
					t.Fatal("bad probe", field)
				}
			}
		})
	}
}
