# auth.md: TipitakaPali.org Agent Registration & Access Policy

```json
{
  "skill": "https://tipitakapali.org/auth.md",
  "register_uri": "https://tipitakapali.org/auth.md",
  "identity_types_supported": ["anonymous"],
  "anonymous": {
    "credential_types_supported": ["none"]
  },
  "claim_uri": "https://tipitakapali.org/auth.md"
}
```

## Agent Audience
This service is designed for autonomous AI agents, LLM researchers, monastics, and Buddhist scholars needing programmatic or conversational access to the complete Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon (Sixth Buddhist Council / VRI) and the Digital Pāḷi Dictionary (DPD).

## Agent Registration & Provisioning
- **Registration Type**: Instant anonymous auto-provisioning (`anonymous`)
- **Registration URI**: <https://tipitakapali.org/auth.md>
- **Supported Identity Types**: `["anonymous"]`
- **Supported Credential Types**: `["none"]`
- **Claim URI**: <https://tipitakapali.org/auth.md>
- **Manual Registration**: Not required. Agents are automatically granted immediate, unrestricted access upon issuing their first HTTP or WebMCP request.

## Authentication & Credentials
- **Authentication Method**: Anonymous public access (`anonymous`)
- **API Keys / Bearer Tokens**: None required.
- **Client Credentials**: Not required.
- **Rate Limits & Costs**: 100% free and open for public educational and non-commercial study.
- **CORS**: Unrestricted (`Access-Control-Allow-Origin: *`) on all APIs.

## OAuth & Discovery Endpoints
- **OAuth Protected Resource Metadata (RFC 9728)**: <https://tipitakapali.org/.well-known/oauth-protected-resource>
- **OAuth Authorization Server Metadata (RFC 8414)**: <https://tipitakapali.org/.well-known/oauth-authorization-server>
- **RFC 9727 API Catalog**: <https://tipitakapali.org/.well-known/api-catalog>
- **ARD Capability Manifest**: <https://tipitakapali.org/.well-known/ai-catalog.json>
- **Model Context Protocol (MCP) Server Card**: <https://tipitakapali.org/.well-known/mcp/server-card.json>
- **Agent-to-Agent (A2A) Agent Card**: <https://tipitakapali.org/.well-known/agent-card.json>
- **Agent Skills Index (RFC v0.2.0)**: <https://tipitakapali.org/.well-known/agent-skills/index.json>
- **LLMs Guide**: <https://tipitakapali.org/llms.txt>

## Contact & Support
- Email: `tipitakapali.org@gmail.com`
- Website: <https://tipitakapali.org>
