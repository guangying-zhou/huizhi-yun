package console

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestAA04GrantSeedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_AA04_GRANT_TEST_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL socket required")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("isolated socket required")
	}
	cfg := mysql.NewConfig()
	cfg.User, cfg.Net, cfg.Addr, cfg.MultiStatements, cfg.ParseTime = "root", "unix", socket, true, true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := fmt.Sprintf("aa04_grants_%d", time.Now().UnixNano())
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(query string) {
		t.Helper()
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(128),app_code VARCHAR(64),status VARCHAR(20))")
	exec("CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),scope_json JSON,status VARCHAR(20),created_at DATETIME,updated_at DATETIME,last_used_at DATETIME,UNIQUE KEY grant_identity(service_client_id,resource_code,action))")
	exec("INSERT INTO service_clients VALUES(1,'aims.runtime','aims','active'),(2,'aims.runtime','aims','active')")
	exec(`INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(1,'data-runtime:aims','write','{"custom":"retain"}','inactive')`)
	seed, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Seed-v2.5-aims-milestone-receivable-coordinator-grants.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(seed))
	exec(string(seed))
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM service_client_grants").Scan(&count); err != nil || count != 10 {
		t.Fatalf("seed count=%d err=%v", count, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM service_client_grants WHERE service_client_id=1 AND resource_code='data-runtime:aims' AND status='inactive' AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.custom'))='retain'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("existing grant was changed")
	}
	verify, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Verify-v2.5-aims-milestone-receivable-coordinator-grants.sql")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(string(verify))
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]int{}
	for rows.Next() {
		var id int64
		var client, resource, action, status string
		if err := rows.Scan(&id, &client, &resource, &action, &status); err != nil {
			t.Fatal(err)
		}
		statuses[status]++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	if statuses["ACTIVE"] != 9 || statuses["NOT_ACTIVE"] != 1 {
		t.Fatalf("verify statuses=%v", statuses)
	}
	adapter := &Adapter{db: db}
	subject := consumedServiceClient{ServiceClientID: 2, ClientID: "aims.runtime", AppCode: sql.NullString{String: "aims", Valid: true}}
	const scopes = "aims.write altoc:receivable:mark-billable"
	for _, audience := range []string{"data-runtime", "tenant-runtime"} {
		result, err := adapter.authorizeServiceClientScopes(context.Background(), subject, audience, scopes)
		if err != nil || result["scope"] != scopes {
			t.Fatalf("audience %s: result=%v err=%v", audience, result, err)
		}
	}
	if _, err = adapter.authorizeServiceClientScopes(context.Background(), subject, "finance", scopes); err == nil {
		t.Fatal("unregistered audience accepted")
	}
	exec("UPDATE service_client_grants SET status='inactive' WHERE service_client_id=2 AND resource_code='data-runtime:altoc:receivable'")
	if _, err = adapter.authorizeServiceClientScopes(context.Background(), subject, "data-runtime", scopes); err == nil {
		t.Fatal("revoked audience grant accepted")
	}
	if _, err = adapter.authorizeServiceClientScopes(context.Background(), subject, "tenant-runtime", scopes); err != nil {
		t.Fatalf("other audience was changed: %v", err)
	}
}
