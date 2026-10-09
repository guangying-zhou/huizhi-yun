package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Runtime may write the ledger through exactly two statements, on fixed
// columns. Anything else that writes a mig_ table fails this test.
func TestMigrationLedgerWritesAreClosed(t *testing.T) {
	if migrationExceptionUpdate != "UPDATE %s SET status=?,resolution_json=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP(3),row_version=row_version+1 WHERE id=? AND row_version=?" {
		t.Fatal("mig_exception update changed: review W1 §1.5 before changing the column set")
	}
	if migrationIdentityUpdate != "UPDATE %s SET directory_uid=?,match_status=?,match_basis=?,directory_status=?,matched_by=?,matched_at=CURRENT_TIMESTAMP(3) WHERE source_system=? AND source_user_id=? AND match_status=?" {
		t.Fatal("mig_identity_map update changed: review W1 §1.5 before changing the column set")
	}
	// One authoritative permission list: offline tool writes, declarations,
	// installer specification, queue reader, and the two pinned work-state writes.
	// No package-wide business exception and no guessed legacy tool directory.
	allowed := map[string]string{
		"data-runtime/internal/enterprise/domaininstall/finance_receivables.go":   "installer",
		"data-runtime/internal/enterprise/domaininstall/finance_receivables.json": "declaration",
		"data-runtime/internal/enterpriseapf/finance_receivable_readiness.go":     "reader",
		"data-runtime/internal/enterpriseapf/finance_receivables.go":              "reader",
		"data-runtime/cmd/hzy-wizbiz-migrate/":                                    "tool",
		"data-runtime/internal/migrations/wizbiztool/":                            "tool",
		"data-runtime/internal/enterprise/domaininstall/migrationnamespace/":      "declaration",
		"data-runtime/internal/enterprise/domaininstall/w1.go":                    "installer",
		"data-runtime/internal/enterprise/domaininstall/w1_tables.json":           "declaration",
		"data-runtime/internal/config/enterprise.go":                              "declaration",
		"data-runtime/internal/enterpriseapf/migration_events.go":                 "reader",
		"data-runtime/internal/enterpriseapf/migration_queue.go":                  "reader",
		"data-runtime/internal/enterpriseapf/w3_read_metadata.go":                 "reader",
		"data-runtime/internal/enterpriseapf/migration_queue_write.go":            "queue-writer",
	}
	mode := func(path string) string {
		for entry, value := range allowed {
			if path == entry || strings.HasSuffix(entry, "/") && strings.HasPrefix(path, entry) {
				return value
			}
		}
		return ""
	}
	mention := regexp.MustCompile(`\bmig_[a-z][a-z0-9_]*\b`)
	write := regexp.MustCompile("(?is)\\b(INSERT\\s+(IGNORE\\s+)?INTO|REPLACE\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(\\s+TABLE)?|ALTER\\s+TABLE|DROP\\s+TABLE)\\s+[`\"+ ]*mig_")
	root := filepath.Join("..", "..", "..")
	command := exec.Command("git", "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	command.Dir = root
	files, e := command.Output()
	if e != nil {
		t.Fatal("cannot enumerate source files")
	}
	seen := map[string]bool{}
	for _, path := range strings.Split(string(files), "\x00") {
		path = filepath.ToSlash(path)
		if path == "" || seen[path] || strings.HasSuffix(path, "_test.go") || strings.Contains(path, "/test/") || strings.Contains(path, "/tests/") {
			continue
		}
		seen[path] = true
		file := filepath.Join(root, path)
		permission := mode(path)
		check := func(value string) {
			if !mention.MatchString(value) {
				return
			}
			if permission == "" {
				t.Errorf("%s names a ledger table outside the closed list", path)
			} else if permission != "tool" && write.MatchString(value) {
				t.Errorf("%s writes a ledger table outside the offline tool", path)
			}
		}
		switch filepath.Ext(path) {
		case ".go":
			tree, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			ast.Inspect(tree, func(node ast.Node) bool {
				if permission == "queue-writer" {
					if call, ok := node.(*ast.CallExpr); ok {
						if method, ok := call.Fun.(*ast.SelectorExpr); ok && method.Sel.Name == "ExecContext" {
							if len(call.Args) < 2 {
								t.Error("queue SQL missing")
								return true
							}
							sqlArg := call.Args[1]
							pinned := false
							if format, ok := sqlArg.(*ast.CallExpr); ok && len(format.Args) == 2 {
								if f, ok := format.Fun.(*ast.SelectorExpr); ok && f.Sel.Name == "Sprintf" {
									if name, ok := format.Args[0].(*ast.Ident); ok {
										pinned = name.Name == "migrationExceptionUpdate" || name.Name == "migrationIdentityUpdate"
									}
								}
							}
							if !pinned {
								// Other writes may only name the owning domain's
								// audit/contact tables, never ledger aliases.
								allowedDomainWrite := true
								ast.Inspect(sqlArg, func(n ast.Node) bool {
									if name, ok := n.(*ast.Ident); ok && name.Name != "audit" && name.Name != "contacts" {
										allowedDomainWrite = false
									}
									return true
								})
								if !allowedDomainWrite {
									t.Error("queue writer bypasses pinned ledger statements")
								}
							}
						}
					}
				}
				literal, ok := node.(*ast.BasicLit)
				if ok && literal.Kind == token.STRING {
					value, err := strconv.Unquote(literal.Value)
					if err == nil {
						check(value)
					}
				}
				return true
			})
		case ".ts", ".mjs", ".js", ".json":
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if permission != "declaration" {
				check(string(raw))
			}
		}
	}
	// A new business file cannot inherit a neighbouring queue exception.
	for _, path := range []string{"data-runtime/internal/enterpriseapf/migration_queue_new.go", "data-runtime/internal/wizbizmigrate/anything.go", "enterprise/server/utils/migrationReader.ts"} {
		if mode(path) != "" {
			t.Fatal("unreviewed file inherited ledger access")
		}
	}

	// The W3 detail reader may name closed ledger tables, but cannot execute
	// mutations even when the physical table names come from the Registry.
	detail, err := os.ReadFile("w3_read_metadata.go")
	if err != nil {
		t.Fatal(err)
	}
	if regexp.MustCompile(`(?i)\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\s|\.Exec(Context)?\(`).Match(detail) || strings.Contains(string(detail), "enterprise.Write") {
		t.Fatal("W3 detail projection must remain read-only")
	}
	// The queue files reach the two work-state tables for writing only through
	// the two pinned statements, and never format another statement around them.
	raw, e := os.ReadFile("migration_queue_write.go")
	if e != nil {
		t.Fatal(e)
	}
	source := string(raw)
	if strings.Count(source, "fmt.Sprintf(migrationExceptionUpdate,") != 1 || strings.Count(source, "fmt.Sprintf(migrationIdentityUpdate,") != 1 {
		t.Fatal("pinned ledger updates must each be used exactly once")
	}
	for _, forbidden := range []string{"mig_source_row SET", "mig_object_map", "mig_batch"} {
		if strings.Contains(source, forbidden) {
			t.Fatal("queue writes touch an evidence table:", forbidden)
		}
	}
	read, e := os.ReadFile("migration_queue.go")
	if e != nil {
		t.Fatal(e)
	}
	if regexp.MustCompile(`(?i)\b(INSERT|UPDATE|DELETE|REPLACE)\b`).MatchString(string(read)) {
		t.Fatal("the read file contains a write statement")
	}
}

func migrationQueueFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	s, db := customerFixture(t)
	ctx := context.Background()
	for _, table := range domaininstall.W1Tables("w1-migration-ledger") {
		if _, e := db.Exec(table.DDL); e != nil {
			t.Fatal(table.Logical, e)
		}
	}
	b, e := domaininstall.WithW1(s.binding, "w1-migration-ledger", "host-test")
	if e != nil {
		t.Fatal(e)
	}
	// Finance handles its own queue items, so its write path and audit log exist too.
	var present int
	if e = db.QueryRow("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='finance_audit_log'").Scan(&present); e != nil {
		t.Fatal(e)
	}
	if present == 0 {
		tables, _ := domaininstall.APFTables("finance")
		for _, table := range tables {
			if _, e = db.Exec(table.DDL); e != nil {
				t.Fatal(table.Logical, e)
			}
		}
	}
	finance := b.Domains["finance"]
	finance.Write = enterprise.PathUnified
	b.Domains["finance"] = finance
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(ctx, b); e != nil {
		t.Fatal(e)
	}
	if s, e = New(registry, b); e != nil {
		t.Fatal(e)
	}
	s.ConfigureOwnerDirectory(testOwnerDirectory)
	t.Cleanup(setTestOwners([]string{"nobody"}, false))
	for _, q := range []string{
		"INSERT INTO mig_batch(id,batch_code,source_system,source_snapshot,scope_json,plan_sha256,status,operator) VALUES(1,'W1','wizbiz','snapshot','{}',REPEAT('0',64),'applied','tool')",
		`INSERT INTO mig_source_row(source_system,source_table,source_pk,source_snapshot,first_batch_id,row_json,row_sha256,captured_at) VALUES
			('wizbiz','wb_contactman','11','snapshot',1,'{"cm_name":"Marked Zhang","department":"Sales","post":null,"phone":"010-0000","mobile":"13800000001","mobile2":null,"stars":"3","chief":"1","employee_id":"7","address":"Marked street","weixin_number":"marked-wx","remarks":null}',REPEAT('a',64),CURRENT_TIMESTAMP(3)),
			('wizbiz','wb_contactman','12','snapshot',1,'{"cm_name":"Other Li","department":null,"post":null,"phone":null,"mobile":"13900000002","mobile2":null,"stars":"9","chief":"0","employee_id":"8","address":null,"weixin_number":null,"remarks":null}',REPEAT('b',64),CURRENT_TIMESTAMP(3)),
			('wizbiz','wb_contactman','13','snapshot',1,JSON_OBJECT('cm_name',REPEAT('x',120),'mobile','13700000003','chief','0','stars','1'),REPEAT('c',64),CURRENT_TIMESTAMP(3))`,
		`INSERT INTO mig_identity_map(source_system,source_user_id,display_name,directory_uid,match_status,match_basis) VALUES
			('wizbiz','employee:7','Marked Owner','second','candidate','name_unique'),('wizbiz','employee:8','Second Owner',NULL,'unmatched',NULL),('wizbiz','employee:9','Gone',NULL,'source_missing',NULL)`,
		`INSERT INTO mig_exception(id,batch_id,owning_domain,kind,source_table,source_pk,target_table,target_key,detail_json) VALUES
			(1,1,'altoc','contact_without_customer','wb_contactman','11',NULL,NULL,'{"sourceUserId":"7"}'),
			(2,1,'altoc','contact_without_customer','wb_contactman','12',NULL,NULL,'{"sourceUserId":"8"}'),
			(3,1,'altoc','contact_without_customer','wb_contactman','13',NULL,NULL,'{"sourceUserId":null}'),
			(4,1,'altoc','effective_amount_exceeds_total','wb_contract','3','altoc_contract','CT-W000003','{"totalAmount":"100.00","effectiveAmount":"120.00"}'),
			(5,1,'altoc','contact_orphan','wb_contract','4','altoc_contract','CT-W000004','{"sourceContactId":"99"}'),
			(6,1,'altoc','owner_unmatched','wb_organization','5','altoc_customer','CU-W000005','{"sourceUserId":"7"}'),
			(7,1,'finance','contract_balance_mismatch','wb_contract','3','altoc_contract','CT-W000003','{"recomputedAmount":"10.00","cachedAmount":"12.00","difference":"2.00"}'),
			(8,1,'finance','balance_without_account','wb_account_balance','date:2024-01-31',NULL,NULL,'{"balanceDate":"2024-01-31","entryCount":"3","latestAmounts":["1.00"],"sourceEntryIds":["1"]}')`,
		"INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(1,'C1','own customer','person'),(2,'C2','foreign customer','second')",
		"INSERT INTO altoc_contact(id,code,customer_id,name,mobile,owner_uid) VALUES(21,'CN21',1,'Other Li','13900000002','person'),(22,'CN22',2,'Foreign contact',NULL,'second')",
	} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	return s, db
}

func TestAPFW3MigrationQueueWritesMySQL(t *testing.T) {
	s, db := migrationQueueFixture(t)
	ctx := context.Background()
	self := altoc.BasicReadScope{Access: "self"}
	n := 0
	who := func(key string) Identity {
		if key == "" {
			n++
			key = fmt.Sprint("queue-", n)
		}
		return Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: key, RequestID: key}
	}
	resolve := func(domain, key string, i MigrationResolveInput) (map[string]any, error) {
		v, e := s.MigrationResolve(ctx, domain, i, who(key))
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	refused := func(e error, status int, code string) {
		t.Helper()
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != status || he.Code != code {
			t.Fatal("expected", status, code, "got", e)
		}
	}
	state := func(id int) (string, int, string) {
		t.Helper()
		var status string
		var version int
		var resolution sql.NullString
		if e := db.QueryRow("SELECT status,row_version,resolution_json FROM mig_exception WHERE id=?", id).Scan(&status, &version, &resolution); e != nil {
			t.Fatal(e)
		}
		return status, version, resolution.String
	}
	var evidence string
	digest := func() string {
		t.Helper()
		var a, b, c string
		if e := db.QueryRow("SELECT COALESCE(SUM(CRC32(CONCAT_WS('|',id,source_table,source_pk,row_sha256,CAST(row_json AS CHAR)))),0) FROM mig_source_row").Scan(&a); e != nil {
			t.Fatal(e)
		}
		if e := db.QueryRow("SELECT COALESCE(SUM(CRC32(CONCAT_WS('|',id,batch_id,owning_domain,kind,source_table,source_pk,COALESCE(target_table,''),COALESCE(target_key,''),CAST(detail_json AS CHAR),created_at))),0) FROM mig_exception").Scan(&b); e != nil {
			t.Fatal(e)
		}
		if e := db.QueryRow("SELECT CONCAT((SELECT COUNT(*) FROM mig_exception),'/',(SELECT COUNT(*) FROM mig_identity_map),'/',(SELECT COUNT(*) FROM mig_source_row),'/',(SELECT COUNT(*) FROM mig_object_map),'/',(SELECT COALESCE(SUM(CRC32(CONCAT_WS('|',source_user_id,display_name))),0) FROM mig_identity_map))").Scan(&c); e != nil {
			t.Fatal(e)
		}
		return a + ":" + b + ":" + c
	}
	evidence = digest()

	// accept / reopen, with the reason rule and version protection.
	_, e := resolve("altoc", "", MigrationResolveInput{ID: "4", ExpectedVersion: 1, Method: "accept"})
	refused(e, 400, "migration_queue_input_invalid")
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "4", ExpectedVersion: 9, Method: "accept", Reason: "confirmed by sales"})
	refused(e, 409, "migration_exception_version_conflict")
	out, e := resolve("altoc", "accept-4", MigrationResolveInput{ID: "4", ExpectedVersion: 1, Method: "accept", Reason: "confirmed by sales"})
	if e != nil || out["status"] != "accepted" {
		t.Fatal(out, e)
	}
	if status, version, resolution := state(4); status != "accepted" || version != 2 || !strings.Contains(resolution, "confirmed by sales") || !strings.Contains(resolution, `"by": "person"`) && !strings.Contains(resolution, `"by":"person"`) {
		t.Fatal("accept state", status, version, resolution)
	}
	// Same key again: first result, nothing written.
	if out, e = resolve("altoc", "accept-4", MigrationResolveInput{ID: "4", ExpectedVersion: 1, Method: "accept", Reason: "confirmed by sales"}); e != nil || out["status"] != "accepted" {
		t.Fatal("replay", out, e)
	}
	if _, version, _ := state(4); version != 2 {
		t.Fatal("replay wrote again", version)
	}
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "4", ExpectedVersion: 2, Method: "accept", Reason: "again"})
	refused(e, 409, "migration_exception_state_conflict")
	if out, e = resolve("altoc", "", MigrationResolveInput{ID: "4", ExpectedVersion: 2, Method: "reopen"}); e != nil || out["status"] != "open" {
		t.Fatal("reopen", out, e)
	}
	// mark_done only where the fix happens on the object itself.
	if out, e = resolve("altoc", "", MigrationResolveInput{ID: "5", ExpectedVersion: 1, Method: "mark_done"}); e != nil || out["status"] != "resolved" {
		t.Fatal("mark_done", out, e)
	}
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "4", ExpectedVersion: 3, Method: "mark_done"})
	refused(e, 409, "migration_exception_method_not_applicable")
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "6", ExpectedVersion: 1, Method: "accept"})
	refused(e, 409, "migration_exception_method_not_applicable")

	// Domains do not see or handle each other's items; phase-one read-only kinds stay closed.
	_, e = resolve("finance", "", MigrationResolveInput{ID: "4", ExpectedVersion: 3, Method: "accept", Reason: "x"})
	refused(e, 404, "migration_exception_not_found")
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "8", ExpectedVersion: 1, Method: "accept"})
	refused(e, 404, "migration_exception_not_found")
	_, e = resolve("finance", "", MigrationResolveInput{ID: "7", ExpectedVersion: 1, Method: "accept"})
	refused(e, 409, "migration_exception_method_not_applicable")
	if out, e = resolve("finance", "", MigrationResolveInput{ID: "8", ExpectedVersion: 1, Method: "accept"}); e != nil || out["status"] != "accepted" {
		t.Fatal("finance accept", out, e)
	}
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "404", ExpectedVersion: 1, Method: "accept"})
	refused(e, 404, "migration_exception_not_found")
	var audits int
	if e = db.QueryRow("SELECT (SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='migration_exception')+(SELECT COUNT(*) FROM finance_audit_log WHERE entity_type='migration_exception')").Scan(&audits); e != nil || audits != 4 {
		t.Fatal("queue audits", audits, e)
	}

	// assign_customer: the contact is built from the ledger row and created through
	// the normal path, in one transaction with the queue item.
	assign := MigrationResolveInput{ID: "1", ExpectedVersion: 1, Method: "assign_customer", CustomerID: "1", CustomerScope: &self}
	// Out of the caller's customer scope: nothing is created, the item stays open.
	foreign := assign
	foreign.CustomerID = "2"
	_, e = resolve("altoc", "", foreign)
	refused(e, 403, "altoc_customer_scope_denied")
	if status, version, _ := state(1); status != "open" || version != 1 {
		t.Fatal("item changed by a refused assign", status, version)
	}
	out, e = resolve("altoc", "assign-1", assign)
	if e != nil || out["status"] != "resolved" {
		t.Fatal("assign", out, e)
	}
	code := fmt.Sprint(out["contactCode"])
	var name, dept, mobile, wechat, address, owner string
	var key int
	var stars sql.NullInt64
	if e = db.QueryRow("SELECT name,COALESCE(dept_name,''),COALESCE(mobile,''),COALESCE(wechat,''),COALESCE(mailing_address,''),COALESCE(owner_uid,''),is_key_contact,star_level FROM altoc_contact WHERE code=? AND customer_id=1", code).Scan(&name, &dept, &mobile, &wechat, &address, &owner, &key, &stars); e != nil {
		t.Fatal(e)
	}
	if !strings.HasPrefix(code, "CN-") || name != "Marked Zhang" || dept != "Sales" || mobile != "13800000001" || wechat != "marked-wx" || address != "Marked street" || key != 1 || stars.Int64 != 3 {
		t.Fatal("created contact", code, name, dept, mobile, wechat, address, owner, key, stars)
	}
	if status, version, resolution := state(1); status != "resolved" || version != 2 || !strings.Contains(resolution, code) {
		t.Fatal("assign state", status, version, resolution)
	}
	// Replay returns the same contact and creates nothing.
	if out, e = resolve("altoc", "assign-1", assign); e != nil || fmt.Sprint(out["contactCode"]) != code {
		t.Fatal("assign replay", out, e)
	}
	var contacts int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_contact WHERE customer_id=1").Scan(&contacts); e != nil || contacts != 2 {
		t.Fatal("contacts after replay", contacts, e)
	}
	// A second, different command on the resolved item is refused.
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "1", ExpectedVersion: 2, Method: "assign_customer", CustomerID: "1", CustomerScope: &self})
	refused(e, 409, "migration_exception_state_conflict")

	// Duplicate (same name and mobile under the customer): refused, nothing created.
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "2", ExpectedVersion: 1, Method: "assign_customer", CustomerID: "1", CustomerScope: &self})
	refused(e, 409, "migration_contact_duplicate")
	if status, _, _ := state(2); status != "open" {
		t.Fatal("duplicate changed the item", status)
	}
	// ... and is then linked to the existing contact instead.
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "2", ExpectedVersion: 1, Method: "link_existing", CustomerID: "1", ContactCode: "CN22", CustomerScope: &self})
	refused(e, 409, "migration_contact_invalid")
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "2", ExpectedVersion: 1, Method: "link_existing", CustomerID: "2", ContactCode: "CN22", CustomerScope: &self})
	refused(e, 403, "altoc_customer_scope_denied")
	if out, e = resolve("altoc", "", MigrationResolveInput{ID: "2", ExpectedVersion: 1, Method: "link_existing", CustomerID: "1", ContactCode: "CN21", CustomerScope: &self}); e != nil || out["status"] != "resolved" || out["contactCode"] != "CN21" {
		t.Fatal("link", out, e)
	}
	// A source value the contact model cannot hold is not truncated.
	_, e = resolve("altoc", "", MigrationResolveInput{ID: "3", ExpectedVersion: 1, Method: "assign_customer", CustomerID: "1", CustomerScope: &self})
	refused(e, 409, "migration_contact_source_invalid")
	// Keep-unassigned and reopen for a contact.
	if out, e = resolve("altoc", "", MigrationResolveInput{ID: "3", ExpectedVersion: 1, Method: "accept"}); e != nil || out["status"] != "accepted" {
		t.Fatal("keep unassigned", out, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_contact").Scan(&contacts); e != nil || contacts != 3 {
		t.Fatal("contacts", contacts, e)
	}

	// Closed input.
	for name, in := range map[string]MigrationResolveInput{
		"unknown method":        {ID: "4", ExpectedVersion: 3, Method: "delete"},
		"assign without scope":  {ID: "4", ExpectedVersion: 3, Method: "assign_customer", CustomerID: "1"},
		"assign without target": {ID: "4", ExpectedVersion: 3, Method: "assign_customer", CustomerScope: &self},
		"accept with customer":  {ID: "4", ExpectedVersion: 3, Method: "accept", CustomerID: "1", CustomerScope: &self},
		"link without contact":  {ID: "4", ExpectedVersion: 3, Method: "link_existing", CustomerID: "1", CustomerScope: &self},
		"accept with contact":   {ID: "4", ExpectedVersion: 3, Method: "accept", ContactCode: "CN21"},
		"no version":            {ID: "4", Method: "accept"},
		"scope none":            {ID: "4", ExpectedVersion: 3, Method: "assign_customer", CustomerID: "1", CustomerScope: &altoc.BasicReadScope{Access: "none"}},
		"non numeric id":        {ID: "x", ExpectedVersion: 1, Method: "accept"},
	} {
		if _, e = resolve("altoc", "", in); e == nil {
			t.Fatal(name)
		}
	}
	if _, e = resolve("finance", "", MigrationResolveInput{ID: "8", ExpectedVersion: 2, Method: "assign_customer", CustomerID: "1", CustomerScope: &self}); e == nil {
		t.Fatal("finance touched a customer")
	}
	if _, e = s.MigrationResolve(ctx, "altoc", MigrationResolveInput{ID: "4", ExpectedVersion: 3, Method: "accept", Reason: "x"}, Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime"}); e == nil {
		t.Fatal("write without idempotency key")
	}

	// Identity decisions.
	decide := func(op string, i MigrationIdentityInput) (map[string]any, error) {
		v, e := s.MigrationIdentityDecision(ctx, op, i, who(""))
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	_, e = decide("migration-identities-confirm", MigrationIdentityInput{SourceUserID: "employee:7", ExpectedStatus: "candidate", DirectoryUID: "person"})
	refused(e, 409, "migration_identity_self_match")
	_, e = decide("migration-identities-confirm", MigrationIdentityInput{SourceUserID: "employee:7", ExpectedStatus: "candidate", DirectoryUID: "nobody"})
	refused(e, 409, "migration_identity_target_invalid")
	_, e = decide("migration-identities-confirm", MigrationIdentityInput{SourceUserID: "employee:7", ExpectedStatus: "unmatched", DirectoryUID: "second"})
	refused(e, 409, "migration_identity_state_conflict")
	_, e = decide("migration-identities-confirm", MigrationIdentityInput{SourceUserID: "employee:9", ExpectedStatus: "candidate", DirectoryUID: "second"})
	refused(e, 409, "migration_identity_state_conflict")
	_, e = decide("migration-identities-confirm", MigrationIdentityInput{SourceUserID: "employee:404", ExpectedStatus: "candidate", DirectoryUID: "second"})
	refused(e, 404, "migration_identity_not_found")
	if out, e = decide("migration-identities-confirm", MigrationIdentityInput{SourceUserID: "employee:7", ExpectedStatus: "candidate", DirectoryUID: "second"}); e != nil || out["match_status"] != "confirmed" {
		t.Fatal("confirm", out, e)
	}
	var status, uid, basis, by string
	if e = db.QueryRow("SELECT match_status,directory_uid,match_basis,matched_by FROM mig_identity_map WHERE source_user_id='employee:7'").Scan(&status, &uid, &basis, &by); e != nil || status != "confirmed" || uid != "second" || basis != "manual" || by != "person" {
		t.Fatal("confirmed row", status, uid, basis, by, e)
	}
	// Same decision again answers without writing; the audit trail has one row.
	if _, e = decide("migration-identities-confirm", MigrationIdentityInput{SourceUserID: "employee:7", ExpectedStatus: "candidate", DirectoryUID: "second"}); e != nil {
		t.Fatal("repeat confirm", e)
	}
	if out, e = decide("migration-identities-reject", MigrationIdentityInput{SourceUserID: "employee:8", ExpectedStatus: "unmatched"}); e != nil || out["match_status"] != "rejected" {
		t.Fatal("reject", out, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='migration_identity'").Scan(&audits); e != nil || audits != 2 {
		t.Fatal("identity audits", audits, e)
	}
	for name, in := range map[string]MigrationIdentityInput{
		"bare id":         {SourceUserID: "7", ExpectedStatus: "candidate", DirectoryUID: "second"},
		"reserved target": {SourceUserID: "employee:8", ExpectedStatus: "rejected", DirectoryUID: "system:unassigned"},
		"no target":       {SourceUserID: "employee:8", ExpectedStatus: "rejected"},
	} {
		if _, e = decide("migration-identities-confirm", in); e == nil {
			t.Fatal(name)
		}
	}
	if _, e = decide("migration-identities-reject", MigrationIdentityInput{SourceUserID: "employee:8", ExpectedStatus: "rejected", DirectoryUID: "second"}); e == nil {
		t.Fatal("reject with target")
	}

	// Nothing but the fixed work-state columns changed anywhere in the ledger.
	if after := digest(); after != evidence {
		t.Fatal("ledger evidence changed", evidence, after)
	}
}

// Reassigning a contract's owner, for native and imported contracts.
func TestAPFW3ContractSetOwnerMySQL(t *testing.T) {
	s, db := migrationQueueFixture(t)
	ctx := context.Background()
	for _, q := range []string{
		"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,owner_dept_code,status,legal_status) VALUES(1,'CT1','native',1,'person','D1','effective','effective'),(2,'CT2','imported',1,'system:unassigned',NULL,'completed','closed'),(3,'CT3','foreign',2,'second','D2','draft','draft')",
		"UPDATE altoc_contract SET amount_basis='header',origin_type='historical_import',imported_batch_code='W1',tax_rate=NULL,amount_tax_inclusive=888 WHERE id=2",
	} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	call := func(key, id string, scope altoc.BasicReadScope, payload map[string]any) (map[string]any, error) {
		who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: key, RequestID: key}
		v, e := s.Contract(ctx, "contracts-set-owner", ContractInput{ID: id, Payload: payload}, who, scope)
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	refused := func(e error, status int, code string) {
		t.Helper()
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != status || he.Code != code {
			t.Fatal("expected", status, code, "got", e)
		}
	}
	all, self := altoc.BasicReadScope{Access: "all"}, altoc.BasicReadScope{Access: "self"}
	dept := altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}

	// Scope applies to both sides: the current contract and where it would go.
	_, e := call("out", "1", self, map[string]any{"expectedVersion": float64(1), "owner_uid": "second"})
	refused(e, 403, "altoc_contract_scope_denied")
	_, e = call("foreign", "3", self, map[string]any{"expectedVersion": float64(1), "owner_uid": "person"})
	refused(e, 403, "altoc_contract_scope_denied")
	_, e = call("dept-out", "1", dept, map[string]any{"expectedVersion": float64(1), "owner_uid": "second", "owner_dept_code": "D2"})
	refused(e, 403, "altoc_contract_scope_denied")
	// The owner must be a real, active Directory user and never a reserved subject.
	_, e = call("reserved", "1", all, map[string]any{"expectedVersion": float64(1), "owner_uid": "system:unassigned"})
	refused(e, 400, "apf_owner_invalid")
	_, e = call("inactive", "1", all, map[string]any{"expectedVersion": float64(1), "owner_uid": "nobody"})
	if e == nil {
		t.Fatal("inactive owner accepted")
	}
	_, e = call("stale", "1", all, map[string]any{"expectedVersion": float64(9), "owner_uid": "second"})
	refused(e, 409, "altoc_contract_version_conflict")
	for name, payload := range map[string]map[string]any{"no owner": {"expectedVersion": float64(1)}, "status": {"expectedVersion": float64(1), "owner_uid": "second", "status": "completed"}, "amount": {"expectedVersion": float64(1), "owner_uid": "second", "amount_tax_inclusive": "1.00"}} {
		if _, e = call("bad-"+name, "1", all, payload); e == nil {
			t.Fatal(name)
		}
	}

	// Within a department scope the contract can move between its members.
	out, e := call("move", "1", dept, map[string]any{"expectedVersion": float64(1), "owner_uid": "second"})
	if e != nil || out["owner_uid"] != "second" || out["owner_dept_code"] != "D1" || out["status"] != "effective" {
		t.Fatal("reassign", out, e)
	}
	var change string
	if e = db.QueryRow("SELECT new_value FROM altoc_audit_log WHERE entity_type='contract' AND entity_id=1 AND action='set_owner'").Scan(&change); e != nil || !strings.Contains(change, "person") || !strings.Contains(change, "second") {
		t.Fatal("set_owner audit", change, e)
	}
	// Replay: same result, one audit row.
	if again, e := call("move", "1", dept, map[string]any{"expectedVersion": float64(1), "owner_uid": "second"}); e != nil || fmt.Sprint(again["row_version"]) != fmt.Sprint(out["row_version"]) {
		t.Fatal("replay", again, e)
	}
	var audits int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='contract' AND entity_id=1 AND action='set_owner'").Scan(&audits); e != nil || audits != 1 {
		t.Fatal("audit rows", audits, e)
	}

	// An imported, already completed contract can be handed to a real owner; nothing else changes.
	out, e = call("imported", "2", all, map[string]any{"expectedVersion": float64(1), "owner_uid": "person", "owner_dept_code": "D1"})
	if e != nil || out["owner_uid"] != "person" || out["status"] != "completed" {
		t.Fatal("imported reassign", out, e)
	}
	var amount, origin, legal string
	if e = db.QueryRow("SELECT amount_tax_inclusive,origin_type,legal_status FROM altoc_contract WHERE id=2").Scan(&amount, &origin, &legal); e != nil || amount != "888.00" || origin != "historical_import" || legal != "closed" {
		t.Fatal("imported contract changed", amount, origin, legal, e)
	}
	// The other guards on imported contracts are untouched.
	_, e = s.Contract(ctx, "contracts-sign", ContractInput{ID: "2", Payload: map[string]any{"expectedVersion": float64(2)}}, Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "sign"}, all)
	refused(e, 409, "altoc_contract_historical_operation_denied")
}

// Batch reassignment of one confirmed source person's open items.
func TestAPFW3MigrationApplyMySQL(t *testing.T) {
	s, db := migrationQueueFixture(t)
	ctx := context.Background()
	for _, q := range []string{
		"INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(5,'CU-W000005','imported customer','system:unassigned')",
		"INSERT INTO altoc_contract(id,code,name,customer_id,owner_uid,status,legal_status) VALUES(9,'CT-W000009','imported contract',5,'system:unassigned','effective','effective')",
		"UPDATE altoc_contract SET amount_basis='header',origin_type='historical_import',imported_batch_code='W1',tax_rate=NULL WHERE id=9",
		`INSERT INTO mig_exception(id,batch_id,owning_domain,kind,source_table,source_pk,target_table,target_key,detail_json) VALUES
			(20,1,'altoc','owner_unmatched','wb_contract','9','altoc_contract','CT-W000009','{"sourceUserId":"7"}'),
			(21,1,'altoc','owner_unmatched','wb_contract','404','altoc_contract','CT-W000404','{"sourceUserId":"7"}'),
			(22,1,'altoc','owner_unmatched','wb_organization','88','altoc_customer','CU-W000088','{"sourceUserId":"8"}')`,
	} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	all := altoc.BasicReadScope{Access: "all"}
	apply := func(actor, key string, i MigrationApplyInput) (map[string]any, error) {
		who := Identity{Actor: actor, Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: key, RequestID: key}
		v, e := s.MigrationApply(ctx, i, who)
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	refused := func(e error, status int, code string) {
		t.Helper()
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != status || he.Code != code {
			t.Fatal("expected", status, code, "got", e)
		}
	}
	input := MigrationApplyInput{SourceUserID: "employee:7", Limit: 100, CustomerScope: all, ContractScope: all}

	// Not confirmed yet: nothing happens.
	_, e := apply("person", "early", input)
	refused(e, 409, "migration_identity_state_conflict")
	// A row saying the target confirmed their own match is refused even though the
	// confirmation command itself would never have written it.
	if _, e = db.Exec("UPDATE mig_identity_map SET match_status='confirmed',directory_uid='second',matched_by='second' WHERE source_user_id='employee:7'"); e != nil {
		t.Fatal(e)
	}
	_, e = apply("person", "self", input)
	refused(e, 409, "migration_identity_self_match")
	if _, e = db.Exec("UPDATE mig_identity_map SET matched_by='person' WHERE source_user_id='employee:7'"); e != nil {
		t.Fatal(e)
	}
	// The target is re-checked on every run.
	restore := setTestOwners([]string{"second", "nobody"}, false)
	_, e = apply("person", "inactive", input)
	refused(e, 409, "migration_identity_target_invalid")
	restore()
	t.Cleanup(setTestOwners([]string{"nobody"}, false))
	for name, bad := range map[string]MigrationApplyInput{"operator key": {SourceUserID: "user:7", Limit: 10, CustomerScope: all, ContractScope: all}, "bare": {SourceUserID: "7", Limit: 10, CustomerScope: all, ContractScope: all}, "limit": {SourceUserID: "employee:7", Limit: 101, CustomerScope: all, ContractScope: all}, "scope": {SourceUserID: "employee:7", Limit: 10, CustomerScope: altoc.BasicReadScope{Access: "weird"}, ContractScope: all}} {
		if _, e = apply("person", "bad", bad); e == nil {
			t.Fatal(name)
		}
	}

	// One at a time: the customer first (lowest id), then the rest.
	out, e := apply("third", "batch-1", MigrationApplyInput{SourceUserID: "employee:7", Limit: 1, CustomerScope: all, ContractScope: all})
	if e != nil || out["resolved"] != 1 || out["remaining"] != int64(2) || out["owner_uid"] != "second" {
		t.Fatal("first batch", out, e)
	}
	var owner string
	if e = db.QueryRow("SELECT owner_uid FROM altoc_customer WHERE id=5").Scan(&owner); e != nil || owner != "second" {
		t.Fatal("customer owner", owner, e)
	}
	out, e = apply("third", "batch-2", input)
	items := out["items"].([]map[string]any)
	if e != nil || out["resolved"] != 1 || out["remaining"] != int64(1) || len(items) != 2 || items[0]["status"] != "resolved" || items[1]["status"] != "failed" || items[1]["code"] != "migration_target_unavailable" {
		t.Fatal("second batch", out, e)
	}
	var status, legal string
	if e = db.QueryRow("SELECT owner_uid,status,legal_status FROM altoc_contract WHERE id=9").Scan(&owner, &status, &legal); e != nil || owner != "second" || status != "effective" || legal != "effective" {
		t.Fatal("contract owner", owner, status, legal, e)
	}
	// Each resolved item records who was matched, who confirmed and who ran it.
	var resolution string
	if e = db.QueryRow("SELECT CAST(resolution_json AS CHAR) FROM mig_exception WHERE id=20 AND status='resolved'").Scan(&resolution); e != nil || !strings.Contains(resolution, `"assignedTo": "second"`) || !strings.Contains(resolution, `"confirmedBy": "person"`) || !strings.Contains(resolution, `"appliedBy": "third"`) || !strings.Contains(resolution, "reassign_owner") {
		t.Fatal("resolution", resolution, e)
	}
	var audits int
	if e = db.QueryRow("SELECT (SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='migration_exception' AND action='reassign_owner')*10+(SELECT COUNT(*) FROM altoc_audit_log WHERE entity_type='contract' AND action='set_owner')").Scan(&audits); e != nil || audits != 21 {
		t.Fatal("audit rows", audits, e)
	}
	// Running the whole thing again changes nothing; the unavailable target stays open.
	out, e = apply("third", "batch-2", input)
	if e != nil || out["resolved"] != 0 || out["remaining"] != int64(1) {
		t.Fatal("rerun", out, e)
	}
	// Another person's items were never touched; reassign_owner is not a resolve method.
	if e = db.QueryRow("SELECT status FROM mig_exception WHERE id=22").Scan(&status); e != nil || status != "open" {
		t.Fatal("foreign item", status, e)
	}
	if _, e = s.MigrationResolve(ctx, "altoc", MigrationResolveInput{ID: "22", ExpectedVersion: 1, Method: "reassign_owner"}, Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "direct"}); e == nil {
		t.Fatal("reassign_owner accepted as a resolve method")
	}
	// Scope still decides each item: a caller without contract scope resolves nothing.
	if _, e = db.Exec("UPDATE mig_exception SET status='open',resolution_json=NULL,resolved_by=NULL WHERE id=20"); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("UPDATE altoc_contract SET owner_uid='system:unassigned' WHERE id=9"); e != nil {
		t.Fatal(e)
	}
	out, e = apply("third", "no-scope", MigrationApplyInput{SourceUserID: "employee:7", Limit: 100, CustomerScope: all, ContractScope: altoc.BasicReadScope{Access: "none"}})
	if e != nil || out["resolved"] != 0 || out["items"].([]map[string]any)[0]["code"] != "altoc_contract_scope_denied" {
		t.Fatal("scope per item", out, e)
	}
}
