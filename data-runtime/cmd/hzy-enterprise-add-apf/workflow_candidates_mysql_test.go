package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestAPFCLIWorkflowCandidatesMySQL(t *testing.T) {
	f := fixtureMySQL(t)
	mustExec(t, f.db, `CREATE TABLE flow_action_defs(id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,app_code VARCHAR(30),resource_code VARCHAR(50),action_code VARCHAR(50),name VARCHAR(100),description VARCHAR(500),created_by VARCHAR(50),status TINYINT DEFAULT 1,UNIQUE KEY uk_action(app_code,resource_code,action_code)) ENGINE=InnoDB`)
	mustExec(t, f.db, `CREATE TABLE flow_schemas(id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,code VARCHAR(50) UNIQUE,name VARCHAR(100),nodes JSON,config JSON,created_by VARCHAR(50),status TINYINT DEFAULT 1) ENGINE=InnoDB`)
	mustExec(t, f.db, `CREATE TABLE flow_routes(id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,action_def_id BIGINT UNSIGNED,flow_schema_id BIGINT UNSIGNED,name VARCHAR(100),is_default TINYINT DEFAULT 0,created_by VARCHAR(50),status TINYINT DEFAULT 1,conditions JSON,level TINYINT,priority INT DEFAULT 0) ENGINE=InnoDB`)
	client, e := exec.LookPath("mysql")
	if e != nil {
		client = "/usr/local/mysql/bin/mysql"
		if _, e = os.Stat(client); e != nil {
			t.Fatal("isolated mysql client required")
		}
	}
	run := func(path, params string) error {
		t.Helper()
		raw, e := os.ReadFile(filepath.Join("../../..", path))
		if e != nil {
			t.Fatal(e)
		}
		c := exec.Command(client, "--no-defaults", "--protocol=socket", "--socket="+os.Getenv("HZY_DOMAIN_INSTALL_SOCKET"), "--user=root", "--database="+f.b.Storage.Database)
		c.Stdin = strings.NewReader(params + "\n" + string(raw))
		out, e := c.CombinedOutput()
		if e != nil {
			return &candidateError{string(out)}
		}
		return nil
	}
	peoplePath := "people/docs/sql/APF-Assignments-Workflow-Seed-candidate.sql"
	if run(peoplePath, "SET @apf_people_reviewer_uid='@all',@apf_people_installer_uid='installer';") == nil {
		t.Fatal("automatic reviewer accepted")
	}
	mustExec(t, f.db, "DROP PROCEDURE seed_apf_people_assignment_candidate")
	if run(peoplePath, "SET @apf_people_reviewer_uid='reviewer ',@apf_people_installer_uid='installer';") == nil {
		t.Fatal("padded reviewer accepted")
	}
	// A failed stored procedure intentionally remains for operator inspection.
	mustExec(t, f.db, "DROP PROCEDURE seed_apf_people_assignment_candidate")
	if e = run(peoplePath, "SET @apf_people_reviewer_uid='reviewer',@apf_people_installer_uid='installer';"); e != nil {
		t.Fatal(e)
	}
	if run(peoplePath, "SET @apf_people_reviewer_uid='other',@apf_people_installer_uid='installer';") == nil {
		t.Fatal("existing route overwritten")
	}
	mustExec(t, f.db, "DROP PROCEDURE seed_apf_people_assignment_candidate")
	if e = run("altoc/docs/sql/APF12-Workflow-Seed-candidate.sql", "SET @apf12_reviewer_uid='reviewer',@apf12_installer_uid='installer';"); e != nil {
		t.Fatal(e)
	}
	params := "SET @apf_invoice_reviewer_uid='reviewer',@apf_claim_reviewer_uid='reviewer',@apf_project_expense_reviewer_uid='reviewer',@apf_payment_reviewer_uid='reviewer',@apf_seed_actor_uid='installer';"
	for _, path := range []string{"finance/docs/sql/apf11b-workflow-seed-candidate.sql", "finance/docs/sql/apf13a-workflow-seed-candidate.sql", "finance/docs/sql/apf13b-workflow-seed-candidate.sql"} {
		if e = run(path, params); e != nil {
			t.Fatal(path, e)
		}
	}
	var n int
	if e = f.db.QueryRow("SELECT COUNT(*) FROM flow_routes WHERE status=1 AND is_default=1").Scan(&n); e != nil || n != 7 {
		t.Fatal("missing reviewed routes", n, e)
	}
	if e = f.db.QueryRow("SELECT COUNT(*) FROM flow_schemas WHERE JSON_UNQUOTE(JSON_EXTRACT(nodes,'$[0].assignees[0].uid'))='reviewer' AND JSON_UNQUOTE(JSON_EXTRACT(nodes,'$[0].type'))='approve'").Scan(&n); e != nil || n != 7 {
		t.Fatal("missing human reviewers", n, e)
	}
	mustExec(t, f.db, "UPDATE flow_action_defs SET status=0 WHERE app_code='people' AND resource_code='assignments'")
	if run(peoplePath, "SET @apf_people_reviewer_uid='reviewer',@apf_people_installer_uid='installer';") == nil {
		t.Fatal("inactive definition revived")
	}
	mustExec(t, f.db, "DROP PROCEDURE seed_apf_people_assignment_candidate")
	var status int
	if e = f.db.QueryRow("SELECT status FROM flow_action_defs WHERE app_code='people' AND resource_code='assignments'").Scan(&status); e != nil || status != 0 {
		t.Fatal("inactive status changed", e)
	}
	if e = run("deploy/test-env/APF-WORKFLOW-PREFLIGHT.sql", ""); e != nil {
		t.Fatal(e)
	}
	if e = run("people/docs/sql/APF-Assignments-Workflow-Verify-candidate.sql", ""); e != nil {
		t.Fatal(e)
	}
	if e = f.db.QueryRow("SELECT COUNT(*) FROM flow_action_defs WHERE app_code='people' AND resource_code<>'assignments'").Scan(&n); e != nil || n != 0 {
		t.Fatal("unsupported People tuple", n, e)
	}
}

// All diagnostics here originate from disposable fixture data only.
type candidateError struct{ message string }

func (e *candidateError) Error() string { return e.message }
