package workflow

import (
	"context"
	"database/sql"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
)

type Adapter struct {
	db     *sql.DB
	dbName string
}

type DataResult[T any] struct {
	Data T `json:"data"`
}

type SchemaStatus struct {
	App           string   `json:"app"`
	Database      string   `json:"database"`
	Status        string   `json:"status"`
	CheckedTables []string `json:"checkedTables"`
	MissingTables []string `json:"missingTables"`
}

var requiredTables = []string{
	"flow_schemas",
	"form_schemas",
	"flow_action_defs",
	"flow_routes",
	"flow_instances",
	"flow_tasks",
	"flow_actions",
}

func New(cfg config.WorkflowConfig) (*Adapter, error) {
	conn, err := db.Open(cfg.DB)
	if err != nil {
		return nil, err
	}
	return &Adapter{db: conn, dbName: cfg.DB.Database}, nil
}

func (a *Adapter) Ping(ctx context.Context) error {
	return a.db.PingContext(ctx)
}

func (a *Adapter) SchemaStatus(ctx context.Context) (SchemaStatus, error) {
	placeholders := strings.TrimRight(strings.Repeat("?,", len(requiredTables)), ",")
	args := make([]any, 0, len(requiredTables))
	for _, table := range requiredTables {
		args = append(args, table)
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT TABLE_NAME
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return SchemaStatus{}, err
	}
	defer rows.Close()

	existing := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return SchemaStatus{}, err
		}
		existing[table] = true
	}
	if err := rows.Err(); err != nil {
		return SchemaStatus{}, err
	}

	missing := make([]string, 0)
	for _, table := range requiredTables {
		if !existing[table] {
			missing = append(missing, table)
		}
	}

	status := "ok"
	if len(missing) > 0 {
		status = "schema_mismatch"
	}
	return SchemaStatus{
		App:           "workflow",
		Database:      a.dbName,
		Status:        status,
		CheckedTables: requiredTables,
		MissingTables: missing,
	}, nil
}
