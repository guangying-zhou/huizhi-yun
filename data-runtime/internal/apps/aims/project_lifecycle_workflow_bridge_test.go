package aims_test

import (
	"context"
	"database/sql"
	aims "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	workflow "github.com/huizhi-yun/data-runtime/internal/apps/workflow"
)

func init() {
	aims.ProjectLifecycleWorkflowReaderForDB = func(db *sql.DB) aims.AimsWorkflowInstanceReader { return workflow.NewWithDB(db) }

	aims.ProjectLifecycleWorkflowCreate = func(ctx context.Context, db *sql.DB, body map[string]any) (map[string]any, error) {
		out, err := workflow.NewWithDB(db).CreateInstance(ctx, body)
		if err != nil {
			return nil, err
		}
		return out.Data.(map[string]any), nil
	}
}
