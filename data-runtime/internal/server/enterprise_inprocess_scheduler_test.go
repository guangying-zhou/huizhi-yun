package server

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprisescheduler"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestInProcessTimerSingleFlightAndCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ticks := make(chan struct{}, 5)
	entered, release, done := make(chan struct{}, 5), make(chan struct{}), make(chan struct{})
	var runs, waits atomic.Int32
	wait := func(ctx context.Context) bool {
		waits.Add(1)
		select {
		case <-ctx.Done():
			return false
		case <-ticks:
			return true
		}
	}
	go func() {
		defer close(done)
		runInProcessMilestoneScheduler(ctx, wait, func(ctx context.Context) (map[string]any, error) {
			runs.Add(1)
			entered <- struct{}{}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-release:
				return map[string]any{"scanned": 3, "rolled_over": 2, "pending": 1, "failed": 0}, nil
			}
		}, func(inProcessSchedulerRound) {})
	}()
	ticks <- struct{}{}
	<-entered
	for i := 0; i < 4; i++ {
		ticks <- struct{}{}
	}
	// First invocation is blocked. No new wait/round can run concurrently.
	if runs.Load() != 1 || waits.Load() != 1 {
		t.Fatal("overlapping rounds")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancellation did not stop blocked round")
	}
	if runs.Load() != 1 {
		t.Fatal("queued rounds ran after cancellation")
	}
}

func TestInProcessTimerGenerationStopsAndLogsOnlyCounts(t *testing.T) {
	rounds := []inProcessSchedulerRound{}
	runs := 0
	runInProcessMilestoneScheduler(context.Background(), func(context.Context) bool { return true }, func(context.Context) (map[string]any, error) {
		runs++
		if runs == 1 {
			return map[string]any{"scanned": 3, "rolled_over": 2, "pending": 1, "failed": 0, "items": []string{"sensitive"}}, nil
		}
		return nil, enterprise.ErrBindingMismatch
	}, func(r inProcessSchedulerRound) { rounds = append(rounds, r) })
	if runs != 2 || len(rounds) != 2 || rounds[0].RolledOver != 2 || rounds[1].Result != "generation_stale" || rounds[0].Principal != enterprise.SystemSchedulerPrincipal {
		t.Fatal(rounds)
	}
}

func TestInProcessTimerErrorClassIsSanitized(t *testing.T) {
	for _, tc := range []struct {
		name, result, class string
		err                 error
	}{
		{"binding", "unavailable", "binding_not_found", enterprise.ErrBindingNotFound},
		{"deadline", "unavailable", "timeout", context.DeadlineExceeded},
		{"network_timeout", "unavailable", "timeout", &net.DNSError{Err: "secret-sql-business-id", IsTimeout: true}},
		{"mysql", "unavailable", "db", &mysql.MySQLError{Number: 1146, Message: "secret-sql-business-id"}},
		{"bad_conn", "unavailable", "db", driver.ErrBadConn},
		{"closed_conn", "unavailable", "db", sql.ErrConnDone},
		{"closed_tx", "unavailable", "db", sql.ErrTxDone},
		{"unknown", "unavailable", "other", errors.New("secret-sql-business-id")},
		{"stale", "generation_stale", "", enterprise.ErrBindingMismatch},
		{"cancelled", "cancelled", "", context.Canceled},
		{"success", "ok", "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			first := true
			var round inProcessSchedulerRound
			runInProcessMilestoneScheduler(context.Background(), func(context.Context) bool {
				if !first {
					return false
				}
				first = false
				return true
			}, func(context.Context) (map[string]any, error) {
				if tc.err == nil {
					return nil, nil
				}
				return nil, fmt.Errorf("secret-sql-business-id: %w", tc.err)
			}, func(r inProcessSchedulerRound) { round = r })
			if round.Result != tc.result || round.ErrorClass != tc.class {
				t.Fatal(round)
			}
			encoded, err := json.Marshal(round)
			if err != nil || strings.Contains(string(encoded), "secret-sql-business-id") {
				t.Fatal("log contains raw error", err)
			}
			var logged map[string]any
			if err := json.Unmarshal(encoded, &logged); err != nil {
				t.Fatal(err)
			}
			if _, exists := logged["errorClass"]; exists != (tc.result == "unavailable") {
				t.Fatal("errorClass must appear only for unavailable", logged)
			}
		})
	}
}

func TestInProcessAuditFailureDoesNotStopRoundsOrSkipCancelledAudit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := &Server{console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant", db)}
	mock.ExpectExec(`INSERT INTO operation_logs`).WillReturnError(&mysql.MySQLError{Number: 1146, Message: "SELECT secret_sql FROM business_id_123"})
	mock.ExpectExec(`INSERT INTO operation_logs`).WillReturnResult(sqlmock.NewResult(1, 1))
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Audit still attempts an independent, bounded append during shutdown.
	runs, records := 0, 0
	runInProcessMilestoneScheduler(context.Background(), func(context.Context) bool { return runs < 2 }, func(context.Context) (map[string]any, error) {
		runs++
		return map[string]any{"scanned": 1, "rolled_over": 1}, nil
	}, func(r inProcessSchedulerRound) {
		r.Generation = 7
		records++
		s.recordInProcessSchedulerRound(ctx, r)
		if r.Result != "ok" || r.RolledOver != 1 || r.StartedAt.IsZero() || r.EndedAt.Before(r.StartedAt) {
			t.Fatal(r)
		}
	})
	if runs != 2 || records != 2 || !strings.Contains(output.String(), `"result":"audit_unavailable","errorClass":"db"`) || strings.Contains(output.String(), "secret_sql") || strings.Contains(output.String(), "business_id_123") {
		t.Fatal("audit failure changed rounds or leaked error", output.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInProcessSchedulerStartsOnceAndCloseCancels(t *testing.T) {
	s := &Server{cfg: config.Config{Enterprise: config.EnterpriseConfig{Enabled: true, InProcessScheduler: config.EnterpriseInProcessSchedulerConfig{Enabled: true}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {Scheduler: enterprise.PathUnified}}}}, systemMilestoneRollover: &enterprisescheduler.SystemMilestoneRollover{}}
	s.StartInProcessScheduler(context.Background())
	first := s.inProcessSchedulerDone
	s.StartInProcessScheduler(context.Background())
	if first == nil || first != s.inProcessSchedulerDone {
		t.Fatal("duplicate timer")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-first:
	default:
		t.Fatal("close did not wait")
	}
	disabled := &Server{}
	disabled.StartInProcessScheduler(context.Background())
	if disabled.inProcessSchedulerDone != nil {
		t.Fatal("disabled timer started")
	}
}

func TestInProcessOwnerBothRoutesAndOffCompatibility(t *testing.T) {
	for _, path := range []string{enterpriseMilestoneRolloverPath, legacyMilestoneRolloverPath} {
		s := &Server{cfg: config.Config{Enterprise: config.EnterpriseConfig{InProcessScheduler: config.EnterpriseInProcessSchedulerConfig{Enabled: true}}}}
		_, err := s.route(httptest.NewRequest(http.MethodPost, path, nil))
		var domain httperror.Error
		if !errors.As(err, &domain) || domain.Status != 409 || domain.Code != "aims_milestone_rollover_inprocess_owner" {
			t.Fatal(path, err)
		}
		s.cfg.Enterprise.InProcessScheduler.Enabled = false
		if inProcessMilestoneRolloverOwnsPath(path, s.cfg) {
			t.Fatal("off owner changed")
		}
		if path == enterpriseMilestoneRolloverPath {
			_, err = s.routeEnterpriseMilestoneRollover(httptest.NewRequest(http.MethodPost, path, nil))
			if !errors.As(err, &domain) || domain.Code != "enterprise_scheduler_unavailable" {
				t.Fatal("old unavailable result changed", err)
			}
		}
	}
	if inProcessMilestoneRolloverOwnsPath("/v1/aims/service/projects/P1/milestones/7:rollover", config.Config{Enterprise: config.EnterpriseConfig{InProcessScheduler: config.EnterpriseInProcessSchedulerConfig{Enabled: true}}}) {
		t.Fatal("manual rollover intercepted")
	}
}
