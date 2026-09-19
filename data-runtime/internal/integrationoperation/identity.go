package integrationoperation

import (
	"errors"
	"fmt"
	"regexp"
)

var (
	ErrInvalidIdentity   = errors.New("invalid integration operation identity")
	ErrImmutableIdentity = errors.New("integration operation identity is immutable")
)

var (
	identityValuePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$`)
	sha256Pattern        = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

type Identity struct {
	TenantCode     string
	DeploymentCode string
	SourceApp      string
	TargetApp      string
	OperationCode  string
	SourceBizType  string
	SourceBizCode  string
	IdempotencyKey string
	CommandSHA256  string
}

func (identity Identity) Validate() error {
	if err := identity.validateFields(); err != nil {
		return err
	}
	if identity.SourceApp == identity.TargetApp {
		return fmt.Errorf("%w: source_app and target_app must differ", ErrInvalidIdentity)
	}
	return nil
}

func (identity Identity) validateFields() error {
	fields := []struct {
		name  string
		value string
	}{
		{"tenant_code", identity.TenantCode},
		{"deployment_code", identity.DeploymentCode},
		{"source_app", identity.SourceApp},
		{"target_app", identity.TargetApp},
		{"operation_code", identity.OperationCode},
		{"source_biz_type", identity.SourceBizType},
		{"source_biz_code", identity.SourceBizCode},
		{"idempotency_key", identity.IdempotencyKey},
	}
	for _, field := range fields {
		if !identityValuePattern.MatchString(field.value) {
			return fmt.Errorf("%w: %s", ErrInvalidIdentity, field.name)
		}
	}
	if !sha256Pattern.MatchString(identity.CommandSHA256) {
		return fmt.Errorf("%w: command_sha256", ErrInvalidIdentity)
	}
	return nil
}

func ValidateImmutableIdentity(original Identity, proposed Identity) error {
	if err := original.Validate(); err != nil {
		return err
	}
	if err := proposed.Validate(); err != nil {
		return err
	}
	fields := []struct {
		name     string
		original string
		proposed string
	}{
		{"tenant_code", original.TenantCode, proposed.TenantCode},
		{"deployment_code", original.DeploymentCode, proposed.DeploymentCode},
		{"source_app", original.SourceApp, proposed.SourceApp},
		{"target_app", original.TargetApp, proposed.TargetApp},
		{"operation_code", original.OperationCode, proposed.OperationCode},
		{"source_biz_type", original.SourceBizType, proposed.SourceBizType},
		{"source_biz_code", original.SourceBizCode, proposed.SourceBizCode},
		{"idempotency_key", original.IdempotencyKey, proposed.IdempotencyKey},
		{"command_sha256", original.CommandSHA256, proposed.CommandSHA256},
	}
	for _, field := range fields {
		if field.original != field.proposed {
			return fmt.Errorf("%w: %s", ErrImmutableIdentity, field.name)
		}
	}
	return nil
}
