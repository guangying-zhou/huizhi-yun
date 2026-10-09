package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"sort"
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
	var security, confidentiality string
	var whitelist sql.NullString
	var portfolio sql.NullInt64
	err := q.QueryRowContext(ctx, "SELECT name,short_name,internal_code,description,methodology,portfolio_id,domain_code,dept_code,leader_uid,CAST(start_date AS CHAR),CAST(end_date AS CHAR),security_level,confidentiality_level,CAST(access_whitelist AS CHAR) FROM aims_projects WHERE id=?"+suffix, id).Scan(&name, &short, &internal, &description, &method, &portfolio, &domain, &dept, &leader, &start, &end, &security, &confidentiality, &whitelist)
	if err != nil {
		return nil, "", err
	}
	var p any
	if portfolio.Valid {
		p = portfolio.Int64
	}
	var whitelistValue any
	if whitelist.Valid {
		var values []string
		if err := json.Unmarshal([]byte(whitelist.String), &values); err != nil {
			return nil, "", err
		}
		if values == nil {
			values = []string{}
		}
		sort.Strings(values)
		whitelistValue = values
	}
	snapshot := map[string]any{"name": name, "shortName": short, "internalCode": nullableString(internal), "description": nullableString(description), "methodology": method, "portfolioId": p, "domainCode": nullableString(domain), "deptCode": nullableString(dept), "leaderUid": leader, "startDate": nullableString(start), "endDate": nullableString(end), "securityLevel": security, "confidentialityLevel": confidentiality, "accessWhitelist": whitelistValue}
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
