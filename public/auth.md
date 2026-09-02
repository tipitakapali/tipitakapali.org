# Auth.md: TipitakaPali.org Agent Authentication & Access Policy

```json
{
  "identity_types_supported": ["anonymous"],
  "anonymous": {
    "credential_types_supported": ["none"]
  },
  "claim_uri": "https://tipitakapali.org/auth.md"
}
```

## Agent Authentication & Access Policy

TipitakaPali.org is an open-access Buddhist Dhamma preservation platform offering complete, unrestricted access to the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon (Sixth Buddhist Council / VRI) and the Digital Pāḷi Dictionary (DPD).

### Registration & Credentials
- `identity_types_supported`: `["anonymous"]`
- `anonymous.credential_types_supported`: `["none"]`
- `claim_uri`: `https://tipitakapali.org/auth.md`
- **Authentication Requirement**: Anonymous public access (`anonymous`)
- **API Keys / Tokens**: None required
- **OAuth / OIDC**: None required (public resource server)
- **Cost / Quota**: Free universal access for AI agents, educational research, and Dhamma study.

### Machine Endpoints & Specifications
- **Canonical API Base**: `https://api.tipitakapali.org`
- **CORS**: `Access-Control-Allow-Origin: *` enabled on all endpoints
- **OpenAPI 3.1 Specification**: `https://tipitakapali.org/openapi.json`
- **RFC 9727 API Catalog**: `https://tipitakapali.org/.well-known/api-catalog`
- **ARD Capability Manifest**: `https://tipitakapali.org/.well-known/ai-catalog.json`
- **MCP Server Card**: `https://tipitakapali.org/.well-known/mcp/server-card.json`
- **A2A Agent Card**: `https://tipitakapali.org/.well-known/agent-card.json`
- **Agent Skills Index**: `https://tipitakapali.org/.well-known/agent-skills/index.json`
- **LLMs Guide**: `https://tipitakapali.org/llms.txt`

### Contact & Support
- Email: `tipitakapali.org@gmail.com`
- Website: `https://tipitakapali.org`
