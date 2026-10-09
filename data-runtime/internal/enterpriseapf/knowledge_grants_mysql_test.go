package enterpriseapf

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestAPFKnowledgeGrantCandidateMySQL(t *testing.T) {
	_, db := customerFixture(t)
	ctx := context.Background()
	conn, e := db.Conn(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	for _, q := range []string{
		"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(100),app_code VARCHAR(50),status VARCHAR(20),current_credential_id BIGINT)",
		"CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,status VARCHAR(20))",
		"CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(255),action VARCHAR(50),scope_json JSON,status VARCHAR(20),created_at DATETIME,updated_at DATETIME,UNIQUE(service_client_id,resource_code,action))",
		"INSERT INTO service_client_credentials VALUES(1,'active'),(2,'active'),(3,'active')",
		"INSERT INTO service_clients VALUES(1,'enterprise.runtime','enterprise','active',1),(2,'assets.runtime','assets','active',2),(3,'codocs.runtime','codocs','active',3)",
		"SET @tenant_code='C000001',@enterprise_deployment='host-test',@assets_deployment='assets-test',@codocs_deployment='codocs-test',@runtime_audience='data-runtime'",
	} {
		if _, e = conn.ExecContext(ctx, q); e != nil {
			t.Fatal(e, q)
		}
	}
	seed, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Seed-apf16e-knowledge-links-candidate.sql")
	if e != nil {
		t.Fatal(e)
	}
	verify, e := os.ReadFile("../../../console/docs/sql/Console-SQL-Verify-apf16e-knowledge-links-candidate.sql")
	if e != nil {
		t.Fatal(e)
	}
	clean := func(s string) string {
		lines := []string{}
		for _, line := range strings.Split(s, "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				lines = append(lines, line)
			}
		}
		return strings.Join(lines, "\n")
	}
	apply := func() {
		for _, q := range strings.Split(clean(string(seed)), ";") {
			q = strings.TrimSpace(q)
			if q != "" {
				if _, e = conn.ExecContext(ctx, q); e != nil {
					t.Fatal(e, q)
				}
			}
		}
	}
	check := func(expected bool) {
		var pass bool
		if e = conn.QueryRowContext(ctx, strings.TrimSpace(strings.Split(clean(string(verify)), ";")[0])).Scan(&pass); e != nil || pass != expected {
			t.Fatal("verify", pass, e)
		}
	}
	apply()
	check(true)
	apply()
	check(true)
	var count int
	if e = conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM service_client_grants").Scan(&count); e != nil || count != 4 {
		t.Fatal(count, e)
	}
	if _, e = conn.ExecContext(ctx, "UPDATE service_client_grants SET status='revoked' WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	apply()
	check(false)
	var status string
	if e = conn.QueryRowContext(ctx, "SELECT status FROM service_client_grants WHERE id=1").Scan(&status); e != nil || status != "revoked" {
		t.Fatal("revived", status, e)
	}
}
