package aims

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseticket"
	"os"
	"strings"
	"testing"
)

type preparedTicketProbe struct {
	apply func(context.Context, *sql.Tx, string, map[string]any) (bool, error)
}

func (p preparedTicketProbe) Apply(c context.Context, tx *sql.Tx, id string, f map[string]any) (bool, error) {
	return p.apply(c, tx, id, f)
}
func TestUnifiedTicketResultUsesFreshFactsAndRollsBackFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "owning-failure"}[fail], func(t *testing.T) {
			a, m, closeDB := newAimsSQLMockAdapter(t)
			defer closeDB()
			m.ExpectBegin()
			expectUpdatedServiceTicketWorkItemSnapshot(m)
			expectNewServiceTicketDeliveryCommandSnapshot(m)
			if fail {
				m.ExpectRollback()
			} else {
				m.ExpectCommit()
			}
			tx, e := a.DB().BeginTx(context.Background(), nil)
			if e != nil {
				t.Fatal(e)
			}
			called := false
			p := preparedTicketProbe{apply: func(_ context.Context, got *sql.Tx, id string, f map[string]any) (bool, error) {
				called = true
				if got != tx || id != "7" || f["firstRespondedAt"] != "2026-07-10 12:00:00" || f["resolvedAt"] != "2026-07-10 13:00:00" || f["deliveryGeneration"] != int64(1) || f["quotaConsumed"] != 4.5 {
					t.Fatalf("facts/transaction mismatch: %#v", f)
				}
				if fail {
					return false, errors.New("isolated owning failure")
				}
				return true, nil
			}}
			c := enterpriseticket.With(context.Background(), p)
			out, e := a.enqueueServiceTicketDeliveryOperationTx(c, tx, "7", serviceTicketDeliveryOperationBody())
			if !called {
				t.Fatal("owner not called", e)
			}
			if fail {
				if e == nil {
					t.Fatal("owning failure swallowed")
				}
				tx.Rollback()
			} else {
				if e != nil {
					t.Fatal(e)
				}
				if out["serviceTicketDelivery"].(map[string]any)["storage"] != "unified" {
					t.Fatal(out)
				}
				tx.Commit()
			}
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestUnifiedTicketEntriesFreezeIDsBeforeTransaction(t *testing.T) {
	for file, entry := range map[string]string{"enterprise_work_item_state.go": "TransitionEnterpriseWorkItem", "enterprise_work_item_completion.go": "requestEnterpriseWorkItemCompletionTx", "work_item_completion_callback.go": "applyWorkItemCompletionCallbackTx", "work_item_batch.go": "batchUpdateWorkItems"} {
		raw, e := os.ReadFile(file)
		if e != nil {
			t.Fatal(e)
		}
		s := string(raw)
		start := strings.Index(s, "func (a *Adapter) "+entry+"(")
		if start < 0 {
			t.Fatal(file, entry)
		}
		s = s[start:]
		end := strings.Index(s[1:], "\nfunc ")
		if end >= 0 {
			s = s[:end+1]
		}
		marker := strings.Index(s, "ticketTransactionItem(")
		if marker < 0 {
			marker = strings.Index(s, "withTicketTransactionItems(")
		}
		begin := strings.Index(s, "beginBoundEnterpriseTransaction(")
		if begin < 0 {
			begin = strings.Index(s, "beginEnterpriseWrite(")
		}
		if begin < 0 {
			begin = strings.Index(s, "beginDeliverableWrite(")
		}
		if marker < 0 || begin < 0 || marker > begin {
			t.Fatal(file, "pre-lock context missing before transaction")
		}
	}
}
