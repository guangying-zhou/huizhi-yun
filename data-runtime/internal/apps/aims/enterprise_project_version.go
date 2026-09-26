package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
)

type projectVersionQuery interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func enterpriseProjectSnapshot(ctx context.Context, q projectVersionQuery, id string, lock bool) (map[string]any, string, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	var name, short, method, leader string
	var internal, description, domain, dept, start, end sql.NullString
	var portfolio sql.NullInt64
	err := q.QueryRowContext(ctx, "SELECT name,short_name,internal_code,description,methodology,portfolio_id,domain_code,dept_code,leader_uid,CAST(start_date AS CHAR),CAST(end_date AS CHAR) FROM aims_projects WHERE id=?"+suffix, id).Scan(&name, &short, &internal, &description, &method, &portfolio, &domain, &dept, &leader, &start, &end)
	if err != nil {
		return nil, "", err
	}
	var p any
	if portfolio.Valid {
		p = portfolio.Int64
	}
	snapshot := map[string]any{"name": name, "shortName": short, "internalCode": nullableString(internal), "description": nullableString(description), "methodology": method, "portfolioId": p, "domainCode": nullableString(domain), "deptCode": nullableString(dept), "leaderUid": leader, "startDate": nullableString(start), "endDate": nullableString(end)}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return snapshot, hex.EncodeToString(sum[:]), nil
}
func (a *Adapter) EnterpriseProjectEditableSnapshot(ctx context.Context, id string) (map[string]any, string, error) {
	return enterpriseProjectSnapshot(ctx, a.DB(), id, false)
}
