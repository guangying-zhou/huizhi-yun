package finance

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestMySQLProductCostAttributionRevisionConcurrency(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated MySQL socket not configured")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-product-center.") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-test socket")
	}
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_finance_product_%d", time.Now().UnixNano())
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name)
	db, err := sql.Open("mysql", "root@unix("+socket+")/"+name+"?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ddl, err := os.ReadFile("../../../../finance/docs/migrations/20260909_product_cost_attribution.sql")
	if err != nil {
		t.Fatal(err)
	}
	// Prove installation is repeatable, using the actual migration.
	for i := 0; i < 2; i++ {
		for _, statement := range strings.Split(string(ddl), ";") {
			if strings.TrimSpace(statement) == "" {
				continue
			}
			if _, err := db.Exec(statement); err != nil {
				t.Fatal(err)
			}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	save := func(rules productCostAttributionRules, expected int64, commit bool) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err := replaceProductCostAttribution(ctx, tx, rules, expected, "U1"); err != nil {
			return err
		}
		if commit {
			return tx.Commit()
		}
		return tx.Rollback()
	}
	// Two editors start from revision zero, each proposing a complete valid
	// allocation. Exactly one wins; the loser must reload, never merge silently.
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rules := costAttributionRules()
			rules.Shares = []productCostShare{{fmt.Sprintf("P%d", i), 8000}}
			<-start
			results <- save(rules, 0, true)
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	winners, conflicts := 0, 0
	for err := range results {
		if err == nil {
			winners++
		} else if errors.Is(err, errProductCostRevisionConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if winners != 1 || conflicts != 1 {
		t.Fatalf("winners=%d conflicts=%d", winners, conflicts)
	}
	rules := costAttributionRules()
	rules.Revision = 2
	if err := save(rules, 1, false); err != nil {
		t.Fatal(err)
	}
	var current, count int
	if err := db.QueryRow("SELECT revision FROM product_cost_attribution_head").Scan(&current); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM product_cost_attribution_revision").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if current != 1 || count != 1 {
		t.Fatalf("rollback leaked: head=%d history=%d", current, count)
	}
	if err := save(rules, 1, true); err != nil {
		t.Fatal(err)
	}
	if err := save(rules, 1, true); !errors.Is(err, errProductCostRevisionConflict) {
		t.Fatalf("stale write accepted: %v", err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM product_cost_attribution_revision").Scan(&count); err != nil || count != 2 {
		t.Fatalf("history=%d err=%v", count, err)
	}
	// Invalid totals never create a revision or advance the current head.
	rules.Revision = 3
	rules.Shares = []productCostShare{{"P1", 8000}, {"P2", 8000}}
	if err := save(rules, 2, true); err == nil {
		t.Fatal("accepted over-allocation")
	}
	if err := db.QueryRow("SELECT revision FROM product_cost_attribution_head").Scan(&current); err != nil || current != 2 {
		t.Fatalf("invalid write changed head=%d: %v", current, err)
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	loaded, err := readProductCostAttribution(ctx, tx, "PROJECT-1", "2026-09")
	if err != nil || loaded.Revision != 2 || len(loaded.Shares) != 2 || loaded.EvidenceRef != "approval-1" {
		t.Fatalf("current immutable rules: %+v, %v", loaded, err)
	}
	if _, err := readProductCostAttribution(ctx, tx, "project-1", "2026-09"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("case-sensitive business key: %v", err)
	}
	if _, err := readProductCostAttribution(ctx, tx, "PROJECT-1", "2026-10"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("missing period must remain unconfigured: %v", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	// Read actual canonical Finance tables, including JSON and nullable DECIMAL
	// values that SQL mocks cannot prove the MySQL driver handles correctly.
	schema, err := os.ReadFile("../../../../finance/docs/finance_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"finance_subject", "finance_expense_type", "finance_bank_account", "finance_expense", "project_finance_summary", "project_cost_allocation"} {
		statement := regexp.MustCompile(`(?s)CREATE TABLE ` + table + ` \(.*?\) ENGINE=.*?;`).FindString(string(schema))
		if statement == "" {
			t.Fatalf("missing canonical table %s", table)
		}
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO project_finance_summary(project_code,period_month,cost_readiness_status,cost_input_hash,cost_readiness_checked_at,direct_expense_amount,labor_cost_amount,allocated_cost_amount)
		VALUES ('PRJ-1','2026-09','ready',REPEAT('a',64),CURRENT_TIMESTAMP(6),NULL,100.00,0.00)`); err != nil {
		t.Fatal(err)
	}
	fact := productLaborCurrencyFact()
	if _, err := db.ExecContext(ctx, `INSERT INTO finance_expense(code,expense_date,expense_amount,currency_code,project_code,status,deleted_at) VALUES
		('E1','2026-09-30',20.00,'USD','PRJ-1','draft',NULL),
		('E2','2026-09-01',30.00,'CNY','PRJ-1','canceled',NULL),
		('E3','2026-09-01',40.00,'CNY','PRJ-1','confirmed',CURRENT_TIMESTAMP),
		('E4','2026-10-01',50.00,'CNY','PRJ-1','confirmed',NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO project_cost_allocation(code,project_code,period_month,employee_uid,allocation_type,source_table,rule_code,status,amount,source_refs_json)
		VALUES (?,?,?,?,?,?,?,?,?,?)`, fact.Code, fact.ProjectCode, fact.PeriodMonth, fact.EmployeeUID, fact.AllocationType, fact.SourceTable, fact.RuleCode, fact.Status, fact.Amount, []byte(fact.SourceRefs)); err != nil {
		t.Fatal(err)
	}
	snapshot, err := readProductCostSnapshot(ctx, db, "PRJ-1", "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.SummaryExists || snapshot.Rules != nil || snapshot.DirectExpenseAmount != "" || snapshot.LaborCostAmount != "100.00" || len(snapshot.Allocations) != 1 {
		t.Fatalf("canonical snapshot: %+v", snapshot)
	}
	if len(snapshot.DirectExpenses) != 1 || snapshot.DirectExpenses[0].Code != "E1" || snapshot.DirectExpenses[0].Currency != "USD" {
		t.Fatalf("expense scope/status/month: %+v", snapshot.DirectExpenses)
	}
	query, body := productCostRuntimeFixture(t)
	runtimeResult, operation, err := (&Adapter{db: db}).HandleMutationWithQuery(ctx, http.MethodPost, "/v1/finance/internal/product-cost:read", query, body)
	if err != nil || operation != "finance.product_cost.read" || runtimeResult.Data["productCode"] != "P1" || runtimeResult.Data["ready"] != false {
		t.Fatalf("registered read failed: %+v %s %v", runtimeResult, operation, err)
	}
	readyRules := costAttributionRules()
	readyRules.ProjectCode = "PRJ-1"
	if err := save(readyRules, 0, true); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE project_finance_summary SET direct_expense_amount=20.00"); err != nil {
		t.Fatal(err)
	}
	runtimeResult, _, err = (&Adapter{db: db}).HandleMutationWithQuery(ctx, http.MethodPost, "/v1/finance/internal/product-cost:read", query, body)
	if err != nil || runtimeResult.Data["ready"] != true {
		t.Fatalf("ready result failed: %+v %v", runtimeResult, err)
	}
	costs, ok := runtimeResult.Data["costs"].([]any)
	if !ok || len(costs) != 2 || costs[0].(map[string]any)["amount"] != "50.00" || costs[1].(map[string]any)["amount"] != "10.00" {
		t.Fatalf("wrong product currency split: %+v", costs)
	}
	if currency, reason := productCostAllocationCurrency(snapshot.Allocations[0]); currency != "CNY" || reason != "" {
		t.Fatalf("JSON evidence: %s %s", currency, reason)
	}
	if _, err := db.ExecContext(ctx, "UPDATE project_cost_allocation SET status='reversed'"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = readProductCostSnapshot(ctx, db, "PRJ-1", "2026-09")
	if err != nil || len(snapshot.Allocations) != 0 {
		t.Fatalf("reversal still included: %+v, %v", snapshot, err)
	}
	snapshot, err = readProductCostSnapshot(ctx, db, "prj-1", "2026-09")
	if err != nil || snapshot.SummaryExists {
		t.Fatalf("case-insensitive summary leaked: %+v, %v", snapshot, err)
	}
	receiptDDL, err := os.ReadFile("../../../../finance/docs/migrations/20260710_service_command_receipt.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, string(receiptDDL)); err != nil {
		t.Fatal(err)
	}
	repository, err := integrationoperation.NewReceiptRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"actorUid":"U1","projectCode":"RECEIPT-PRJ","periodMonth":"2026-09","expectedRevision":0,"evidenceRef":"APPROVAL-1","shares":[{"productCode":"P1","basisPoints":10000}]}`)
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	digest, err := integrationoperation.ValidateAndDigestCommand(payload)
	if err != nil {
		t.Fatal(err)
	}
	input := integrationoperation.ReceiptCommandInput{
		TrustedContext: integrationoperation.TrustedContext{TenantCode: "T", DeploymentCode: "FINANCE", SourceApp: "aims", ServiceClientID: "aims.runtime", RequestID: "REQ1"},
		TargetApp:      "finance", OperationID: "b1111111-1111-4111-8111-111111111111", OperationCode: "aims.finance.product-cost.rules.replace.v1", RequiredCapability: "finance:product-cost:replace-rules",
		IdempotencyKey: "rules:1", CommandSchemaVersion: "product-cost-rules.v1", CommandSHA256: digest, Command: raw,
	}
	handler := productCostRulesReceiptHandler("U1", "RECEIPT-PRJ", "2026-09")
	first, err := repository.Execute(ctx, input, handler)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := repository.Execute(ctx, input, handler)
	if err != nil || !replay.Existing || replay.ReceiptID != first.ReceiptID || replay.TargetBizCode != first.TargetBizCode {
		t.Fatalf("receipt replay: %+v %v", replay, err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM product_cost_attribution_revision WHERE project_code='RECEIPT-PRJ'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("replay wrote duplicate revision: %d %v", count, err)
	}
	// A new command with a stale expected revision must roll back its receipt too.
	input.OperationID = "c1111111-1111-4111-8111-111111111111"
	input.IdempotencyKey = "rules:stale"
	if _, err := repository.Execute(ctx, input, handler); !errors.Is(err, errProductCostRevisionConflict) {
		t.Fatalf("stale command: %v", err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM service_command_receipt").Scan(&count); err != nil || count != 1 {
		t.Fatalf("failed command receipt leaked: %d %v", count, err)
	}
	writeQuery, writeBody := productCostRuntimeFixture(t)
	writeQuery.Set("scope", productCostRulesCapability)
	payload["projectCode"] = "ROUTE-PRJ"
	digest, err = integrationoperation.ValidateAndDigestCommand(payload)
	if err != nil {
		t.Fatal(err)
	}
	writeEnvelope := writeBody["serviceCommand"].(map[string]any)
	writeEnvelope["command"], writeEnvelope["commandSha256"] = payload, digest
	writeEnvelope["operationCode"], writeEnvelope["commandSchemaVersion"], writeEnvelope["requiredCapability"] = productCostRulesOperation, productCostRulesSchema, productCostRulesCapability
	writeAuth := writeBody["productCostAuthorization"].(map[string]any)
	delete(writeBody, "productCostAuthorization")
	writeBody["productCostRulesAuthorization"] = writeAuth
	writeAuth["action"], writeAuth["purpose"], writeAuth["current_user_project_finance_project_codes"] = "edit", "product_cost_rules_edit", "ROUTE-PRJ"
	adapter := &Adapter{db: db}
	writeResult, op, err := adapter.HandleMutationWithQuery(ctx, http.MethodPost, "/v1/finance/internal/product-cost:replace-rules", writeQuery, writeBody)
	if err != nil || op != "finance.product_cost.replace_rules" || writeResult.Data["receiptStatus"] != "succeeded" || writeResult.Data["idempotent"] != false {
		t.Fatalf("write route: %+v %s %v", writeResult, op, err)
	}
	writeReplay, _, err := adapter.HandleMutationWithQuery(ctx, http.MethodPost, "/v1/finance/internal/product-cost:replace-rules", writeQuery, writeBody)
	if err != nil || writeReplay.Data["idempotent"] != true || writeReplay.Data["receiptId"] != writeResult.Data["receiptId"] {
		t.Fatalf("write route replay: %+v %v", writeReplay, err)
	}
	writeAuth["current_user_project_finance_access"] = "none"
	if _, _, err := adapter.HandleMutationWithQuery(ctx, http.MethodPost, "/v1/finance/internal/product-cost:replace-rules", writeQuery, writeBody); err == nil {
		t.Fatal("revoked user received successful old receipt")
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM product_cost_attribution_revision WHERE project_code='ROUTE-PRJ'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("route replay changed rules: %d %v", count, err)
	}
	// Expand preserves unknown historical currency and is safe to replay.
	if _, err := db.Exec(`ALTER TABLE project_cost_allocation DROP COLUMN currency_code`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO project_cost_allocation(id,code,project_code,period_month,allocation_type,amount) VALUES(9101,'HISTORICAL','P1','2026-09','other',12.34)`); err != nil {
		t.Fatal(err)
	}
	currencyDDL, err := os.ReadFile("../../../../finance/docs/migrations/20260909_project_cost_allocation_currency.sql")
	if err != nil {
		t.Fatal(err)
	}
	migrationConn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer migrationConn.Close()
	for repeat := 0; repeat < 2; repeat++ {
		for _, statement := range strings.Split(string(currencyDDL), ";") {
			if strings.TrimSpace(statement) == "" {
				continue
			}
			if _, err := migrationConn.ExecContext(context.Background(), statement); err != nil {
				t.Fatal(err)
			}
		}
	}
	var historicalCurrency sql.NullString
	var historicalAmount string
	if err := db.QueryRow(`SELECT currency_code,amount FROM project_cost_allocation WHERE id=9101`).Scan(&historicalCurrency, &historicalAmount); err != nil || historicalCurrency.Valid || historicalAmount != "12.34" {
		t.Fatalf("currency expand changed history: %v %s %v", historicalCurrency, historicalAmount, err)
	}
	allocationBody := jsonBody{
		"code": "EXPLICIT-CURRENCY", "projectCode": "P1", "periodMonth": "2026-09",
		"amount": "45.67", "currencyCode": "USD",
		"current_user_project_finance_access": "all",
	}
	if _, err := adapter.UpsertProjectCostAllocation(ctx, allocationBody); err != nil {
		t.Fatal(err)
	}
	assertAllocation := func(currency string, valid bool) {
		t.Helper()
		var got sql.NullString
		var amount string
		if err := db.QueryRow(`SELECT currency_code,amount FROM project_cost_allocation WHERE code='EXPLICIT-CURRENCY'`).Scan(&got, &amount); err != nil || got.Valid != valid || got.String != currency || amount != "45.67" {
			t.Fatalf("saved allocation: %v %s %v", got, amount, err)
		}
	}
	assertAllocation("USD", true)
	allocationSpec, ok := ListResourceSpecForPath("/v1/finance/project-cost-allocations")
	if !ok {
		t.Fatal("allocation list route missing")
	}
	listed, err := adapter.ListResource(ctx, allocationSpec, url.Values{
		"keyword": {"EXPLICIT-CURRENCY"}, "current_user_project_finance_access": {"all"},
	})
	if err != nil || listed.Total != 1 || len(listed.Data) != 1 || listed.Data[0]["currency_code"] != "USD" {
		t.Fatalf("allocation list lost saved currency: %+v %v", listed, err)
	}
	allocationSnapshot, err := readProductCostSnapshot(ctx, db, "P1", "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	foundExplicit := false
	for _, fact := range allocationSnapshot.Allocations {
		if fact.Code == "EXPLICIT-CURRENCY" {
			foundExplicit = true
			if currency, reason := productCostAllocationCurrency(fact); currency != "USD" || reason != "" {
				t.Fatalf("saved currency unavailable to product costs: %s %s", currency, reason)
			}
		}
	}
	if !foundExplicit {
		t.Fatal("saved allocation missing from product snapshot")
	}
	allocationBody["currencyCode"] = "usd"
	allocationBody["amount"] = "99.99"
	if _, err := adapter.UpsertProjectCostAllocation(ctx, allocationBody); err == nil {
		t.Fatal("invalid currency changed allocation")
	}
	assertAllocation("USD", true)
	allocationBody["amount"] = "45.67"
	delete(allocationBody, "currencyCode")
	if _, err := adapter.UpsertProjectCostAllocation(ctx, allocationBody); err != nil {
		t.Fatal(err)
	}
	assertAllocation("", false)
	// Knowing another project's allocation code must not permit taking it over.
	allocationBody["projectCode"] = "P2"
	allocationBody["amount"] = "99.99"
	allocationBody["currencyCode"] = "EUR"
	allocationBody["current_user_project_finance_access"] = "projects"
	allocationBody["current_user_project_finance_project_codes"] = "P2"
	if _, err := adapter.UpsertProjectCostAllocation(ctx, allocationBody); err == nil {
		t.Fatal("target-only grant overwrote another project's allocation")
	}
	assertAllocation("", false)
	var allocationProject string
	if err := db.QueryRow(`SELECT project_code FROM project_cost_allocation WHERE code='EXPLICIT-CURRENCY'`).Scan(&allocationProject); err != nil || allocationProject != "P1" {
		t.Fatalf("denied takeover changed project: %s %v", allocationProject, err)
	}
	allocationBody["current_user_project_finance_project_codes"] = "P1"
	if _, err := adapter.UpsertProjectCostAllocation(ctx, allocationBody); err == nil {
		t.Fatal("source-only grant moved allocation into unauthorized target")
	}
	allocationBody["current_user_project_finance_project_codes"] = "P1,P2"
	if _, err := adapter.UpsertProjectCostAllocation(ctx, allocationBody); err != nil {
		t.Fatalf("authorized project correction failed: %v", err)
	}
	if err := db.QueryRow(`SELECT project_code,currency_code,amount FROM project_cost_allocation WHERE code='EXPLICIT-CURRENCY'`).Scan(&allocationProject, &historicalCurrency, &historicalAmount); err != nil || allocationProject != "P2" || historicalCurrency.String != "EUR" || historicalAmount != "99.99" {
		t.Fatalf("authorized correction incomplete: %s %v %s %v", allocationProject, historicalCurrency, historicalAmount, err)
	}
	const currencyColumn = "project_cost_allocation.currency_code"
	// Hold an uncommitted ownership change, then observe the real writer waiting.
	ownerTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ownerTx.Rollback()
	if _, err := ownerTx.ExecContext(ctx, `UPDATE project_cost_allocation SET project_code='P3' WHERE code='EXPLICIT-CURRENCY'`); err != nil {
		t.Fatal(err)
	}
	writeDone := make(chan error, 1)
	go func() {
		_, err := adapter.UpsertProjectCostAllocation(ctx, allocationBody)
		writeDone <- err
	}()
	waitDeadline := time.Now().Add(5 * time.Second)
	for {
		var waiting int
		if err := admin.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB=? AND INFO LIKE 'SELECT project_code, COALESCE(source_table%FOR UPDATE'`, name).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			break
		}
		if time.Now().After(waitDeadline) {
			select {
			case early := <-writeDone:
				t.Fatalf("writer completed without observed wait: %v", early)
			default:
			}

			t.Fatal("allocation writer never exposed its in-flight locking read")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := ownerTx.Commit(); err != nil {
		t.Fatal(err)
	}
	var scopeError httperror.Error
	if err := <-writeDone; !errors.As(err, &scopeError) || scopeError.Status != 403 || scopeError.Code != "finance_project_access_denied" {
		t.Fatalf("waiting writer did not reject current project scope: %v", err)
	}
	if err := db.QueryRow(`SELECT project_code,currency_code,amount FROM project_cost_allocation WHERE code='EXPLICIT-CURRENCY'`).Scan(&allocationProject, &historicalCurrency, &historicalAmount); err != nil || allocationProject != "P3" || historicalCurrency.String != "EUR" || historicalAmount != "99.99" {
		t.Fatalf("waiting writer changed unauthorized allocation: %s %v %s %v", allocationProject, historicalCurrency, historicalAmount, err)
	}
	managedBody := jsonBody{"code": fact.Code, "projectCode": fact.ProjectCode, "periodMonth": fact.PeriodMonth, "amount": "999.00", "currencyCode": "USD", "current_user_project_finance_access": "all"}
	if _, err := adapter.UpsertProjectCostAllocation(ctx, managedBody); err == nil {
		t.Fatal("manual write replaced managed labor source")
	}
	var managedAmount, managedStatus string
	if err := db.QueryRow(`SELECT amount,status FROM project_cost_allocation WHERE code=?`, fact.Code).Scan(&managedAmount, &managedStatus); err != nil || managedAmount != fact.Amount || managedStatus != "reversed" {
		t.Fatalf("managed labor changed: %s %s %v", managedAmount, managedStatus, err)
	}
	managedBody["code"] = "FORGED-MANAGED"
	managedBody["sourceTable"] = strings.ToUpper(managedLaborSourceTable)
	if _, err := adapter.UpsertProjectCostAllocation(ctx, managedBody); err == nil {
		t.Fatal("manual write impersonated managed labor source")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM project_cost_allocation WHERE code='FORGED-MANAGED'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("forged managed allocation persisted: %d %v", count, err)
	}
	status, err := adapter.SchemaStatus(ctx)
	if err != nil || !slices.Contains(status.CheckedColumns, currencyColumn) || slices.Contains(status.MissingColumns, currencyColumn) {
		t.Fatalf("expanded currency schema incorrectly reported: %+v %v", status, err)
	}
	if _, err := db.ExecContext(ctx, `ALTER TABLE project_cost_allocation DROP COLUMN currency_code`); err != nil {
		t.Fatal(err)
	}
	status, err = adapter.SchemaStatus(ctx)
	if err != nil || status.Status != "schema_mismatch" || !slices.Contains(status.MissingColumns, currencyColumn) {
		t.Fatalf("missing currency column not detected: %+v %v", status, err)
	}
}
