package console

import (
	"context"
	"encoding/json"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

type SystemSchedulerAuditCounts struct {
	Scanned    int `json:"scanned"`
	RolledOver int `json:"rolledOver"`
	Pending    int `json:"pending"`
	Failed     int `json:"failed"`
}

// SystemSchedulerAuditRecord has no personnel, business identity or raw error
// fields. Only the process-local task can use this best-effort audit writer.
type SystemSchedulerAuditRecord struct {
	Task       string                     `json:"task"`
	Principal  string                     `json:"principal"`
	Result     string                     `json:"result"`
	ErrorClass string                     `json:"errorClass,omitempty"`
	Counts     SystemSchedulerAuditCounts `json:"counts"`
	Generation uint64                     `json:"generation"`
	StartedAt  time.Time                  `json:"startedAt"`
	EndedAt    time.Time                  `json:"endedAt"`
	DurationMs int64                      `json:"durationMs"`
}

// AppendSystemSchedulerAudit is not registered as an HTTP operation. The single
// INSERT commits independently of any owning-domain rollover transaction.
func (a *Adapter) AppendSystemSchedulerAudit(ctx context.Context, record SystemSchedulerAuditRecord) error {
	if a == nil || a.db == nil {
		return enterprise.ErrBindingNotFound
	}
	validResult := record.Result == "ok" || record.Result == "item_failures" || record.Result == "unavailable" || record.Result == "cancelled" || record.Result == "generation_stale"
	validClass := record.ErrorClass == "binding_not_found" || record.ErrorClass == "timeout" || record.ErrorClass == "db" || record.ErrorClass == "other"
	if record.Task != enterprise.SystemMilestoneRolloverTask || record.Principal != enterprise.SystemSchedulerPrincipal || record.Generation == 0 || !validResult ||
		(record.Result == "unavailable" && !validClass) || (record.Result != "unavailable" && record.ErrorClass != "") ||
		record.StartedAt.IsZero() || record.EndedAt.Before(record.StartedAt) || record.DurationMs < 0 ||
		record.Counts.Scanned < 0 || record.Counts.RolledOver < 0 || record.Counts.Pending < 0 || record.Counts.Failed < 0 {
		return enterprise.ErrInvalidBinding
	}
	record.StartedAt, record.EndedAt = record.StartedAt.UTC(), record.EndedAt.UTC()
	detail, err := json.Marshal(record)
	if err != nil {
		return err
	}
	_, err = a.db.ExecContext(ctx, `INSERT INTO operation_logs
		(domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at)
		VALUES ('aims','scheduler_round','system_task',NULL,'system',?,NULL,?,UTC_TIMESTAMP())`, enterprise.SystemSchedulerPrincipal, detail)
	return err
}
