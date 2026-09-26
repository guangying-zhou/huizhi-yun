package server

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/policyenvelope"
)

// consoleServiceKeyMode marks service tokens issued from a Console key
// assertion (R1) instead of a Platform bootstrap token.
const consoleServiceKeyMode = "console_service_key"

func consoleAssertionBearer(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 8 || !strings.EqualFold(header[:7], "Bearer ") {
		return ""
	}
	token := strings.TrimSpace(header[7:])
	if !policyenvelope.IsConsoleAssertion(token) {
		return ""
	}
	return token
}

// authenticateConsoleAssertion accepts a Console deployment key assertion for
// console:service-token:issue only. The key must be signed into the stored
// Console policy envelope, that envelope must be valid or in outage grace, and
// each assertion id is accepted once.
func (s *Server) authenticateConsoleAssertion(r *http.Request, token string) (auth.Context, error) {
	if err := s.verifiedPolicyConfigured(); err != nil {
		return auth.Context{}, err
	}
	adapter, err := s.requireConsole()
	if err != nil {
		return auth.Context{}, err
	}
	deployment := strings.TrimSpace(s.cfg.DeploymentForApp("console"))
	tenant := strings.TrimSpace(s.cfg.Tenant)
	if deployment == "" || tenant == "" {
		return auth.Context{}, httperror.New(503, "policy_snapshot_not_configured", "Verified policy storage is not configured")
	}
	snapshot, renewal, err := s.verifiedPolicyStore(adapter.DB(), tenant, deployment).ReadWithRenewal(r.Context())
	if errors.Is(err, policyenvelope.ErrNotFound) {
		return auth.Context{}, httperror.New(403, "console_assertion_policy_inactive", "Console service key is not authorized by a current policy")
	}
	if err != nil {
		return auth.Context{}, httperror.New(503, "policy_snapshot_unavailable", "Policy storage unavailable")
	}
	var body policyenvelope.Body
	if json.Unmarshal([]byte(snapshot.Envelope.Body), &body) != nil {
		return auth.Context{}, httperror.New(503, "policy_snapshot_unavailable", "Policy storage unavailable")
	}
	now := time.Now().UnixMilli()
	claims, validity, err := policyenvelope.VerifyConsoleAssertion(token, body, renewal, policyenvelope.AssertionBinding{Tenant: tenant, Deployment: deployment}, now)
	switch {
	case errors.Is(err, policyenvelope.ErrAssertionPolicy):
		log.Printf("[auth] reject reason=console_assertion_policy_inactive deployment=%q verdict=%s", deployment, validity.Verdict)
		return auth.Context{}, httperror.New(403, "console_assertion_policy_inactive", "Console service key is not authorized by a current policy")
	case err != nil:
		log.Printf("[auth] reject reason=console_assertion_invalid deployment=%q", deployment)
		return auth.Context{}, httperror.New(401, "console_assertion_invalid", "Console service assertion is invalid")
	}
	db := adapter.DB()
	_, err = db.ExecContext(r.Context(), `INSERT INTO console_service_assertion_replay (jti, deployment_code, expires_at) VALUES (?,?,?)`, claims.ID, deployment, claims.ExpiresAt*1000)
	var mysqlError *mysql.MySQLError
	switch {
	case errors.As(err, &mysqlError) && mysqlError.Number == 1062:
		log.Printf("[auth] reject reason=console_assertion_replayed deployment=%q", deployment)
		return auth.Context{}, httperror.New(401, "console_assertion_replayed", "Console service assertion was already used")
	case errors.As(err, &mysqlError) && mysqlError.Number == 1146:
		return auth.Context{}, httperror.New(503, "console_assertion_not_migrated", "Console service assertion storage is not migrated")
	case err != nil:
		return auth.Context{}, httperror.New(503, "console_assertion_unavailable", "Console service assertion storage unavailable")
	}
	// Bounded cleanup; failure only delays it.
	_, _ = db.ExecContext(r.Context(), `DELETE FROM console_service_assertion_replay WHERE expires_at < ? LIMIT 100`, now-policyenvelope.AssertionMaxAgeMS)
	log.Printf("[auth] console_service_assertion accepted deployment=%q verdict=%s", deployment, validity.Verdict)
	return auth.Context{
		Tenant:     tenant,
		Deployment: deployment,
		AppCode:    "console",
		Subject:    claims.Subject,
		Scopes:     []string{policyenvelope.AssertionScope},
		Mode:       consoleServiceKeyMode,
	}, nil
}
