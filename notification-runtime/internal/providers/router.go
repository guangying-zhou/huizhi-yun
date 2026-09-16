package providers

import (
	"context"
	"strings"

	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
	"github.com/huizhi-yun/notification-runtime/internal/peoplejobs"
)

// ConnectorProvider routes only compiled provider capabilities. It never
// accepts a caller-controlled URL, method, header, or provider response shape.
type ConnectorProvider struct {
	wecom    *WeComProvider
	dingtalk *DingTalkProvider
}

func NewConnectorProvider(console *consoleclient.Client) *ConnectorProvider {
	return &ConnectorProvider{
		wecom:    NewWeComProvider(console),
		dingtalk: NewDingTalkProvider(console),
	}
}

func (p *ConnectorProvider) Send(ctx context.Context, input SendRequest) (SendResult, error) {
	switch strings.ToLower(strings.TrimSpace(input.Channel)) {
	case "dingtalk":
		return p.dingtalk.Send(ctx, input)
	default:
		return p.wecom.Send(ctx, input)
	}
}

func (p *ConnectorProvider) ExchangeIdentity(ctx context.Context, input IdentityExchangeRequest) (IdentityExchangeResult, error) {
	return p.wecom.ExchangeIdentity(ctx, input)
}

func (p *ConnectorProvider) ExchangeDingTalkIdentity(ctx context.Context, input DingTalkIdentityExchangeRequest) (IdentityExchangeResult, error) {
	return p.dingtalk.ExchangeIdentity(ctx, input)
}

func (p *ConnectorProvider) RunPeopleSync(ctx context.Context, input peoplejobs.StartRequest, emit func(peoplejobs.Batch) error) (peoplejobs.Counts, error) {
	return p.dingtalk.RunPeopleSync(ctx, input, emit)
}
