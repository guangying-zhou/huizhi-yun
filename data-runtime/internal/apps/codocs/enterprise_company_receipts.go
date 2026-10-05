package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Enterprise is the verified caller and Codocs the owning domain. This uses
// the existing cross-application receipt contract; no Codocs-owned CHECK
// expansion, new capability or grant is required.
type EnterpriseCompanyCommandIdentity struct {
	Tenant, SourceDeployment, TargetDeployment, Actor, Client, RequestID, Key string
}

func (i EnterpriseCompanyCommandIdentity) valid() bool {
	return i.Tenant != "" && i.SourceDeployment != "" && i.TargetDeployment != "" && i.Actor != "" && i.Client == "enterprise.runtime" && i.Key != "" && len(i.Key) <= 200
}

func enterpriseCompanyReceiptInput(identity EnterpriseCompanyCommandIdentity, operation, schema string, command map[string]any) (io.ReceiptCommandInput, error) {
	if !identity.valid() {
		return io.ReceiptCommandInput{}, httperror.New(403, "company_command_identity_invalid", "Bound enterprise command identity required")
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return io.ReceiptCommandInput{}, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return io.ReceiptCommandInput{}, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{operation, identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	key := hex.EncodeToString(ns[:])
	return io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs",
		OperationID:   fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16]),
		OperationCode: operation, RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: schema, CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
	}, nil
}

func (a *Adapter) enterpriseCompanyReceipt(ctx context.Context, identity EnterpriseCompanyCommandIdentity, operation, schema string, command map[string]any, handler io.ReceiptHandler) (io.ReceiptExecutionResult, error) {
	input, err := enterpriseCompanyReceiptInput(identity, operation, schema, command)
	if err != nil {
		return io.ReceiptExecutionResult{}, err
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return io.ReceiptExecutionResult{}, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return io.ReceiptExecutionResult{}, err
	}
	defer tx.Rollback()
	result, err := repo.ExecuteInTransaction(ctx, tx, input, handler)
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return io.ReceiptExecutionResult{}, httperror.New(http.StatusConflict, "company_command_key_conflict", "Idempotency key was used for another command")
	}
	if err != nil {
		return io.ReceiptExecutionResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return io.ReceiptExecutionResult{}, err
	}
	return result, nil
}

func (a *Adapter) RecordEnterpriseCompanyAssetAccess(ctx context.Context, identity EnterpriseCompanyCommandIdentity, path, eventID string) (map[string]any, error) {
	if !validPublishedAssetPath(path) || (!strings.HasPrefix(path, "codocs/company/") && !strings.HasPrefix(path, "codocs/departments/")) {
		return nil, httperror.New(400, "invalid_asset_path", "Invalid company asset path")
	}
	parsedEventID, err := uuid.Parse(eventID)
	if err != nil || parsedEventID.String() != eventID {
		return nil, httperror.New(400, "invalid_access_event", "A valid access event ID is required")
	}
	command := map[string]any{"path": path, "eventId": eventID}
	result, err := a.enterpriseCompanyReceipt(ctx, identity, "enterprise.codocs.company-access.record.v1", "company-access-record.v1", command,
		func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
			if _, err := tx.ExecContext(ctx, `INSERT INTO company_asset_access_records (id,oss_path_hash,oss_path,viewer_uid,viewed_at)
			VALUES (?,?,?, ?,UTC_TIMESTAMP(3))`, eventID, sha256Bytes(path), path, identity.Actor); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			return io.ReceiptBusinessResult{TargetBizType: "company_asset_access", TargetBizCode: eventID, HTTPStatus: 200}, nil
		})
	if err != nil {
		return nil, err
	}
	if result.TargetBizCode != eventID {
		return nil, httperror.New(409, "company_access_receipt_conflict", "Access receipt conflicts with current request")
	}
	return map[string]any{"recorded": true, "id": eventID, "replayed": result.Existing}, nil
}

func sha256Bytes(value string) []byte { sum := sha256.Sum256([]byte(value)); return sum[:] }

func (a *Adapter) CreateEnterprisePublishedAssetLink(ctx context.Context, identity EnterpriseCompanyCommandIdentity, path string) (map[string]any, error) {
	if !validPublishedAssetPath(path) {
		return nil, httperror.New(400, "invalid_asset_path", "Invalid published asset path")
	}
	token := publishedAssetLinkToken(path)
	result, err := a.enterpriseCompanyReceipt(ctx, identity, "enterprise.codocs.asset-link.create.v1", "asset-link-create.v1", map[string]any{"path": path},
		func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
			if _, err := tx.ExecContext(ctx, `INSERT INTO published_asset_links (token,oss_path,created_by,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE token=token`, token, path, identity.Actor); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			var stored string
			if err := tx.QueryRowContext(ctx, `SELECT oss_path FROM published_asset_links WHERE token=? FOR UPDATE`, token).Scan(&stored); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			if stored != path {
				return io.ReceiptBusinessResult{}, httperror.New(409, "published_asset_link_collision", "Published asset short link collision")
			}
			return io.ReceiptBusinessResult{TargetBizType: "published_asset_link", TargetBizCode: token, HTTPStatus: 200}, nil
		})
	if err != nil {
		return nil, err
	}
	if result.TargetBizCode != token {
		return nil, httperror.New(409, "asset_link_receipt_conflict", "Link receipt conflicts with current request")
	}
	// A replay never grants content access. The Host independently checks the
	// current object permission and OSS existence before/after resolution.
	return map[string]any{"token": token, "path": path, "replayed": result.Existing}, nil
}
