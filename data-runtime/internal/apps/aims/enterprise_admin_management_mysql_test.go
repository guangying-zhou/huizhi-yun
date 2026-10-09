package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
)

func testEnterpriseAdminManagementMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	identity := EnterpriseProjectCreateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", IdempotencyKey: "admin-batch-2037"}
	departments := []any{map[string]any{"deptCode": "BATCH-D1", "name": "测试部门", "managerUid": "U1", "memberUids": []any{"U2"}}, map[string]any{"deptCode": "BATCH-D2", "name": "无负责人部门", "managerUid": "", "memberUids": []any{}}}
	first, err := a.CreateEnterpriseRoutineBatch(ctx, identity, 2037, departments)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := a.CreateEnterpriseRoutineBatch(ctx, identity, 2037, departments[:1])
	if err != nil || first["receiptId"] != replay["receiptId"] || replay["idempotent"] != true {
		t.Fatalf("replay %v %v", replay, err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM aims_projects WHERE dept_code='BATCH-D1' AND category='routine'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("count=%d %v", count, err)
	}
	if _, err = a.CreateEnterpriseRoutineBatch(ctx, identity, 2038, departments); err == nil {
		t.Fatal("changed intent accepted")
	}
	identity.IdempotencyKey = "admin-batch-existing"
	existing, err := a.CreateEnterpriseRoutineBatch(ctx, identity, 2037, departments)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(existing["result"])
	var result struct {
		Summary struct{ Created, Existing, MissingManager int }
	}
	if err = json.Unmarshal(raw, &result); err != nil || result.Summary.Created != 0 || result.Summary.Existing != 1 || result.Summary.MissingManager != 1 {
		t.Fatalf("summary=%s %v", raw, err)
	}
	identity.IdempotencyKey = "admin-portfolio-create"
	body := map[string]any{"code": "TEST-HOST-PORTFOLIO", "name": "测试项目集", "defaultCategory": "product_dev", "ownerUid": "U1"}
	portfolio, err := a.CreateEnterprisePortfolio(ctx, identity, body)
	if err != nil {
		t.Fatal(err)
	}
	replay, err = a.CreateEnterprisePortfolio(ctx, identity, body)
	if err != nil || portfolio["receiptId"] != replay["receiptId"] || replay["idempotent"] != true {
		t.Fatalf("portfolio replay %v %v", replay, err)
	}
	body["name"] = "changed"
	if _, err = a.CreateEnterprisePortfolio(ctx, identity, body); err == nil {
		t.Fatal("changed portfolio accepted")
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM project_portfolios WHERE code='TEST-HOST-PORTFOLIO'").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	list, err := a.EnterpriseAdminProjects(ctx, map[string]string{"page": "1", "pageSize": "1", "search": "BATCH-D1", "sort": "updated"})
	// Name/code/UID search stays literal; department is its own filter domain.
	if err != nil {
		t.Fatal(err)
	}
	list, err = a.EnterpriseAdminProjects(ctx, map[string]string{"page": "1", "pageSize": "1", "search": "U1", "portfolioId": "0", "sort": "name"})
	if err != nil {
		t.Fatal(err)
	}
	rows := list["items"].([]map[string]any)
	if len(rows) != 1 {
		t.Fatalf("UID/ungrouped filter=%v", list)
	}
	id := fmt.Sprint(rows[0]["id"])
	detail, err := a.EnterpriseAdminProjects(ctx, map[string]string{"projectId": id, "page": "1", "pageSize": "20"})
	if err != nil || detail["total"] != int64(1) || detail["items"].([]map[string]any)[0]["counts"] == nil {
		t.Fatalf("detail=%v %v", detail, err)
	}
	for _, query := range []map[string]string{{"sort": "sql"}, {"projectId": "0"}, {"portfolioId": "-1"}} {
		if _, err = a.EnterpriseAdminProjects(ctx, query); err == nil {
			t.Fatal("bad query accepted", query)
		}
	}

	t.Run("tree roots retain matched parents and paginate independently", func(t *testing.T) {
		var pf int64
		if err := db.QueryRow("SELECT id FROM project_portfolios WHERE code='TEST-HOST-PORTFOLIO'").Scan(&pf); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("INSERT INTO aims_projects(project_code,name,short_name,category,leader_uid,created_by,portfolio_id) VALUES ('TREE-CHILD','Tree search needle','Tree','delivery','U1','U1',?)", pf); err != nil {
			t.Fatal(err)
		}
		tree, err := a.EnterpriseAdminProjects(ctx, map[string]string{"tree": "true", "search": "needle", "pageSize": "1"})
		if err != nil || tree["total"] != int64(1) {
			t.Fatalf("tree %v %v", tree, err)
		}
		roots := tree["items"].([]map[string]any)
		if len(roots) != 1 || roots[0]["id"] != pf {
			t.Fatalf("missing parent %v", roots)
		}
		if roots[0]["projectCount"] != int64(1) {
			t.Fatalf("count %v", roots)
		}
		version := roots[0]["editVersion"].(string)
		updateIdentity := identity
		updateIdentity.IdempotencyKey = "tree-portfolio-edit"
		command := map[string]any{"expectedVersion": version, "name": "Updated portfolio"}
		updated, err := a.UpdateEnterprisePortfolio(ctx, updateIdentity, fmt.Sprint(pf), command)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.UpdateEnterprisePortfolio(ctx, updateIdentity, fmt.Sprint(pf), command)
		if err != nil || replay["receiptId"] != updated["receiptId"] || replay["idempotent"] != true {
			t.Fatalf("update replay %v %v", replay, err)
		}
		updateIdentity.IdempotencyKey = "tree-stale-edit"
		if _, err := a.UpdateEnterprisePortfolio(ctx, updateIdentity, fmt.Sprint(pf), command); err == nil {
			t.Fatal("stale version accepted")
		}
		child, err := a.EnterpriseAdminProjects(ctx, map[string]string{"portfolioId": fmt.Sprint(pf), "search": "needle", "pageSize": "1"})
		if err != nil || child["total"] != int64(1) {
			t.Fatalf("child %v %v", child, err)
		}
		unmatched, err := a.EnterpriseAdminProjects(ctx, map[string]string{"tree": "true", "search": "no-matching-tree-name"})
		if err != nil || unmatched["total"] != int64(0) {
			t.Fatalf("unmatched %v %v", unmatched, err)
		}
		ungrouped, err := a.EnterpriseAdminProjects(ctx, map[string]string{"tree": "true", "portfolioId": "0"})
		if err != nil || ungrouped["items"].([]map[string]any)[0]["projectCount"].(int64) < 1 || ungrouped["total"] != int64(1) || ungrouped["items"].([]map[string]any)[0]["id"] != int64(0) {
			t.Fatalf("ungrouped %v %v", ungrouped, err)
		}
	})
	// A failure after a first department insert must roll back both business rows and receipt.
	collision := routineDepartmentProjectCode(2039, "FAIL-D2")
	if _, err = db.Exec("INSERT INTO aims_projects(project_code,name,short_name,category,leader_uid,created_by) VALUES (?,'Collision','Collision','delivery','U1','U1')", collision); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "admin-batch-rollback"
	broken := []any{map[string]any{"deptCode": "FAIL-D1", "name": "先创建", "managerUid": "U1", "memberUids": []any{}}, map[string]any{"deptCode": "FAIL-D2", "name": "后冲突", "managerUid": "U1", "memberUids": []any{}}}
	if _, err = a.CreateEnterpriseRoutineBatch(ctx, identity, 2039, broken); err == nil {
		t.Fatal("late batch conflict accepted")
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM aims_projects WHERE dept_code='FAIL-D1'").Scan(&count); err != nil || count != 0 {
		t.Fatal("partial batch persisted", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='admin-batch-rollback'").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed receipt persisted", count, err)
	}

}
