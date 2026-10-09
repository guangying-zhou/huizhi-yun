package enterpriseapf

import (
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAPFGrantCandidatesMySQL(t *testing.T) {
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.MultiStatements = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	name := "hzy_apf_grant_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP DATABASE " + name) })
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	exec := func(q string) {
		t.Helper()
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	exec(`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(80),app_code VARCHAR(30),status VARCHAR(20),current_credential_id BIGINT);
 CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,status VARCHAR(20));
 CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(120),action VARCHAR(30),scope_json JSON,status VARCHAR(20),created_at DATETIME,updated_at DATETIME,UNIQUE KEY uq(service_client_id,resource_code,action));
 INSERT INTO service_clients VALUES(1,'enterprise.runtime','enterprise','active',2);
 INSERT INTO service_client_credentials VALUES(2,1,'active');
 INSERT INTO service_client_grants VALUES(100,1,'data-runtime:console:policy-bundle','read',JSON_OBJECT('keep','unchanged'),'active',NOW(),NOW());`)
	t.Run("apf18-dual-audience-scheduler", func(t *testing.T) {
		seed, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Seed-apf18-enterprise-scheduler.sql")
		if e != nil {
			t.Fatal(e)
		}
		verify, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Verify-apf18-enterprise-scheduler.sql")
		if e != nil {
			t.Fatal(e)
		}
		exec("SET @apf_tenant='C000001',@apf_deployment='C000001-test-enterprise'")
		check := func(expectedFailures int) {
			t.Helper()
			rows, e := db.Query(string(verify))
			if e != nil {
				t.Fatal(e)
			}
			defer rows.Close()
			n, fail := 0, 0
			for rows.Next() {
				var a, d, result string
				if e = rows.Scan(&a, &d, &result); e != nil {
					t.Fatal(e)
				}
				n++
				if result != "PASS" {
					fail++
				}
			}
			if e = rows.Err(); e != nil {
				t.Fatal(e)
			}
			if n != 6 || fail != expectedFailures {
				t.Fatal("verify", n, fail)
			}
		}
		exec(string(seed))
		exec(string(seed))
		check(0)
		exec("UPDATE service_client_grants SET status='revoked' WHERE resource_code='tenant-runtime:people:scheduler'")
		exec(string(seed))
		check(1)
		exec("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.deploymentCode','Other') WHERE resource_code='data-runtime:altoc:scheduler'")
		exec(string(seed))
		check(2)
		var kept string
		if e = db.QueryRow("SELECT JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.keep')) FROM service_client_grants WHERE id=100").Scan(&kept); e != nil || kept != "unchanged" {
			t.Fatal("non-target modified", kept, e)
		}
		// Only this subtest's rows are cleaned; subsequent fixtures start intact.
		exec("DELETE FROM service_client_grants WHERE JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.source'))='seed:apf18'")
	})
	seed, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Seed-v2.34-apf-channels.sql")
	if e != nil {
		t.Fatal(e)
	}
	verify, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Verify-v2.34-apf-channels.sql")
	if e != nil {
		t.Fatal(e)
	}
	for _, aud := range []string{"data-runtime", "tenant-runtime"} {
		t.Run(aud, func(t *testing.T) {
			exec("SET @apf_tenant='C000001',@apf_deployment='C000001-test-enterprise',@apf_audience='" + aud + "'")
			exec(string(seed))
			exec(string(seed))
			rows, e := db.Query(string(verify))
			if e != nil {
				t.Fatal(e)
			}
			n := 0
			for rows.Next() {
				var d, r, a, au, diag string
				var count, ready int
				if e = rows.Scan(&d, &r, &a, &au, &count, &ready, &diag); e != nil {
					t.Fatal(e)
				}
				if count != 1 || ready != 1 {
					t.Fatal(d, r, count, ready)
				}
				n++
			}
			rows.Close()
			if n != 9 {
				t.Fatal(n)
			}
			exec("UPDATE service_client_grants SET status='revoked' WHERE resource_code='" + aud + ":people:scheduler'")
			exec(string(seed))
			var status string
			if e = db.QueryRow("SELECT status FROM service_client_grants WHERE resource_code=?", aud+":people:scheduler").Scan(&status); e != nil || status != "revoked" {
				t.Fatal("revived", status, e)
			}
			var ready int
			if e = db.QueryRow("SELECT COUNT(*) FROM service_client_grants WHERE resource_code LIKE ?", aud+":%").Scan(&ready); e != nil {
				t.Fatal(e)
			}
			expected := 9
			if aud == "data-runtime" {
				expected++
			}
			if ready != expected {
				t.Fatal("duplicate seed", ready)
			}
		})
	}
	var keep string
	t.Run("c2-directory-exact-source", func(t *testing.T) {
		seed, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Seed-apf09c2-enterprise-directory.sql")
		if e != nil {
			t.Fatal(e)
		}
		verify, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Verify-apf09c2-enterprise-directory.sql")
		if e != nil {
			t.Fatal(e)
		}
		exec("SET @apf_tenant='C000001',@apf_deployment='C000001-test-enterprise'")
		exec(string(seed))
		exec(string(seed))
		rows, e := db.Query(string(verify))
		if e != nil {
			t.Fatal(e)
		}
		count := 0
		for rows.Next() {
			var resource, action, result string
			var matching int
			if e := rows.Scan(&resource, &action, &matching, &result); e != nil {
				t.Fatal(e)
			}
			if matching != 1 || result != "PASS" {
				t.Fatal("exact source binding not ready", resource, action, matching, result)
			}
			count++
		}
		if e := rows.Err(); e != nil {
			t.Fatal(e)
		}
		rows.Close()
		if count != 4 {
			t.Fatal("unexpected scope set", count)
		}
		exec("UPDATE service_client_grants SET status='revoked' WHERE resource_code='console:directory-identity' AND action='reserve'")
		exec(string(seed))
		var status string
		if e := db.QueryRow("SELECT status FROM service_client_grants WHERE resource_code='console:directory-identity' AND action='reserve'").Scan(&status); e != nil || status != "revoked" {
			t.Fatal("revoked grant revived", status, e)
		}
	})
	if e = db.QueryRow("SELECT JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.keep')) FROM service_client_grants WHERE id=100").Scan(&keep); e != nil || keep != "unchanged" {
		t.Fatal("non target changed", keep, e)
	}
}
