package db

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

var ErrEnterpriseStorage = errors.New("enterprise: storage identity, schema, engine or connection verification failed")

// EnterpriseFactory owns credentials in its local closure. They never enter a
// request context or errors. A pool is returned only after identity/schema checks.
func EnterpriseFactory(cfg config.DBConfig, binding enterprise.Binding) enterprise.ConnectionFactory {
	return func(ctx context.Context, storage enterprise.Storage) (*sql.DB, error) {
		expected := binding.Storage
		if !strings.EqualFold(storage.InstanceID, expected.InstanceID) || storage.Database != expected.Database || storage.Address != expected.Address {
			return nil, ErrEnterpriseStorage
		}
		mc := mysqlConfig(cfg)
		mc.Params["time_zone"] = "'+00:00'" // driver applies this SET on every new physical connection
		mc.Timeout = 5 * time.Second
		mc.ReadTimeout = 10 * time.Second
		mc.WriteTimeout = 10 * time.Second
		return openVerifiedEnterprise(ctx, mc, cfg.ConnectionLimit, binding)
	}
}
func openVerifiedEnterprise(ctx context.Context, mc *mysql.Config, limit int, b enterprise.Binding) (*sql.DB, error) {
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return nil, ErrEnterpriseStorage
	}
	db.SetMaxOpenConns(limit)
	db.SetMaxIdleConns(limit)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := verifyEnterpriseStorage(ctx, db, b); err != nil {
		_ = db.Close()
		return nil, ErrEnterpriseStorage
	}
	return db, nil
}
func verifyEnterpriseStorage(ctx context.Context, db *sql.DB, b enterprise.Binding) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return ErrEnterpriseStorage
	}
	defer conn.Close()
	var instance, database, zone string
	if err := conn.QueryRowContext(ctx, `SELECT @@server_uuid,DATABASE(),@@session.time_zone`).Scan(&instance, &database, &zone); err != nil || !strings.EqualFold(instance, b.Storage.InstanceID) || database != b.Storage.Database || zone != "+00:00" {
		return ErrEnterpriseStorage
	}
	var tenant, environment, deployment, version string
	var generation uint64
	if err := conn.QueryRowContext(ctx, `SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1`).Scan(&tenant, &environment, &deployment, &version, &generation); err != nil {
		return ErrEnterpriseStorage
	}
	if tenant != b.Key.Tenant || environment != b.Key.Environment || deployment != b.Key.RuntimeDeployment || version != b.SchemaVersion || generation != b.Generation {
		return ErrEnterpriseStorage
	}
	tables := map[string]bool{"enterprise_schema_registry": true}
	for _, d := range b.Domains {
		for _, table := range d.Tables {
			tables[table] = true
		}
	}
	for table := range tables {
		var engine string
		if err := conn.QueryRowContext(ctx, `SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'`, b.Storage.Database, table).Scan(&engine); err != nil || engine != "InnoDB" {
			return ErrEnterpriseStorage
		}
	}
	return nil
}
