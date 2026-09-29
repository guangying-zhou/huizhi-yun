// Package migrationlock serializes target migration DDL and activation. MySQL
// named locks survive DDL's implicit commits and belong to one physical session.
package migrationlock

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

func Name(instance, database string) string {
	h := sha256.Sum256([]byte(strings.ToLower(instance) + "/" + database))
	return "hzy-enterprise-" + hex.EncodeToString(h[:16])
}
func Acquire(ctx context.Context, conn *sql.Conn, instance, database string) (func(), error) {
	var held int
	name := Name(instance, database)
	if err := conn.QueryRowContext(ctx, "SELECT GET_LOCK(?,0)", name).Scan(&held); err != nil || held != 1 {
		return nil, errors.New("target migration lock unavailable")
	}
	return func() {
		release, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = conn.ExecContext(release, "SELECT RELEASE_LOCK(?)", name)
	}, nil
}
