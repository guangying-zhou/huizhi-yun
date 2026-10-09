package server

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"log"
	"math/rand/v2"
	"net"
	"time"

	"github.com/go-sql-driver/mysql"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// StartInProcessScheduler is called once by the Runtime process lifecycle, never
// by HTTP. Disabled configurations start no goroutine. Duplicate starts are inert.
func (s *Server) StartInProcessScheduler(parent context.Context) {
	if s.systemMilestoneRollover == nil || !s.cfg.Enterprise.InProcessScheduler.Enabled {
		return
	}
	interval, err := s.cfg.EnterpriseInProcessSchedulerInterval()
	if err != nil {
		return
	} // New rejects this configuration before startup.
	s.inProcessSchedulerMu.Lock()
	defer s.inProcessSchedulerMu.Unlock()
	if s.inProcessSchedulerStarted {
		return
	}
	s.inProcessSchedulerStarted = true
	ctx, cancel := context.WithCancel(parent)
	s.inProcessSchedulerCancel = cancel
	s.inProcessSchedulerDone = make(chan struct{})
	go func() {
		defer close(s.inProcessSchedulerDone)
		runInProcessMilestoneScheduler(ctx, func(ctx context.Context) bool {
			// Up to 5% positive jitter; fixed delay after completion, no queued ticks.
			timer := time.NewTimer(interval + time.Duration(rand.Int64N(int64(interval/20)+1)))
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return false
			case <-timer.C:
				return true
			}
		}, s.systemMilestoneRollover.RolloverDueMilestones, func(result inProcessSchedulerRound) {
			result.Generation = s.cfg.Enterprise.Generation
			s.recordInProcessSchedulerRound(ctx, result)
		})
	}()
}

func (s *Server) stopInProcessScheduler() {
	s.inProcessSchedulerMu.Lock()
	s.inProcessSchedulerStarted = true // Close also fences any later startup.
	cancel, done := s.inProcessSchedulerCancel, s.inProcessSchedulerDone
	s.inProcessSchedulerMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
}

type inProcessSchedulerRound struct {
	Task       string    `json:"task"`
	Principal  string    `json:"principal"`
	Result     string    `json:"result"`
	ErrorClass string    `json:"errorClass,omitempty"`
	Generation uint64    `json:"generation"`
	Scanned    int       `json:"scanned"`
	RolledOver int       `json:"rolledOver"`
	Pending    int       `json:"pending"`
	Failed     int       `json:"failed"`
	DurationMs int64     `json:"durationMs"`
	StartedAt  time.Time `json:"startedAt"`
	EndedAt    time.Time `json:"endedAt"`
}

func (s *Server) recordInProcessSchedulerRound(ctx context.Context, result inProcessSchedulerRound) {
	data, _ := json.Marshal(result)
	log.Printf("[enterprise-scheduler] %s", data)
	// Audit is independent of rollover/generation transactions, including a
	// cancelled round. Bound the detached attempt so shutdown cannot hang on it.
	auditCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	err := s.console.AppendSystemSchedulerAudit(auditCtx, consoleapp.SystemSchedulerAuditRecord{
		Task: result.Task, Principal: result.Principal, Result: result.Result, ErrorClass: result.ErrorClass,
		Counts:     consoleapp.SystemSchedulerAuditCounts{Scanned: result.Scanned, RolledOver: result.RolledOver, Pending: result.Pending, Failed: result.Failed},
		Generation: result.Generation, StartedAt: result.StartedAt, EndedAt: result.EndedAt, DurationMs: result.DurationMs,
	})
	if err != nil {
		failure, _ := json.Marshal(struct {
			Task       string `json:"task"`
			Result     string `json:"result"`
			ErrorClass string `json:"errorClass"`
		}{Task: result.Task, Result: "audit_unavailable", ErrorClass: inProcessSchedulerErrorClass(err)})
		log.Printf("[enterprise-scheduler-audit] %s", failure)
	}
}

// Serial execution is intentional: wait cannot run again until run returns.
// No error messages, item IDs or domain payloads enter the structural log.
func runInProcessMilestoneScheduler(ctx context.Context, wait func(context.Context) bool, run func(context.Context) (map[string]any, error), record func(inProcessSchedulerRound)) {
	for wait(ctx) {
		if ctx.Err() != nil {
			return
		}
		started := time.Now()
		data, err := run(ctx)
		ended := time.Now()
		result := inProcessSchedulerRound{Task: enterprise.SystemMilestoneRolloverTask, Principal: enterprise.SystemSchedulerPrincipal, Result: "ok", DurationMs: ended.Sub(started).Milliseconds(), StartedAt: started.UTC(), EndedAt: ended.UTC()}
		if err != nil {
			switch {
			case errors.Is(err, context.Canceled), ctx.Err() != nil:
				result.Result = "cancelled"
			case errors.Is(err, enterprise.ErrBindingMismatch):
				result.Result = "generation_stale"
			default:
				result.Result = "unavailable"
				result.ErrorClass = inProcessSchedulerErrorClass(err)
			}
		} else {
			result.Scanned, _ = data["scanned"].(int)
			result.RolledOver, _ = data["rolled_over"].(int)
			result.Pending, _ = data["pending"].(int)
			result.Failed, _ = data["failed"].(int)
			if result.Failed > 0 {
				result.Result = "item_failures"
			}
		}
		record(result)
		// The registered generation is immutable for this process. Never retry
		// against a changed generation until a controlled configuration restart.
		if result.Result == "generation_stale" || ctx.Err() != nil {
			return
		}
	}
}

// Only fixed classes enter logs; wrapped driver messages may contain SQL or IDs.
func inProcessSchedulerErrorClass(err error) string {
	if errors.Is(err, enterprise.ErrBindingNotFound) {
		return "binding_not_found"
	}
	var networkError net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout()) {
		return "timeout"
	}
	var databaseError *mysql.MySQLError
	if errors.As(err, &databaseError) || errors.Is(err, driver.ErrBadConn) || errors.Is(err, sql.ErrConnDone) || errors.Is(err, sql.ErrTxDone) {
		return "db"
	}
	return "other"
}
