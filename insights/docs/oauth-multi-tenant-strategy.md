# Multi-Tenant OAuth Strategy for RepoInsight

This document outlines the OAuth authentication strategy for supporting both subdomain and custom domain tenants in the RepoInsight platform.

## Overview

RepoInsight supports two types of tenant domains:
1. **Subdomain tenants**: `tenant1.repoinsight.com`, `tenant2.repoinsight.com`
2. **Custom domain tenants**: `custom-domain.com`, `another-domain.net`

## Google OAuth Limitations

### Client Credentials Quotas
- **Redirect URIs per client**: 100 maximum
- **OAuth clients per Google Cloud project**: 100 maximum  
- **Projects per Google account**: ~12 (personal), more for enterprise
- **Total potential clients per account**: ~1,200 (12 × 100)

### Technical Constraints
- Google OAuth does not support iframe embedding (X-Frame-Options: DENY)
- No wildcard support for redirect URIs
- Manual configuration required for each redirect URI

## Architecture Strategy

### 1. Subdomain Strategy (Primary)

**Approach**: Shared OAuth client for all subdomains

```
tenant1.repoinsight.com → auth.repoinsight.com/oauth → callback
tenant2.repoinsight.com → auth.repoinsight.com/oauth → callback  
```

**Implementation**:
- Single OAuth client ID handles all subdomains
- Redirect URI: `https://auth.repoinsight.com/auth/callback`
- Post-auth redirect to original subdomain

**Advantages**:
- Zero configuration for new tenants
- Unlimited subdomain support
- Immediate availability

**Business Model**: Free tier

### 2. Custom Domain Strategy (Premium)

**Approach**: Dynamic OAuth client management

```
custom-domain.com → Dynamic URI addition → Dedicated auth flow
```

**Implementation**:
```javascript
// Auto-add redirect URI via Google Admin API
async function addCustomDomain(domain, tenantId) {
  const redirectUri = `https://${domain}/auth/callback`
  
  // Find available OAuth client (under 100 URIs)
  const availableClient = await findAvailableOAuthClient()
  
  // Add redirect URI dynamically
  await googleAdminAPI.addRedirectURI(availableClient.id, redirectUri)
  
  // Store mapping in database
  await db.tenantOAuthMappings.create({
    tenantId,
    domain,
    clientId: availableClient.id,
    redirectUri
  })
}
```

**Multi-Account Scaling**:
```
Google Account 1: Clients 1-100 (supports 1-1,200 domains)
Google Account 2: Clients 101-200 (supports 1,201-2,400 domains)
Google Account N: Enterprise scaling...
```

**Advantages**:
- True custom branding
- Professional appearance
- Isolated auth flows

**Business Model**: Professional/Enterprise tier

## Implementation Details

### OAuth Flow Types

#### Subdomain Flow
```
1. User visits: tenant1.repoinsight.com/login
2. Redirect to: auth.repoinsight.com/oauth/google?tenant=tenant1&return_url=...
3. Google OAuth: auth.repoinsight.com/auth/callback
4. Process auth + redirect: tenant1.repoinsight.com/dashboard
```

#### Custom Domain Flow  
```
1. User visits: custom-domain.com/login
2. Check OAuth client mapping in database
3. Direct OAuth: accounts.google.com/oauth/authorize?client_id=...
4. Google callback: custom-domain.com/auth/callback
5. Process auth locally
```

### Technical Components

#### 1. OAuth Client Manager Service
```javascript
class OAuthClientManager {
  async assignDomainToClient(domain) {
    // Find client with available URI slots
    const client = await this.findAvailableClient()
    
    // Add domain to client via Google API
    await this.addRedirectURI(client.id, domain)
    
    return client.id
  }
  
  async findAvailableClient() {
    // Return client with < 100 redirect URIs
  }
  
  async createNewClient() {
    // Create new OAuth client when needed
  }
}
```

#### 2. Multi-Account Management
```javascript
class MultiAccountManager {
  constructor() {
    this.accounts = [
      { email: 'oauth1@business.com', projectId: 'project-1' },
      { email: 'oauth2@business.com', projectId: 'project-2' }
    ]
  }
  
  async getAvailableAccount() {
    // Round-robin or load-based selection
  }
}
```

#### 3. Domain Validation
```javascript
async function validateCustomDomain(domain, tenantId) {
  // DNS validation for domain ownership
  const dnsRecord = await checkDNSRecord(domain, '_ismebase-verify')
  
  if (!dnsRecord.includes(tenantId)) {
    throw new Error('Domain ownership not verified')
  }
  
  return true
}
```

## Business Model Integration

### Tier Structure
| Tier             | Domain Type      | OAuth Support    | Limits               |
| ---------------- | ---------------- | ---------------- | -------------------- |
| **Free**         | Subdomain only   | Shared client    | Unlimited subdomains |
| **Professional** | Custom domain    | Dedicated URI    | 1 custom domain      |
| **Enterprise**   | Multiple domains | Multiple clients | Unlimited + priority |

### Pricing Considerations
- Custom domain setup as premium feature
- Enterprise tier for high-volume customers (>1,200 domains)
- Google Workspace integration for enterprise customers

## Scaling Strategy

### Phase 1: Subdomain Focus
- Implement shared OAuth for all subdomains
- Perfect the user experience
- Scale to thousands of subdomain tenants

### Phase 2: Custom Domain Premium
- Implement dynamic OAuth URI management
- Launch professional tier with custom domains
- Support up to 1,200 custom domains per Google account

### Phase 3: Enterprise Scale
- Multi-Google-account management
- Google Workspace integration
- Enterprise customer support

## Security Considerations

### Domain Verification
- DNS record verification for custom domains
- Certificate validation (HTTPS required)
- Domain ownership proof before OAuth setup

### OAuth Security
- State parameter validation
- PKCE for public clients
- Secure token storage and rotation

### Cross-Domain Authentication
- Proper CORS configuration
- Secure cookie handling across domains
- CSRF protection

## Future Enhancements

### Advanced Features
- **SSO Integration**: SAML, OIDC for enterprise customers
- **White-label Auth**: Completely branded auth pages
- **API-First Auth**: Headless authentication options
- **Multi-Provider**: Support for Microsoft, GitHub, etc.

### Monitoring & Analytics
- OAuth usage tracking per tenant
- Performance monitoring across domains
- Error tracking and alerting

## Technical Requirements

### Google APIs Required
- Google OAuth 2.0 API
- Google Admin SDK (for dynamic URI management)
- Google Cloud Resource Manager API (for project management)

### Infrastructure
- Redis for session management across domains
- Database for OAuth client mappings
- Load balancer with SSL termination
- CDN for global auth endpoint performance

## Conclusion

This multi-tier OAuth strategy provides:
1. **Immediate value** through subdomain support (no limits)
2. **Premium features** through custom domain support (up to 1,200 domains)
3. **Enterprise scalability** through multi-account management
4. **Clear monetization** path aligned with customer needs

The architecture balances technical constraints with business requirements, providing a scalable foundation for RepoInsight's multi-tenant authentication system.

---

## Current Implementation (2025-09)

This section documents the pragmatic implementation currently deployed, optimized for stability across platform subdomains and custom domains.

### Dedicated Auth Host
- All OAuth initiation and callbacks run on a dedicated host: `auth.repoinsight.com`.
- Initiation endpoint: `/api/auth/prepare-google`
  - Reads and sanitizes `returnUrl` (whitelist http/https or relative paths, strips `/api/auth/*` loops).
  - Writes a short-lived `href` cookie for post-auth redirection context.
  - Honors proxy headers: `X-Forwarded-Host`, `X-Forwarded-Proto`.

### Callback Handler
- Callback endpoint: `/api/auth/google`
  - Provisions the user and ensures a membership for the target tenant resolved from host.
  - Role-aware redirects (TENANT/ADMIN vs USER) continue to apply for platform subdomains.
  - For custom domains, it does not attempt to set cookies cross-eTLD. Instead it hands off to a relay on the target domain.

### Cross-Domain Session Relay
- Relay endpoint on the target domain: `/api/auth/relay`
- Flow:
  1) Callback issues a signed token and redirects to `https://<custom-domain>/api/auth/relay?t=<token>`.
  2) Relay verifies HMAC and sets the `user` cookie on the current domain with `SameSite=Lax` and `Secure` under https.
  3) Relay then redirects to a sanitized `next` target (relative path only).
- Security hardening:
  - Token parsing uses the raw URL to prevent `+` becoming space during query parsing.
  - Token split uses `lastIndexOf('.')` to allow dots in the payload.
  - HMAC dual-secret verification: `SESSION_TRANSFER_SECRET` or the OAuth client secret.
  - `next` sanitation forbids `/api/auth/logout` loops and disallows `*.pages.dev` origins.

### Unified Logout Endpoint
- Endpoint: `/api/auth/logout`
- Behavior:
  - Clears cookies on the current domain and also clears platform-wide cookies with `Domain=.repoinsight.com`.
  - If invoked from a custom domain, it cascades to the platform logout with `stage=platform` and `next` pointing back to the same custom domain (absolute URL), then returns to the requested path.
  - If invoked on the platform domain with `stage=platform`, it clears platform cookies and redirects to sanitized `next`.
  - Default platform redirect is the homepage `/` (not `/login`).
  - Strong loop prevention: avoids `/api/auth/logout` as a target; blocks `*.pages.dev` as `next`.

### Worker/Proxy Considerations
- For reliability and to avoid recursion/1102 errors, non-platform custom domains are not proxied via the Worker in the current deployment—they go directly to Pages Custom Domains.
- Platform domains remain proxied (forwarding `X-Forwarded-Host/Proto`) so SSR is proxy-aware.

### Operational Notes
- Ensure `SESSION_TRANSFER_SECRET` is set in all environments (production/preview/local) and rotated periodically.
- Logging is enriched during OAuth and relay to aid diagnostics without leaking sensitive data.