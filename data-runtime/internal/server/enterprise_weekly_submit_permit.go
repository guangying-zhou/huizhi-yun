package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// This permit proves the Host checked the user's weekly_reports:submit grant.
// It is separate from the reports:edit project scope and the manager relation.
type enterpriseWeeklySubmitPermit struct {
	ActorUID   string `json:"actorUid"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	Resource   string `json:"resource"`
	Action     string `json:"action"`
	ProjectID  string `json:"projectId"`
	ExpiresAt  int64  `json:"expiresAt"`
}

func enterpriseWeeklySubmitPermitCanonical(r *http.Request, p enterpriseWeeklySubmitPermit) string {
	return enterpriseAltocPermitFieldsCanonical([]any{
		"hzy-enterprise-weekly-report-submit-permit.v1", r.Method, r.URL.RequestURI(),
		p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.ProjectID, p.ExpiresAt,
	})
}

func validateEnterpriseWeeklySubmitPermit(r *http.Request, p *enterpriseWeeklySubmitPermit, tenant, deployment, projectID, actor string, now time.Time) error {
	denied := httperror.New(http.StatusForbidden, "enterprise_weekly_submit_permit_invalid", "Weekly report submit authorization is invalid")
	if p == nil || p.ActorUID != actor || p.Tenant != tenant || p.Deployment != deployment ||
		p.Resource != "weekly_reports" || p.Action != "submit" || p.ProjectID != projectID ||
		p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
		return denied
	}
	token, signature := runtimeBearerToken(r), r.Header.Get("X-HZY-Enterprise-Weekly-Report-Submit-Permit-Signature")
	if token == "" || signature == "" {
		return denied
	}
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(enterpriseWeeklySubmitPermitCanonical(r, *p)))
	if !hmac.Equal([]byte(signature), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return denied
	}
	return nil
}
