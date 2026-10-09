package enterpriseplanning

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func handoffRead[T any](ctx context.Context, s *LightweightHandoffService, code, uid string, p pc.AuthorizationPermit, read func(*sql.Tx) (T, error)) (out T, err error) {
	if s == nil || s.planning == nil {
		return out, e.ErrBindingNotFound
	}
	q := s.planning.writer
	q.Operation = e.Read
	tx, _, err := s.planning.registry.BeginSnapshotReadTransaction(ctx, q)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = pc.AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", p); err != nil {
		return out, err
	}
	out, err = read(tx)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s *LightweightHandoffService) Detail(ctx context.Context, code, uid, id string, p pc.AuthorizationPermit) (pc.PlanningItemDetail, error) {
	return handoffRead(ctx, s, code, uid, p, func(tx *sql.Tx) (pc.PlanningItemDetail, error) {
		return pc.ReadPlanningItemInTransaction(ctx, tx, code, uid, id, p)
	})
}

// These are internal BFF candidates; the BFF filters each project's actual scoped
// permission before pagination or returning any browser-visible record.
type HandoffProjectCandidate struct {
	ID       int64                           `json:"id"`
	Code     string                          `json:"project_code"`
	Name     string                          `json:"name"`
	Category string                          `json:"category"`
	Status   string                          `json:"lifecycle_status"`
	Facts    aims.ProductHandoffProjectFacts `json:"facts"`
}

func (s *LightweightHandoffService) Projects(ctx context.Context, code, uid, keyword string, p pc.AuthorizationPermit) ([]HandoffProjectCandidate, error) {
	return handoffRead(ctx, s, code, uid, p, func(tx *sql.Tx) ([]HandoffProjectCandidate, error) {
		rows, err := tx.QueryContext(ctx, `SELECT p.id,p.project_code,p.name,p.category,p.lifecycle_status FROM aims_projects p WHERE p.category='product_dev' AND p.lifecycle_status='active' AND EXISTS(SELECT 1 FROM aims_project_products b WHERE b.project_id=p.id AND b.product_code=?) AND (?='' OR LOCATE(?,p.name)>0 OR LOCATE(?,p.project_code)>0) ORDER BY p.id`, code, keyword, keyword, keyword)
		if err != nil {
			return nil, err
		}
		out := []HandoffProjectCandidate{}
		for rows.Next() {
			var v HandoffProjectCandidate
			if err = rows.Scan(&v.ID, &v.Code, &v.Name, &v.Category, &v.Status); err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		for i := range out {
			out[i].Facts, err = aims.LoadProductHandoffProjectFacts(ctx, tx, out[i].Code, uid)
			if err != nil {
				return nil, err
			}
		}
		return out, nil
	})
}

type HandoffRequirementCandidate struct {
	ID        int64  `json:"id"`
	ProjectID int64  `json:"project_id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
}
type HandoffRequirements struct {
	Facts aims.ProductHandoffProjectFacts `json:"facts"`
	Items []HandoffRequirementCandidate   `json:"items"`
}

func (s *LightweightHandoffService) Requirements(ctx context.Context, code, uid, projectCode, keyword string, p pc.AuthorizationPermit) (HandoffRequirements, error) {
	return handoffRead(ctx, s, code, uid, p, func(tx *sql.Tx) (out HandoffRequirements, err error) {
		out.Facts, err = aims.LoadProductHandoffProjectFacts(ctx, tx, projectCode, uid)
		if err != nil {
			return out, err
		}
		var eligible bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM aims_projects p JOIN aims_project_products b ON b.project_id=p.id WHERE p.id=? AND b.product_code=? AND p.category='product_dev' AND p.lifecycle_status='active')`, out.Facts.ProjectID, code).Scan(&eligible); err != nil {
			return out, err
		}
		if !eligible {
			return out, httperror.New(404, "handoff_project_not_found", "Eligible project not found")
		}
		rows, err := tx.QueryContext(ctx, `SELECT id,project_id,title,status FROM requirement_items WHERE project_id=? AND status IN ('draft','in_review','baselined','change_pending') AND (?='' OR LOCATE(?,title)>0) ORDER BY id DESC`, out.Facts.ProjectID, keyword, keyword)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		out.Items = []HandoffRequirementCandidate{}
		for rows.Next() {
			var v HandoffRequirementCandidate
			if err = rows.Scan(&v.ID, &v.ProjectID, &v.Title, &v.Status); err != nil {
				return out, err
			}
			out.Items = append(out.Items, v)
		}
		return out, rows.Err()
	})
}

func (s *LightweightHandoffService) ScopedProjectAuthorizationFacts(ctx context.Context, code, uid, projectCode string, p pc.AuthorizationPermit) (aims.ProductHandoffProjectFacts, error) {
	return handoffRead(ctx, s, code, uid, p, func(tx *sql.Tx) (aims.ProductHandoffProjectFacts, error) {
		return aims.LoadProductHandoffProjectFacts(ctx, tx, projectCode, uid)
	})
}
