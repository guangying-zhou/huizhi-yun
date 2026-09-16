package integrationoperation

import (
	"encoding/json"
	"fmt"
	"strings"
)

const ServiceCommandEnvelopeKey = "serviceCommand"

func ReceiptCommandFromBody(
	body map[string]any,
	expectedTargetApp string,
	expectedOperationCode string,
	expectedCapability string,
) (ReceiptCommandInput, map[string]any, error) {
	serviceContext, err := TrustedServiceCommandContextFromMap(body)
	if err != nil {
		return ReceiptCommandInput{}, nil, err
	}
	trusted := TrustedContext{
		TenantCode:      serviceContext.TenantCode,
		DeploymentCode:  serviceContext.SourceDeploymentCode,
		SourceApp:       serviceContext.SourceApp,
		ServiceClientID: serviceContext.SourceClientID,
		RequestID:       serviceContext.RequestID,
	}
	envelope, ok := body[ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return ReceiptCommandInput{}, nil, fmt.Errorf("service command envelope is required")
	}
	command, ok := envelope["command"].(map[string]any)
	if !ok {
		return ReceiptCommandInput{}, nil, fmt.Errorf("service command payload is required")
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return ReceiptCommandInput{}, nil, err
	}
	input := ReceiptCommandInput{
		TrustedContext:       trusted,
		SourceDeploymentCode: serviceContext.SourceDeploymentCode,
		TargetDeploymentCode: serviceContext.TargetDeploymentCode,
		TargetApp:            strings.TrimSpace(fmt.Sprint(envelope["targetApp"])),
		OperationID:          strings.TrimSpace(fmt.Sprint(envelope["operationId"])),
		OperationCode:        strings.TrimSpace(fmt.Sprint(envelope["operationCode"])),
		RequiredCapability:   strings.TrimSpace(fmt.Sprint(envelope["requiredCapability"])),
		IdempotencyKey:       strings.TrimSpace(fmt.Sprint(envelope["idempotencyKey"])),
		CommandSchemaVersion: strings.TrimSpace(fmt.Sprint(envelope["commandSchemaVersion"])),
		CommandSHA256:        strings.TrimSpace(fmt.Sprint(envelope["commandSha256"])),
		Command:              commandJSON,
		CorrelationID:        trustedText(envelope, "correlationId"),
	}
	if input.TargetApp != expectedTargetApp || input.OperationCode != expectedOperationCode || input.RequiredCapability != expectedCapability {
		return ReceiptCommandInput{}, nil, ErrIdempotencyPayloadMismatch
	}
	if serviceContext.TargetApp != input.TargetApp {
		return ReceiptCommandInput{}, nil, ErrIdempotencyPayloadMismatch
	}
	if err := validateReceiptCommandInput(input); err != nil {
		return ReceiptCommandInput{}, nil, err
	}
	return input, command, nil
}

// CopyTrustedRuntimeCommandContext copies only values injected by the runtime
// after authentication. It must be called after the frozen command digest has
// been verified so transport context never changes the command hash.
func CopyTrustedRuntimeCommandContext(target map[string]any, outer map[string]any) {
	for _, key := range []string{
		"current_user",
		"operator_uid",
		"current_user_scopes",
		TrustedTenantCodeKey,
		TrustedDeploymentCodeKey,
		TrustedSourceAppKey,
		TrustedServiceClientIDKey,
		TrustedRequestIDKey,
		TrustedServiceCommandTenantKey,
		TrustedServiceCommandSourceDeploymentKey,
		TrustedServiceCommandTargetDeploymentKey,
		TrustedServiceCommandSourceAppKey,
		TrustedServiceCommandTargetAppKey,
		TrustedServiceCommandSourceClientKey,
	} {
		if value, ok := outer[key]; ok {
			target[key] = value
		}
	}
}
