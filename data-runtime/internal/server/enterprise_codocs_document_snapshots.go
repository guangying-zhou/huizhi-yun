package server

// Trusted v2 snapshot routes for Enterprise personal documents. They are
// registered only when apps.codocs.snapshotV2Enabled is true (default false)
// and reuse the exact personal-documents edit/read capabilities. See
// docs/Codocs-Document-Write-Coordination.md for the release gates.

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"sync"
	"time"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseCodocsDocumentSnapshotSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_document_snapshot",
	Actions: map[string]enterpriseDelegatedAction{
		"snapshot-prepare": {Method: http.MethodPost, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: snapshotTarget},
		"snapshot-publish": {Method: http.MethodPost, PermitAction: "edit", AllowPayload: true, CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: snapshotTarget},
		"snapshot-read":    {Method: http.MethodGet, PermitAction: "read", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: snapshotTarget},
	},
}

// Snapshot actions are served in-process; the target is never proxied.
func snapshotTarget(in enterpriseDelegatedInput) string {
	return "/v1/codocs/documents/" + in.Code + "/snapshot"
}

var enterpriseCodocsDocumentSnapshotRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsDocumentSnapshotSpec)

// Stage B: the Host opens (or renews) a collaboration session for a verified
// writer of a v2 document. Registered only with apps.codocs.collaborationV2Enabled.
var enterpriseCodocsCollaborationSessionSpec = enterpriseDelegatedSpec{
	Domain: "codocs", Resource: "personal-documents", ErrorCode: "enterprise_codocs_collaboration_session",
	Actions: map[string]enterpriseDelegatedAction{
		"collaboration-open": {Method: http.MethodPost, PermitAction: "edit", CodePattern: enterpriseCodocsDocumentReads.Actions["view"].CodePattern, Target: snapshotTarget},
	},
}

var enterpriseCodocsCollaborationSessionRoutes = buildEnterpriseDelegatedRoutes(enterpriseCodocsCollaborationSessionSpec)

func enterpriseCodocsCollaborationSessionQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsCollaborationSessionSpec.Actions[action]
	if !ok || actor == "" || len(input.Payload) != 0 {
		return nil, snapshotInputInvalid()
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsCollaborationSessionSpec, act, actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}

func enterpriseCodocsDocumentSnapshotQuery(input enterpriseDelegatedInput, action, actor string) (url.Values, error) {
	act, ok := enterpriseCodocsDocumentSnapshotSpec.Actions[action]
	if !ok || actor == "" || (action != "snapshot-read" && len(input.Payload) == 0) || (action == "snapshot-read" && len(input.Payload) != 0) {
		return nil, snapshotInputInvalid()
	}
	query, err := enterpriseDelegatedQuery(input, enterpriseCodocsDocumentSnapshotSpec, act, actor)
	if err != nil {
		return nil, err
	}
	query.Set("hzy_runtime_actor_delegated", "1")
	return query, nil
}

func snapshotInputInvalid() error {
	return httperror.New(http.StatusBadRequest, "enterprise_codocs_document_snapshot_input_invalid", "Invalid document snapshot input")
}

// decodeSnapshotCommand accepts exactly the command fields (plus "objects" for
// publish); the document UUID always comes from the bound route code.
func decodeSnapshotCommand(uuid string, payload map[string]any, withObjects bool) (codocsapp.SnapshotCommand, codocsapp.SnapshotObjects, error) {
	allowed := map[string]bool{"generation": true, "epoch": true, "markdownSha256": true, "markdownSize": true, "yjsSha256": true, "yjsSize": true, "objects": withObjects}
	for key := range payload {
		if !allowed[key] {
			return codocsapp.SnapshotCommand{}, codocsapp.SnapshotObjects{}, snapshotInputInvalid()
		}
	}
	integer := func(key string, required bool) (int64, bool) {
		raw, present := payload[key]
		if !present {
			return 0, !required
		}
		value, ok := raw.(float64)
		if !ok || value != math.Trunc(value) || value < 0 || value > 1<<53 {
			return 0, false
		}
		return int64(value), true
	}
	text := func(key string) (string, bool) {
		raw, present := payload[key]
		if !present {
			return "", true
		}
		value, ok := raw.(string)
		return value, ok
	}
	cmd := codocsapp.SnapshotCommand{UUID: uuid}
	var ok [6]bool
	cmd.Generation, ok[0] = integer("generation", true)
	cmd.Epoch, ok[1] = integer("epoch", true)
	cmd.MarkdownSHA256, ok[2] = text("markdownSha256")
	cmd.MarkdownSize, ok[3] = integer("markdownSize", true)
	cmd.YjsSHA256, ok[4] = text("yjsSha256")
	cmd.YjsSize, ok[5] = integer("yjsSize", false)
	for _, valid := range ok {
		if !valid {
			return codocsapp.SnapshotCommand{}, codocsapp.SnapshotObjects{}, snapshotInputInvalid()
		}
	}
	if !withObjects {
		return cmd, codocsapp.SnapshotObjects{}, nil
	}
	rawObjects, _ := payload["objects"].(map[string]any)
	object := func(raw any) (*codocsapp.SnapshotObject, bool) {
		value, ok := raw.(map[string]any)
		if !ok || len(value) != 2 {
			return nil, false
		}
		key, keyOK := value["key"].(string)
		version, versionOK := value["version"].(string)
		if !keyOK || !versionOK || key == "" || version == "" {
			return nil, false
		}
		return &codocsapp.SnapshotObject{Key: key, Version: version}, true
	}
	if rawObjects == nil || len(rawObjects) > 2 {
		return codocsapp.SnapshotCommand{}, codocsapp.SnapshotObjects{}, snapshotInputInvalid()
	}
	markdown, markdownOK := object(rawObjects["markdown"])
	if !markdownOK {
		return codocsapp.SnapshotCommand{}, codocsapp.SnapshotObjects{}, snapshotInputInvalid()
	}
	objects := codocsapp.SnapshotObjects{Markdown: *markdown}
	if rawYjs, present := rawObjects["yjs"]; present {
		yjs, yjsOK := object(rawYjs)
		if !yjsOK {
			return codocsapp.SnapshotCommand{}, codocsapp.SnapshotObjects{}, snapshotInputInvalid()
		}
		objects.Yjs = yjs
	} else if len(rawObjects) != 1 {
		return codocsapp.SnapshotCommand{}, codocsapp.SnapshotObjects{}, snapshotInputInvalid()
	}
	return cmd, objects, nil
}

func (s *Server) enterpriseCodocsDocumentSnapshot(ctx context.Context, action string, identity codocsapp.PersonalFolderCreationIdentity, uuid string, payload map[string]any) (any, error) {
	switch action {
	case "snapshot-read":
		read, err := s.codocs.ReadDocumentSnapshot(ctx, identity, uuid)
		if err != nil {
			return nil, err
		}
		value := map[string]any{"generation": read.Generation, "epoch": read.Epoch}
		if read.Objects != nil {
			value["markdownSize"], value["markdownSha256"] = read.MarkdownSize, read.MarkdownSHA256
			objects := map[string]any{"markdown": map[string]string{"key": read.Objects.Markdown.Key, "version": read.Objects.Markdown.Version}}
			if read.Objects.Yjs != nil {
				objects["yjs"] = map[string]string{"key": read.Objects.Yjs.Key, "version": read.Objects.Yjs.Version}
			}
			value["objects"] = objects
		} else {
			value["legacy"] = true
		}
		return value, nil
	case "collaboration-open":
		session, err := s.codocs.OpenCollaborationSession(ctx, identity, uuid)
		if err != nil {
			return nil, err
		}
		// The one-time ticket goes to the verified user's browser, which hands it
		// to Collab; only its hash is stored.
		return map[string]any{"sessionId": session.SessionID, "epoch": session.Epoch, "generation": session.Generation, "expiresAt": session.ExpiresAt.UTC().Format(time.RFC3339), "reused": session.Reused, "ticket": session.Ticket}, nil
	case "snapshot-prepare", "snapshot-publish":
		cmd, objects, err := decodeSnapshotCommand(uuid, payload, action == "snapshot-publish")
		if err != nil {
			return nil, err
		}
		var plan codocsapp.SnapshotPlan
		if action == "snapshot-prepare" {
			plan, err = s.codocs.PrepareDocumentSnapshot(ctx, identity, cmd)
		} else {
			plan, err = s.codocs.PublishDocumentSnapshot(ctx, identity, cmd, objects, s.codocsSnapshotVerifier())
		}
		if err != nil {
			return nil, err
		}
		return map[string]any{"candidate": plan.Candidate, "prefix": plan.Prefix, "generation": plan.Generation, "replayed": plan.Replayed}, nil
	}
	return nil, snapshotInputInvalid()
}

// codocsSnapshotVerifier byte-verifies exact versions through the bound
// reader, after confirming the bucket keeps write-once snapshot versions.
func (s *Server) codocsSnapshotVerifier() codocsapp.SnapshotVerifier {
	byteVerifier := codocsapp.NewSnapshotByteVerifier(s.codocsSnapshotReader())
	return func(ctx context.Context, id codocsapp.PersonalFolderCreationIdentity, cmd codocsapp.SnapshotCommand, objects codocsapp.SnapshotObjects) error {
		var storage snapshotRetentionStorage
		if s.console != nil {
			storage = s.console
		}
		if err := s.snapshotRetention.check(ctx, storage); err != nil {
			return httperror.New(http.StatusServiceUnavailable, "snapshot_storage_retention_unverified", "Snapshot storage retention could not be verified")
		}
		return byteVerifier(ctx, id, cmd, objects)
	}
}

type snapshotRetentionStorage interface {
	GetOSSBucketRetention(context.Context, string, consoleapp.VaultAccessMeta) (consoleapp.OSSBucketRetention, error)
}

// snapshotRetentionCache remembers only a successful check, briefly, so a
// lifecycle change is picked up within minutes and failures are retried.
type snapshotRetentionCache struct {
	mu       sync.Mutex
	verified time.Time
	now      func() time.Time
}

const snapshotRetentionTTL = 10 * time.Minute

func (c *snapshotRetentionCache) check(ctx context.Context, storage snapshotRetentionStorage) error {
	now := time.Now
	if c.now != nil {
		now = c.now
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.verified.IsZero() && now().Sub(c.verified) < snapshotRetentionTTL {
		return nil
	}
	if storage == nil {
		return httperror.New(http.StatusServiceUnavailable, "snapshot_storage_unbound", "Snapshot storage is not bound")
	}
	retention, err := storage.GetOSSBucketRetention(ctx, "oss.default", consoleapp.VaultAccessMeta{
		ActorType: "service", ActorID: "codocs.snapshot-verifier", AppCode: "codocs", Reason: "snapshot retention check",
	})
	if err != nil {
		return err
	}
	if err := retention.RetainsVersionsUnder("codocs/snapshots/", true); err != nil {
		return err
	}
	c.verified = now()
	return nil
}
