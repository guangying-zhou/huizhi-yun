package server

// Collab -> Runtime handling specific to department sessions: ticket
// redemption and lease renewal with per-participant Directory re-verification.
// The capabilities are the same collab.runtime read/publish pair as personal
// sessions; only the request/response fields below differ.

import (
	"context"
	"net/http"
	"strings"
	"time"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func errDepartmentSessionDisabled() error {
	return httperror.New(http.StatusConflict, "collaboration_session_invalid", "Collaboration session is no longer valid")
}

func (s *Server) admitDepartmentCollaborationTicket(ctx context.Context, deployment, ticket string, peek codocsapp.CollaborationTicketPeek) (codocsapp.CollaborationAdmission, error) {
	if !s.departmentCollaborationEnabled() {
		return codocsapp.CollaborationAdmission{}, errDepartmentSessionDisabled()
	}
	// The user's relation is re-read under Directory locks that outlive the
	// Codocs redemption transaction.
	roles, release, err := s.departmentRoleLocker()(ctx, peek.DeptCode, []string{peek.UserUID})
	if err != nil {
		return codocsapp.CollaborationAdmission{}, err
	}
	defer release()
	return s.codocs.AdmitDepartmentCollaborationTicket(ctx, s.cfg.Tenant, deployment, ticket, peek, roles[peek.UserUID])
}

// maxConnectedUids bounds the renew report; the writer cap is 20.
const maxConnectedUids = 100

// renewCollaborationSession extends a lease. Personal sessions accept no body
// and answer {expiresAt}. Department sessions optionally take
// {connectedUids:[...]} (the users with a live connection), re-verify every
// participant, and answer {expiresAt, revokedUids:[...]}.
func (s *Server) renewCollaborationSession(ctx context.Context, cid codocsapp.CollaborationIdentity, body map[string]any) (any, error) {
	var connected []string
	reported := false
	if len(body) != 0 {
		raw, ok := body["connectedUids"].([]any)
		if len(body) != 1 || !ok || len(raw) > maxConnectedUids {
			return nil, collaborationInputInvalid()
		}
		reported = true
		connected = make([]string, 0, len(raw))
		for _, item := range raw {
			uid, ok := item.(string)
			if !ok || uid == "" || len(uid) > 128 || strings.TrimSpace(uid) != uid {
				return nil, collaborationInputInvalid()
			}
			connected = append(connected, uid)
		}
	}
	info, err := s.codocs.ResolveCollaborationSessionInfo(ctx, cid)
	if err != nil {
		return nil, err
	}
	if info.Policy == "department" {
		if !s.departmentCollaborationEnabled() {
			return nil, errDepartmentSessionDisabled()
		}
		expires, revoked, err := s.codocs.RenewDepartmentCollaborationSession(ctx, cid, connected, reported, s.departmentRoleLocker())
		if err != nil {
			return nil, err
		}
		if revoked == nil {
			revoked = []string{}
		}
		return map[string]any{"expiresAt": expires.UTC().Format(time.RFC3339), "revokedUids": revoked}, nil
	}
	if reported {
		return nil, collaborationInputInvalid()
	}
	expires, err := s.codocs.RenewCollaborationSession(ctx, cid)
	if err != nil {
		return nil, err
	}
	return map[string]any{"expiresAt": expires.UTC().Format(time.RFC3339)}, nil
}
