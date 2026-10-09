package aims

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type LockedServiceDispatch struct {
	tx                     *sql.Tx
	r                      enterprise.Resolved
	project, ticket, actor string
	projectID              int64
	existing               map[string]any
}
type ServiceDispatchCommand struct{ Title, Description, Type, Priority, Actor, Handler, CustomerCode, EstimatedHours string }
type ServiceDispatchResult struct{ ItemKey, Type string }

func PrepareServiceDispatchTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, actor, project, contract, ticket string) (*LockedServiceDispatch, error) {
	if e := CheckServiceProjectTx(ctx, tx, r, actor, project, contract); e != nil {
		return nil, e
	}
	for _, n := range []string{"work_items", "work_item_service_ext", "work_item_changelog", "milestones", "project_counters"} {
		if _, e := r.Table(n); e != nil {
			return nil, e
		}
	}
	projects, _ := r.Table("aims_projects")
	var pid int64
	if e := tx.QueryRowContext(ctx, "SELECT id FROM "+projects+" WHERE BINARY project_code=BINARY ?", project).Scan(&pid); e != nil {
		return nil, e
	}
	wi, _ := r.Table("work_items")
	ext, _ := r.Table("work_item_service_ext")
	rows, e := aimsQueryMaps(ctx, tx, "SELECT wi.id,wi.project_id,wi.item_key,wi.type FROM "+ext+" se JOIN "+wi+" wi ON wi.id=se.work_item_id WHERE BINARY se.source_ticket_code=BINARY ? FOR UPDATE", ticket)
	if e != nil {
		return nil, e
	}
	if len(rows) > 1 {
		return nil, httperror.New(409, "service_ticket_duplicate_execution", "工单存在重复执行关系")
	}
	p := &LockedServiceDispatch{tx: tx, r: r, project: project, ticket: ticket, actor: actor, projectID: pid}
	if len(rows) == 1 {
		p.existing = rows[0]
		if fmt.Sprint(rows[0]["project_id"]) != fmt.Sprint(pid) {
			return nil, httperror.New(409, "service_ticket_binding_conflict", "工单执行项目不能改绑")
		}
	}
	return p, nil
}
func ApplyServiceDispatchTx(ctx context.Context, tx *sql.Tx, p *LockedServiceDispatch, c ServiceDispatchCommand) (ServiceDispatchResult, error) {
	if p == nil || tx != p.tx || c.Actor != p.actor {
		return ServiceDispatchResult{}, enterprise.ErrBindingMismatch
	}
	if p.existing != nil {
		return ServiceDispatchResult{fmt.Sprint(p.existing["item_key"]), fmt.Sprint(p.existing["type"])}, nil
	}
	wi, _ := p.r.Table("work_items")
	counter, _ := p.r.Table("project_counters")
	ms, _ := p.r.Table("milestones")
	ext, _ := p.r.Table("work_item_service_ext")
	log, _ := p.r.Table("work_item_changelog")
	if c.Handler != "" {
		members, _ := p.r.Table("aims_project_members")
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+members+" WHERE project_id=? AND BINARY uid=BINARY ? AND status='active' FOR UPDATE", p.projectID, c.Handler).Scan(&n); e != nil {
			return ServiceDispatchResult{}, e
		}
		if n == 0 {
			return ServiceDispatchResult{}, httperror.New(400, "service_ticket_handler_invalid", "处理人必须是项目在职成员")
		}
	}
	var mid int64
	e := tx.QueryRowContext(ctx, "SELECT id FROM "+ms+" WHERE project_id=? AND template_key='service_ops' ORDER BY id LIMIT 1 FOR UPDATE", p.projectID).Scan(&mid)
	if e == sql.ErrNoRows {
		res, err := tx.ExecContext(ctx, "INSERT INTO "+ms+" (project_id,name,description,mode,status,pivr_stage,template_key,sort_order,created_by) VALUES (?,'工单处理','常驻服务工单执行容器','rolling_plan','active','I','service_ops',9000,?)", p.projectID, c.Actor)
		if err != nil {
			return ServiceDispatchResult{}, err
		}
		mid, e = res.LastInsertId()
	}
	if e != nil {
		return ServiceDispatchResult{}, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT IGNORE INTO "+counter+" (project_id,counter) SELECT ?,COALESCE(MAX(item_number),0) FROM "+wi+" WHERE project_id=?", p.projectID, p.projectID); e != nil {
		return ServiceDispatchResult{}, e
	}
	var seq int64
	if e = tx.QueryRowContext(ctx, "SELECT counter FROM "+counter+" WHERE project_id=? FOR UPDATE", p.projectID).Scan(&seq); e != nil {
		return ServiceDispatchResult{}, e
	}
	seq++
	if _, e = tx.ExecContext(ctx, "UPDATE "+counter+" SET counter=? WHERE project_id=?", seq, p.projectID); e != nil {
		return ServiceDispatchResult{}, e
	}
	typ, tier := serviceTicketWorkItemType(c.Type)
	status := "todo"
	if tier == "target" {
		status = "planning"
	}
	key := fmt.Sprintf("%s-%d", p.project, seq)
	res, e := tx.ExecContext(ctx, "INSERT INTO "+wi+" (project_id,milestone_id,item_number,item_key,tier,type,title,description,status,priority,severity,weight,assignee_uid,reporter_uid,estimated_hours,sort_order,review_level,template_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,0,1,?)", p.projectID, mid, seq, key, tier, typ, c.Title, nullableText(c.Description), status, serviceTicketPriority(c.Priority), serviceTicketSeverity(typ, serviceTicketPriority(c.Priority)), nullableText(c.Handler), c.Actor, nullableText(c.EstimatedHours), serviceTicketTemplateKey(p.ticket))
	if e != nil {
		return ServiceDispatchResult{}, e
	}
	id, e := res.LastInsertId()
	if e != nil {
		return ServiceDispatchResult{}, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO "+ext+" (work_item_id,project_id,source_ticket_code,customer_code) VALUES (?,?,?,?)", id, p.projectID, p.ticket, c.CustomerCode); e != nil {
		return ServiceDispatchResult{}, e
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO "+log+" (work_item_id,field_name,new_value,changed_by) VALUES (?,'source',?,?)", id, "altoc:service_ticket:"+p.ticket, c.Actor); e != nil {
		return ServiceDispatchResult{}, e
	}
	return ServiceDispatchResult{key, typ}, nil
}
