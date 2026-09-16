package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const serviceCommandSignatureMaxAge = 60 * time.Second

var serviceCommandHeaderNames = []string{
	"X-HZY-Service-Command-Tenant",
	"X-HZY-Service-Command-Source-Deployment",
	"X-HZY-Service-Command-Target-Deployment",
	"X-HZY-Service-Command-Source-App",
	"X-HZY-Service-Command-Target-App",
	"X-HZY-Service-Command-Source-Client",
	"X-HZY-Service-Command-Operation-Id",
	"X-HZY-Service-Command-Operation-Code",
	"X-HZY-Service-Command-Capability",
	"X-HZY-Service-Command-Idempotency-Key",
	"X-HZY-Service-Command-Schema-Version",
	"X-HZY-Service-Command-SHA256",
	"X-HZY-Service-Command-Signed-At",
	"X-HZY-Service-Command-Signature",
}

func injectTrustedServiceCommandContext(r *http.Request, authCtx auth.Context, body map[string]any) error {
	rawEnvelope, hasEnvelope := body[integrationoperation.ServiceCommandEnvelopeKey]
	if !hasEnvelope {
		for _, name := range serviceCommandHeaderNames {
			if strings.TrimSpace(r.Header.Get(name)) != "" {
				return serviceCommandForbidden("service command headers require a service command envelope")
			}
		}
		return nil
	}
	envelope, ok := rawEnvelope.(map[string]any)
	if !ok {
		return serviceCommandForbidden("service command envelope is invalid")
	}

	values := map[string]string{}
	for _, name := range serviceCommandHeaderNames {
		values[name] = strings.TrimSpace(r.Header.Get(name))
		if values[name] == "" {
			return serviceCommandForbidden("service command signature context is incomplete")
		}
	}
	requestIDValue := requestID(r)
	if values["X-HZY-Service-Command-Tenant"] != strings.TrimSpace(authCtx.Tenant) ||
		values["X-HZY-Service-Command-Target-Deployment"] != strings.TrimSpace(authCtx.Deployment) ||
		values["X-HZY-Service-Command-Target-App"] != strings.TrimSpace(authCtx.AppCode) ||
		values["X-HZY-Service-Command-Source-App"] == values["X-HZY-Service-Command-Target-App"] {
		return serviceCommandForbidden("service command runtime identity does not match the target bearer")
	}
	for header, field := range map[string]string{
		"X-HZY-Service-Command-Target-App":      "targetApp",
		"X-HZY-Service-Command-Operation-Id":    "operationId",
		"X-HZY-Service-Command-Operation-Code":  "operationCode",
		"X-HZY-Service-Command-Capability":      "requiredCapability",
		"X-HZY-Service-Command-Idempotency-Key": "idempotencyKey",
		"X-HZY-Service-Command-Schema-Version":  "commandSchemaVersion",
		"X-HZY-Service-Command-SHA256":          "commandSha256",
	} {
		if values[header] != strings.TrimSpace(fmt.Sprint(envelope[field])) {
			return serviceCommandForbidden("service command envelope does not match the signed context")
		}
	}
	// Some older command families predate explicit source/deployment fields in
	// their envelopes. When those fields are declared, however, they are
	// security assertions and must match the signed transport identity.
	for header, field := range map[string]string{
		"X-HZY-Service-Command-Source-App":        "sourceApp",
		"X-HZY-Service-Command-Source-Deployment": "sourceDeployment",
		"X-HZY-Service-Command-Target-Deployment": "targetDeployment",
	} {
		raw, declaredField := envelope[field]
		if !declaredField || raw == nil {
			continue
		}
		if declared := strings.TrimSpace(fmt.Sprint(raw)); declared != "" && values[header] != declared {
			return serviceCommandForbidden("service command envelope source binding does not match the signed context")
		}
	}

	signedAtMillis, err := strconv.ParseInt(values["X-HZY-Service-Command-Signed-At"], 10, 64)
	if err != nil {
		return serviceCommandForbidden("service command signature time is invalid")
	}
	signedAt := time.UnixMilli(signedAtMillis)
	now := timeNow()
	if signedAt.After(now.Add(5*time.Second)) || now.Sub(signedAt) > serviceCommandSignatureMaxAge {
		return serviceCommandForbidden("service command signature expired")
	}

	canonical := strings.Join([]string{
		r.Method,
		r.URL.RequestURI(),
		values["X-HZY-Service-Command-Tenant"],
		values["X-HZY-Service-Command-Source-Deployment"],
		values["X-HZY-Service-Command-Target-Deployment"],
		values["X-HZY-Service-Command-Source-App"],
		values["X-HZY-Service-Command-Source-Client"],
		values["X-HZY-Service-Command-Target-App"],
		values["X-HZY-Service-Command-Operation-Id"],
		values["X-HZY-Service-Command-Operation-Code"],
		values["X-HZY-Service-Command-Capability"],
		values["X-HZY-Service-Command-Idempotency-Key"],
		values["X-HZY-Service-Command-Schema-Version"],
		values["X-HZY-Service-Command-SHA256"],
		requestIDValue,
		values["X-HZY-Service-Command-Signed-At"],
	}, "\n")
	mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
	_, _ = mac.Write([]byte(canonical))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(values["X-HZY-Service-Command-Signature"])) {
		return serviceCommandForbidden("service command signature is invalid")
	}

	body[integrationoperation.TrustedServiceCommandTenantKey] = values["X-HZY-Service-Command-Tenant"]
	body[integrationoperation.TrustedServiceCommandSourceDeploymentKey] = values["X-HZY-Service-Command-Source-Deployment"]
	body[integrationoperation.TrustedServiceCommandTargetDeploymentKey] = values["X-HZY-Service-Command-Target-Deployment"]
	body[integrationoperation.TrustedServiceCommandSourceAppKey] = values["X-HZY-Service-Command-Source-App"]
	body[integrationoperation.TrustedServiceCommandTargetAppKey] = values["X-HZY-Service-Command-Target-App"]
	body[integrationoperation.TrustedServiceCommandSourceClientKey] = values["X-HZY-Service-Command-Source-Client"]
	return nil
}

func serviceCommandPayload(body map[string]any) (map[string]any, bool) {
	rawEnvelope, ok := body[integrationoperation.ServiceCommandEnvelopeKey]
	if !ok {
		return body, false
	}
	envelope, ok := rawEnvelope.(map[string]any)
	if !ok {
		return nil, false
	}
	command, ok := envelope["command"].(map[string]any)
	return command, ok
}

func serviceCommandForbidden(message string) error {
	return httperror.New(http.StatusForbidden, "service_command_context_invalid", message)
}
