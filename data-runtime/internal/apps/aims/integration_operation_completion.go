package aims

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type aimsCompletionExecutor interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func aimsCompletionDB(db *sql.DB, tx *sql.Tx) aimsCompletionExecutor {
	if tx != nil {
		return tx
	}
	return db
}
func aimsCompletionRepository(db *sql.DB, trusted integrationoperation.TrustedContext) (*integrationoperation.Repository, error) {
	if trusted.OutboxTables != nil {
		return integrationoperation.NewRepository(db, integrationoperation.WithOutboxTables(*trusted.OutboxTables))
	}
	return integrationoperation.NewRepository(db)
}
func validateAimsCompletionTransaction(db *sql.DB, tx *sql.Tx, trusted integrationoperation.TrustedContext, worker string, now time.Time) error {
	if db == nil || tx == nil || trusted.OutboxTables == nil || trusted.SourceApp != "aims" || strings.TrimSpace(trusted.TenantCode) == "" || strings.TrimSpace(trusted.DeploymentCode) == "" || strings.TrimSpace(worker) == "" || now.IsZero() {
		return fmt.Errorf("registered aims completion transaction context is required")
	}
	return trusted.OutboxTables.Validate()
}

// SucceedIntegrationOperationInTransaction reuses the legacy Aims completion
// algorithm. Caller owns commit/rollback, after external delivery has finished.
// Outbox names come from Registry; source business tables are registered views.
func SucceedIntegrationOperationInTransaction(ctx context.Context, db *sql.DB, tx *sql.Tx, trusted integrationoperation.TrustedContext, worker, operationKey string, body map[string]any, now time.Time) (map[string]any, error) {
	if err := validateAimsCompletionTransaction(db, tx, trusted, worker, now); err != nil {
		return nil, err
	}
	return succeedAimsIntegrationOperation(ctx, db, tx, trusted, worker, operationKey, body, now.UTC())
}

// FailIntegrationOperationInTransaction includes the terminal source checkpoint
// in the same caller-owned transaction as outbox/attempt/dead-letter updates.
func FailIntegrationOperationInTransaction(ctx context.Context, db *sql.DB, tx *sql.Tx, trusted integrationoperation.TrustedContext, worker, operationKey string, body map[string]any, now time.Time) (map[string]any, error) {
	if err := validateAimsCompletionTransaction(db, tx, trusted, worker, now); err != nil {
		return nil, err
	}
	return failAimsIntegrationOperation(ctx, db, tx, trusted, worker, operationKey, body, now.UTC())
}
