package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

func verifyKnowledgeAuthorization(r *http.Request, identity auth.Context, actor string, body map[string]any) error {
	raw, ok := body["knowledgeAuthorization"].(string)
	envelope, valid := body["serviceCommand"].(map[string]any)
	if !ok || !valid {
		return httperror.New(403, "knowledge_authorization_invalid", "缺少目标签名许可")
	}
	canonical := enterpriseAltocPermitFieldsCanonical([]any{"hzy-knowledge-authorization.v1", r.Method, r.URL.RequestURI(), identity.Tenant, identity.Deployment, actor, envelope["commandSha256"], raw})
	mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
	mac.Write([]byte(canonical))
	if !hmac.Equal([]byte(r.Header.Get("X-HZY-Knowledge-Authorization-Signature")), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
		return httperror.New(403, "knowledge_authorization_invalid", "目标许可签名无效")
	}
	return nil
}
