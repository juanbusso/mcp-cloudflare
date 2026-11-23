# mcp-cloudflare

MCP server for managing Cloudflare DNS records and Cloudflare Tunnels through the Cloudflare API v4.

## Tools

| Tool | Description |
|---|---|
| `list_accounts` | List accounts visible to the token. |
| `list_zones` | List zones. |
| `list_dns_records` | List DNS records for a zone (by name, e.g. `example.com`, or ID). |
| `create_dns_record` | Create A / AAAA / CNAME / TXT / MX… records, proxied or DNS-only. |
| `delete_dns_record` | Delete a DNS record by ID. |
| `list_tunnels` | List tunnels and their health (one account, or `"all"`). |
| `get_tunnel` | Tunnel details, connections, run token and ingress config. |
| `create_tunnel` | Create a tunnel and return its run token. |
| `configure_tunnel` | Update a tunnel's ingress rules. |
| `delete_tunnel` | Delete a tunnel. |
| `raw_cloudflare_request` | Arbitrary request to the Cloudflare API v4. |

The `account` argument accepts a 32-char account ID or part of the account name (e.g. `"Account Name"`).

## Setup

```bash
npm install
cp .env.example .env
npm run check
```

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Yes | API token with the permissions you need (Zone:DNS Edit, Account:Cloudflare Tunnel Edit, …). The server refuses to start without it. |
| `CLOUDFLARE_ACCOUNT_ID` | No | Default account. If unset, the first account visible to the token is used. |

## MCP client config

```json
{
  "mcpServers": {
    "mcp-cloudflare": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-cloudflare/server.mjs"],
      "env": { "CLOUDFLARE_API_TOKEN": "your-token", "CLOUDFLARE_ACCOUNT_ID": "optional-account-id" }
    }
  }
}
```

## Security

`get_tunnel`, `create_tunnel` and `raw_cloudflare_request` can return tunnel run tokens and perform destructive operations. Scope the API token to the minimum permissions you need.

## License

MIT
