package console

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
	"testing"
)

func TestNotificationExternalIdentityResolution(t *testing.T) {
	for _, scenario := range []string{"bound", "missing", "inactive", "database_failure"} {
		t.Run(scenario, func(t *testing.T) {
			db, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			m.ExpectBegin()
			tx, e := db.BeginTx(context.Background(), nil)
			if e != nil {
				t.Fatal(e)
			}
			q := m.ExpectQuery(`SELECT u.status,i.status,i.provider_subject FROM directory_users`).WithArgs("wecom", "u1")
			rows := sqlmock.NewRows([]string{"status", "identity_status", "subject"})
			switch scenario {
			case "bound":
				q.WillReturnRows(rows.AddRow("active", "active", "wecom-u1"))
			case "missing":
				q.WillReturnRows(rows.AddRow("active", nil, nil))
			case "inactive":
				q.WillReturnRows(rows.AddRow("inactive", "active", "wecom-u1"))
			default:
				q.WillReturnError(errors.New("database unavailable"))
			}
			if scenario == "missing" || scenario == "inactive" {
				reason := "external_identity_missing"
				if scenario == "inactive" {
					reason = "recipient_inactive"
				}
				m.ExpectExec(`INSERT INTO portal_notification_deliveries.*WHERE NOT EXISTS`).WithArgs("n1", "u1", "wecom", "wecom", reason, "n1", "u1", "wecom", reason).WillReturnResult(sqlmock.NewResult(1, 1))
			}
			out := map[string]any{"data": map[string]any{}}
			e = resolveNotificationExternalIdentities(context.Background(), tx, canonicalNotification{Recipients: []string{"u1"}}, "n1", "wecom", out)
			if scenario == "database_failure" {
				if e == nil {
					t.Fatal("database failure must not skip")
				}
			} else {
				if e != nil {
					t.Fatal(e)
				}
				r := out["data"].(map[string]any)["externalIdentityResolution"].(map[string]any)
				bound := len(r["recipients"].([]map[string]string))
				skipped := len(r["skipped"].([]map[string]string))
				if scenario == "bound" {
					if bound != 1 || skipped != 0 {
						t.Fatal(r)
					}
				} else {
					if bound != 0 || skipped != 1 {
						t.Fatal(r)
					}
				}
			}
			m.ExpectRollback()
			if e = tx.Rollback(); e != nil && e != sql.ErrTxDone {
				t.Fatal(e)
			}
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestNotificationExternalChannelRejectsMalformedOptInBeforeTransaction(t *testing.T) {
	for _, raw := range []any{"", "email", 7, true, map[string]any{"channel": "wecom"}} {
		db, m, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		body := map[string]any{"sourceAppCode": "enterprise", "createdBy": "enterprise.runtime", "category": "document_share", "severity": "info", "title": "通知", "bizType": "document_share", "idempotencyKey": "share:closed-channel:1", "requestHash": strings.Repeat("a", 64), "metadataJson": "{}", "recipients": []any{"u1"}, "channels": []any{"in_app"}, "resolveExternalChannel": raw}
		_, err = (&Adapter{db: db}).PublishCanonicalNotification(context.Background(), body)
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Code != "notification_channel_invalid" {
			t.Fatalf("expected channel guard, got %v", err)
		}
		if err = m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
