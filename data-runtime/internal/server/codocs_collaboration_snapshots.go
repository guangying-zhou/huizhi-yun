package server

// Stage B Collab -> Runtime routes. Collab calls with its own service identity
// (collab.runtime) and exact capabilities; every call is bound to an active
// collaboration session opened by the Host for a verified writer. Registered
// only with apps.codocs.snapshotV2Enabled and apps.codocs.collaborationV2Enabled.

import (
	"context"
	"net/http"
	"time"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	collaborationSnapshotReadCapability    = "codocs:collaboration-snapshots:read"
	collaborationSnapshotPublishCapability = "codocs:collaboration-snapshots:publish"
)

var collaborationSnapshotActions = map[string]string{
	"/v1/codocs/collaboration-snapshots:admit":   collaborationSnapshotReadCapability,
	"/v1/codocs/collaboration-snapshots:read":    collaborationSnapshotReadCapability,
	"/v1/codocs/collaboration-snapshots:prepare": collaborationSnapshotPublishCapability,
	"/v1/codocs/collaboration-snapshots:publish": collaborationSnapshotPublishCapability,
	"/v1/codocs/collaboration-snapshots:renew":   collaborationSnapshotPublishCapability,
	"/v1/codocs/collaboration-snapshots:close":   collaborationSnapshotPublishCapability,
	// Collab holds no storage credential: bytes go through the Runtime, which
	// writes only under the prepared candidate and reads only the published head.
	"/v1/codocs/collaboration-snapshots:upload":   collaborationSnapshotPublishCapability,
	"/v1/codocs/collaboration-snapshots:download": collaborationSnapshotReadCapability,
}

func collaborationInputInvalid() error {
	return httperror.New(http.StatusBadRequest, "collaboration_snapshot_input_invalid", "Invalid collaboration snapshot input")
}

func (s *Server) routeCodocsCollaborationSnapshot(r *http.Request, path, capability string) (routeResult, error) {
	identity, err := s.auth.Authenticate(r, auth.Requirement{AppCode: "codocs", SourceAppCode: "collab", Scope: capability, StrictServiceClaims: true, RequireDeploymentBinding: true})
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "codocs.collaboration_snapshots" + path[len("/v1/codocs/collaboration-snapshots"):], Auth: &identity}
	if s.codocs == nil {
		return result, httperror.New(http.StatusServiceUnavailable, "collaboration_unavailable", "Codocs domain is unavailable")
	}
	if identity.Mode != string(config.AuthJWT) || identity.Tenant != s.cfg.Tenant || identity.Deployment == "" || identity.Deployment != s.cfg.DeploymentBindings["collab"] ||
		identity.ClientID != "collab.runtime" || identity.Subject != "client:collab.runtime" || identity.CredentialID <= 0 || !hasExactCapability(identity.Scopes, capability) {
		return result, httperror.New(http.StatusForbidden, "collaboration_identity_mismatch", "Collab runtime identity does not match its binding")
	}
	active, err := s.verifyEnterpriseCredential(r.Context(), identity, capability)
	if err != nil {
		return result, httperror.New(http.StatusServiceUnavailable, "collaboration_credential_unavailable", "Collab credential state is unavailable")
	}
	if !active {
		return result, httperror.New(http.StatusForbidden, "collaboration_credential_inactive", "Collab credential or grant is inactive")
	}
	if r.URL.RawQuery != "" {
		return result, collaborationInputInvalid()
	}
	limit := int64(1 << 20)
	if path == "/v1/codocs/collaboration-snapshots:upload" {
		limit = collaborationUploadBodyLimit
	}
	body, _, err := readJSONBodyWithRawLimit(r, limit)
	if err != nil {
		return result, err
	}
	if path == "/v1/codocs/collaboration-snapshots:admit" {
		ticket, _ := body["ticket"].(string)
		if len(body) != 1 || ticket == "" {
			return result, collaborationInputInvalid()
		}
		admission, admitErr := s.codocs.AdmitCollaborationTicket(r.Context(), s.cfg.Tenant, s.cfg.DeploymentBindings["codocs"], ticket)
		if admitErr != nil {
			return result, admitErr
		}
		result.Body = map[string]any{"success": true, "data": map[string]any{"sessionId": admission.SessionID, "documentUuid": admission.DocumentUUID, "userUid": admission.UserUID, "access": admission.Access, "epoch": admission.Epoch, "generation": admission.Generation, "expiresAt": admission.ExpiresAt.UTC().Format(time.RFC3339)}}
		return result, nil
	}
	sessionID, _ := body["sessionId"].(string)
	delete(body, "sessionId")
	cid := codocsapp.CollaborationIdentity{Tenant: s.cfg.Tenant, Deployment: s.cfg.DeploymentBindings["codocs"], SessionID: sessionID, RequestID: requestID(r), Key: r.Header.Get("Idempotency-Key")}
	value, err := s.codocsCollaborationSnapshot(r.Context(), path, cid, body)
	result.Body = map[string]any{"success": err == nil, "data": value}
	return result, err
}

func (s *Server) codocsCollaborationSnapshot(ctx context.Context, path string, cid codocsapp.CollaborationIdentity, body map[string]any) (any, error) {
	switch path {
	case "/v1/codocs/collaboration-snapshots:renew":
		if len(body) != 0 {
			return nil, collaborationInputInvalid()
		}
		expires, err := s.codocs.RenewCollaborationSession(ctx, cid)
		if err != nil {
			return nil, err
		}
		return map[string]any{"expiresAt": expires.UTC().Format(time.RFC3339)}, nil
	case "/v1/codocs/collaboration-snapshots:close":
		if len(body) != 0 {
			return nil, collaborationInputInvalid()
		}
		return map[string]any{"closed": true}, s.codocs.CloseCollaborationSession(ctx, cid)
	}
	id, documentUUID, epoch, expiresAt, err := s.codocs.ResolveCollaborationSession(ctx, cid)
	if err != nil {
		return nil, err
	}
	switch path {
	case "/v1/codocs/collaboration-snapshots:read":
		if len(body) != 0 {
			return nil, collaborationInputInvalid()
		}
		read, err := s.codocs.ReadDocumentSnapshot(ctx, id, documentUUID)
		if err != nil {
			return nil, err
		}
		value := map[string]any{"documentUuid": documentUUID, "generation": read.Generation, "epoch": read.Epoch, "sessionEpoch": epoch, "expiresAt": expiresAt.UTC().Format(time.RFC3339), "markdownSize": read.MarkdownSize, "markdownSha256": read.MarkdownSHA256, "yjsSize": read.YjsSize, "yjsSha256": read.YjsSHA256}
		if read.Objects != nil {
			objects := map[string]any{"markdown": map[string]string{"key": read.Objects.Markdown.Key, "version": read.Objects.Markdown.Version}}
			if read.Objects.Yjs != nil {
				objects["yjs"] = map[string]string{"key": read.Objects.Yjs.Key, "version": read.Objects.Yjs.Version}
			}
			value["objects"] = objects
		}
		return value, nil
	case "/v1/codocs/collaboration-snapshots:upload":
		return s.uploadCollaborationObject(ctx, id, documentUUID, cid.Key, body)
	case "/v1/codocs/collaboration-snapshots:download":
		return s.downloadCollaborationObject(ctx, id, documentUUID, body)
	case "/v1/codocs/collaboration-snapshots:prepare", "/v1/codocs/collaboration-snapshots:publish":
		if cid.Key == "" {
			return nil, collaborationInputInvalid()
		}
		publish := path == "/v1/codocs/collaboration-snapshots:publish"
		cmd, objects, err := decodeSnapshotCommand(documentUUID, body, publish)
		if err != nil {
			return nil, err
		}
		if cmd.YjsSHA256 == "" || (publish && objects.Yjs == nil) {
			return nil, httperror.New(http.StatusBadRequest, "collaboration_snapshot_pair_required", "Collaboration snapshots publish Markdown and Yjs together")
		}
		var plan codocsapp.SnapshotPlan
		if publish {
			plan, err = s.codocs.PublishDocumentSnapshot(ctx, id, cmd, objects, s.codocsSnapshotVerifier())
		} else {
			plan, err = s.codocs.PrepareDocumentSnapshot(ctx, id, cmd)
		}
		if err != nil {
			return nil, err
		}
		return map[string]any{"candidate": plan.Candidate, "prefix": plan.Prefix, "generation": plan.Generation, "replayed": plan.Replayed}, nil
	}
	return nil, collaborationInputInvalid()
}
