package altoc

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strconv"
	"time"
)

// EnterpriseServiceTicketSLA shares the existing priority, absolute minute and
// cumulative accounting rules; it introduces no calendar or pause policy.
func EnterpriseServiceTicketSLA(ticket, agreement map[string]any, now time.Time) map[string]any {
	r, s := serviceTicketSLAMinutes(ticket, agreement)
	ticket["created_at"] = now
	ticket["response_due_at"] = serviceTicketDueAt(ticket, "response_due_at", r)
	ticket["resolution_due_at"] = serviceTicketDueAt(ticket, "resolution_due_at", s)
	ticket["entitlement_status"] = serviceAgreementEntitlementStatus(agreement, now)
	ticket["sla_status"] = serviceTicketSLAStatus(ticket, altocMapText(ticket, "entitlement_status"), ticket["response_due_at"], ticket["resolution_due_at"], now)
	return ticket
}
func CheckEnterpriseDispatchQuota(ticket, agreement map[string]any, estimated string, now time.Time) error {
	if serviceAgreementEntitlementStatus(agreement, now) != "in_service" {
		return httperror.New(409, "service_ticket_out_of_service", "服务协议当前无效，不能派单")
	}
	included := moneyValue(agreement["included_quota"])
	if included <= 0 {
		return nil
	}
	need := 0.0
	switch altocMapText(agreement, "quota_unit") {
	case "", "ticket", "tickets", "case":
		need = 1 - moneyValue(ticket["quota_consumed"])
	case "hour", "hours":
		if estimated != "" {
			v, e := strconv.ParseFloat(estimated, 64)
			if e != nil {
				return httperror.New(400, "service_ticket_hours_invalid", "预计工时无效")
			}
			need = v - moneyValue(ticket["quota_consumed"])
		}
	}
	if need < 0 {
		need = 0
	}
	if serviceAgreementQuotaExceeded(agreement) || moneyValue(agreement["consumed_quota"])+need > included {
		return httperror.New(409, "service_ticket_quota_exceeded", "服务额度不足，无法派单，请补充合同或额度")
	}
	return nil
}

// EnterpriseTicketQuotaConsumption retains the legacy cumulative, non-refunding rules.
func EnterpriseTicketQuotaConsumption(ticket, agreement, facts map[string]any) float64 {
	return serviceTicketQuotaConsumption(ticket, agreement, facts)
}
func EnterpriseTicketConsumedQuota(ticket map[string]any) float64 {
	return moneyValue(ticket["quota_consumed"])
}
