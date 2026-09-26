package integrationoperation

import (
	"fmt"
	"strings"
)

const (
	TrustedTenantCodeKey                     = "hzy_runtime_tenant_code"
	TrustedDeploymentCodeKey                 = "hzy_runtime_deployment_code"
	TrustedSourceAppKey                      = "hzy_runtime_source_app"
	TrustedServiceClientIDKey                = "hzy_runtime_service_client_id"
	TrustedRequestIDKey                      = "hzy_runtime_request_id"
	TrustedServiceCommandTenantKey           = "hzy_runtime_service_command_tenant_code"
	TrustedServiceCommandSourceDeploymentKey = "hzy_runtime_service_command_source_deployment_code"
	TrustedServiceCommandTargetDeploymentKey = "hzy_runtime_service_command_target_deployment_code"
	TrustedServiceCommandSourceAppKey        = "hzy_runtime_service_command_source_app"
	TrustedServiceCommandTargetAppKey        = "hzy_runtime_service_command_target_app"
	TrustedServiceCommandSourceClientKey     = "hzy_runtime_service_command_source_client_id"
)

type TrustedServiceCommandContext struct {
	TenantCode           string
	SourceDeploymentCode string
	TargetDeploymentCode string
	SourceApp            string
	TargetApp            string
	SourceClientID       string
	RequestID            string
}

func TrustedServiceCommandContextFromMap(values map[string]any) (TrustedServiceCommandContext, error) {
	context := TrustedServiceCommandContext{
		TenantCode:           trustedText(values, TrustedServiceCommandTenantKey),
		SourceDeploymentCode: trustedText(values, TrustedServiceCommandSourceDeploymentKey),
		TargetDeploymentCode: trustedText(values, TrustedServiceCommandTargetDeploymentKey),
		SourceApp:            trustedText(values, TrustedServiceCommandSourceAppKey),
		TargetApp:            trustedText(values, TrustedServiceCommandTargetAppKey),
		SourceClientID:       trustedText(values, TrustedServiceCommandSourceClientKey),
		RequestID:            trustedText(values, TrustedRequestIDKey),
	}
	for name, value := range map[string]string{
		"tenant_code":            context.TenantCode,
		"source_deployment_code": context.SourceDeploymentCode,
		"target_deployment_code": context.TargetDeploymentCode,
		"source_app":             context.SourceApp,
		"target_app":             context.TargetApp,
		"source_client_id":       context.SourceClientID,
	} {
		if !identityValuePattern.MatchString(value) {
			return TrustedServiceCommandContext{}, fmt.Errorf("%w: trusted service command %s", ErrInvalidIdentity, name)
		}
	}
	if context.SourceApp == context.TargetApp {
		return TrustedServiceCommandContext{}, fmt.Errorf("%w: trusted service command source_app and target_app must differ", ErrInvalidIdentity)
	}
	if err := validateOptionalIdentityValue("request_id", context.RequestID); err != nil {
		return TrustedServiceCommandContext{}, err
	}
	return context, nil
}

type TrustedContext struct {
	OutboxTables    *OutboxTables
	TenantCode      string
	DeploymentCode  string
	SourceApp       string
	ServiceClientID string
	RequestID       string
}

// TrustedContextFromMap reads only the reserved values injected by the
// authenticated data-runtime server. Public tenantCode/deploymentCode fields
// are deliberately ignored. Direct adapter callers must supply an equivalent
// trusted context explicitly.
func TrustedContextFromMap(values map[string]any, expectedSourceApp string) (TrustedContext, error) {
	context := TrustedContext{
		TenantCode:      trustedText(values, TrustedTenantCodeKey),
		DeploymentCode:  trustedText(values, TrustedDeploymentCodeKey),
		SourceApp:       trustedText(values, TrustedSourceAppKey),
		ServiceClientID: trustedText(values, TrustedServiceClientIDKey),
		RequestID:       trustedText(values, TrustedRequestIDKey),
	}
	for name, value := range map[string]string{
		"tenant_code":     context.TenantCode,
		"deployment_code": context.DeploymentCode,
		"source_app":      context.SourceApp,
	} {
		if !identityValuePattern.MatchString(value) {
			return TrustedContext{}, fmt.Errorf("%w: trusted %s", ErrInvalidIdentity, name)
		}
	}
	expectedSourceApp = strings.TrimSpace(expectedSourceApp)
	if expectedSourceApp != "" && context.SourceApp != expectedSourceApp {
		return TrustedContext{}, fmt.Errorf("%w: trusted source_app mismatch", ErrInvalidIdentity)
	}
	for name, value := range map[string]string{
		"service_client_id": context.ServiceClientID,
		"request_id":        context.RequestID,
	} {
		if value != "" && !identityValuePattern.MatchString(value) {
			return TrustedContext{}, fmt.Errorf("%w: trusted %s", ErrInvalidIdentity, name)
		}
	}
	return context, nil
}

func trustedText(values map[string]any, key string) string {
	if values == nil || values[key] == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(values[key]))
}
