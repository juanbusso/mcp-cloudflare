import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
if (!API_TOKEN) {
  throw new Error('Missing CLOUDFLARE_API_TOKEN environment variable. Create an API token at https://dash.cloudflare.com/profile/api-tokens and set it before starting the server.');
}
const BASE_URL = 'https://api.cloudflare.com/client/v4';

async function cfRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const response = await fetch(url, options);
  const data = await response.json();
  return data;
}

let cachedAccounts = null;
async function getAccounts() {
  if (cachedAccounts) return cachedAccounts;
  const res = await cfRequest('/accounts');
  if (res.success && res.result) {
    cachedAccounts = res.result;
    return cachedAccounts;
  }
  return [];
}

// Falls back to the first account visible to the token when CLOUDFLARE_ACCOUNT_ID is unset
async function getDefaultAccountId() {
  if (DEFAULT_ACCOUNT_ID) return DEFAULT_ACCOUNT_ID;
  const accounts = await getAccounts();
  if (accounts.length > 0) return accounts[0].id;
  throw new Error('No Cloudflare account available. Set CLOUDFLARE_ACCOUNT_ID or pass the account argument.');
}

async function resolveAccountId(account) {
  if (!account) return getDefaultAccountId();
  const clean = account.trim();
  if (/^[a-f0-9]{32}$/i.test(clean)) return clean;
  const accounts = await getAccounts();
  const match = accounts.find(a => a.name.toLowerCase().includes(clean.toLowerCase()));
  if (match) return match.id;
  return clean;
}

async function getZoneDetails(zoneNameOrId) {
  const clean = zoneNameOrId.trim();
  if (/^[a-f0-9]{32}$/i.test(clean)) {
    const res = await cfRequest(`/zones/${clean}`);
    if (res.success && res.result) return res.result;
  }
  const cleanName = clean.toLowerCase();
  const res = await cfRequest(`/zones?name=${encodeURIComponent(cleanName)}`);
  if (res.success && res.result && res.result.length > 0) {
    return res.result[0];
  }
  const allZones = await cfRequest('/zones');
  if (allZones.success && allZones.result) {
    const match = allZones.result.find(z => z.name.toLowerCase() === cleanName);
    if (match) return match;
  }
  throw new Error(`Zone '${zoneNameOrId}' not found in Cloudflare.`);
}

const server = new Server(
  {
    name: 'cloudflare-mcp-server',
    version: '1.1.0'
  },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_accounts',
        description: 'List all Cloudflare accounts accessible with current token.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'list_zones',
        description: 'List all Cloudflare zones in the account.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Filter by zone domain name (optional)' }
          }
        }
      },
      {
        name: 'list_dns_records',
        description: 'List DNS records for a Cloudflare zone by zone name or zone ID.',
        inputSchema: {
          type: 'object',
          properties: {
            zone: { type: 'string', description: 'Zone domain name (e.g. example.com) or zone ID' },
            type: { type: 'string', description: 'Filter by DNS record type e.g. A, CNAME, TXT' },
            name: { type: 'string', description: 'Filter by record name e.g. sub.example.com' }
          },
          required: ['zone']
        }
      },
      {
        name: 'create_dns_record',
        description: 'Create a DNS record in Cloudflare (A, CNAME, TXT, MX, etc.) with proxy status (DNS-only vs proxied).',
        inputSchema: {
          type: 'object',
          properties: {
            zone: { type: 'string', description: 'Zone domain name or zone ID' },
            type: { type: 'string', description: 'Record type e.g. A, CNAME, TXT, MX' },
            name: { type: 'string', description: 'Record name e.g. sub or sub.example.com' },
            content: { type: 'string', description: 'Record target e.g. IP address or tunnel domain' },
            ttl: { type: 'number', description: 'TTL in seconds (1 = Automatic)' },
            proxied: { type: 'boolean', description: 'Set false for DNS-only (nube gris) or true for Proxied (nube naranja)' }
          },
          required: ['zone', 'type', 'name', 'content']
        }
      },
      {
        name: 'delete_dns_record',
        description: 'Delete a DNS record in Cloudflare by record ID.',
        inputSchema: {
          type: 'object',
          properties: {
            zone: { type: 'string', description: 'Zone domain name or zone ID' },
            record_id: { type: 'string', description: 'DNS Record ID' }
          },
          required: ['zone', 'record_id']
        }
      },
      {
        name: 'list_tunnels',
        description: 'List Cloudflare tunnels and their connection health status.',
        inputSchema: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account ID or partial account name (e.g. "Account Name"). Defaults to primary account or searches all if "all".' },
            name: { type: 'string', description: 'Filter by tunnel name' },
            is_deleted: { type: 'boolean', description: 'Filter by deleted status (default false)' }
          }
        }
      },
      {
        name: 'get_tunnel',
        description: 'Get details, active connections, token, and configuration of a Cloudflare tunnel.',
        inputSchema: {
          type: 'object',
          properties: {
            tunnel_id: { type: 'string', description: 'Tunnel UUID' },
            account: { type: 'string', description: 'Account ID or partial name' }
          },
          required: ['tunnel_id']
        }
      },
      {
        name: 'create_tunnel',
        description: 'Create a new Cloudflare Tunnel and retrieve its run token.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the tunnel' },
            account: { type: 'string', description: 'Account ID or partial name' }
          },
          required: ['name']
        }
      },
      {
        name: 'configure_tunnel',
        description: 'Update the ingress configuration for a Cloudflare Tunnel.',
        inputSchema: {
          type: 'object',
          properties: {
            tunnel_id: { type: 'string', description: 'Tunnel UUID' },
            account: { type: 'string', description: 'Account ID or partial name' },
            ingress: {
              type: 'array',
              description: 'List of ingress rules. Last rule should be fallback e.g. { service: "http_status:404" }',
              items: { type: 'object' }
            }
          },
          required: ['tunnel_id', 'ingress']
        }
      },
      {
        name: 'delete_tunnel',
        description: 'Delete a Cloudflare Tunnel.',
        inputSchema: {
          type: 'object',
          properties: {
            tunnel_id: { type: 'string', description: 'Tunnel UUID' },
            account: { type: 'string', description: 'Account ID or partial name' }
          },
          required: ['tunnel_id']
        }
      },
      {
        name: 'raw_cloudflare_request',
        description: 'Execute a raw HTTP request to Cloudflare API v4.',
        inputSchema: {
          type: 'object',
          properties: {
            endpoint: { type: 'string', description: 'API endpoint e.g. /zones' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            body: { type: 'object' }
          },
          required: ['endpoint']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'list_accounts') {
      const res = await cfRequest('/accounts');
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    if (name === 'list_zones') {
      let ep = '/zones';
      if (args?.name) {
        ep += `?name=${encodeURIComponent(args.name)}`;
      }
      const res = await cfRequest(ep);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    if (name === 'list_dns_records') {
      const zone = await getZoneDetails(args.zone);
      let ep = `/zones/${zone.id}/dns_records`;
      const query = [];
      if (args.type) query.push(`type=${encodeURIComponent(args.type)}`);
      if (args.name) query.push(`name=${encodeURIComponent(args.name)}`);
      if (query.length > 0) ep += `?${query.join('&')}`;

      const res = await cfRequest(ep);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    if (name === 'create_dns_record') {
      const zone = await getZoneDetails(args.zone);
      const payload = {
        type: args.type.toUpperCase(),
        name: args.name,
        content: args.content,
        ttl: args.ttl || 1,
        proxied: args.proxied ?? false
      };
      const res = await cfRequest(`/zones/${zone.id}/dns_records`, 'POST', payload);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    if (name === 'delete_dns_record') {
      const zone = await getZoneDetails(args.zone);
      const res = await cfRequest(`/zones/${zone.id}/dns_records/${args.record_id}`, 'DELETE');
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    if (name === 'list_tunnels') {
      const accounts = await getAccounts();
      let targetAccounts = [];
      if (args?.account && args.account.toLowerCase() !== 'all') {
        const accId = await resolveAccountId(args.account);
        targetAccounts = [{ id: accId }];
      } else {
        targetAccounts = accounts;
      }

      const isDeleted = args?.is_deleted ? 'true' : 'false';
      const results = [];
      for (const acc of targetAccounts) {
        let ep = `/accounts/${acc.id}/cfd_tunnel?is_deleted=${isDeleted}`;
        if (args?.name) ep += `&name=${encodeURIComponent(args.name)}`;
        const res = await cfRequest(ep);
        if (res.success && res.result) {
          results.push(...res.result);
        }
      }

      return { content: [{ type: 'text', text: JSON.stringify({ success: true, result: results }, null, 2) }] };
    }

    if (name === 'get_tunnel') {
      let accId = null;
      if (args?.account) {
        accId = await resolveAccountId(args.account);
      } else {
        const accounts = await getAccounts();
        for (const acc of accounts) {
          const check = await cfRequest(`/accounts/${acc.id}/cfd_tunnel/${args.tunnel_id}`);
          if (check.success && check.result) {
            accId = acc.id;
            break;
          }
        }
        if (!accId) accId = await getDefaultAccountId();
      }

      const [detailRes, tokenRes, configRes] = await Promise.all([
        cfRequest(`/accounts/${accId}/cfd_tunnel/${args.tunnel_id}`),
        cfRequest(`/accounts/${accId}/cfd_tunnel/${args.tunnel_id}/token`),
        cfRequest(`/accounts/${accId}/cfd_tunnel/${args.tunnel_id}/configurations`)
      ]);

      const output = {
        tunnel: detailRes.result || detailRes,
        token: tokenRes.result || null,
        configuration: configRes.result || null
      };

      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    }

    if (name === 'create_tunnel') {
      const accId = await resolveAccountId(args.account);
      const payload = {
        name: args.name,
        config_src: 'cloudflare'
      };
      const res = await cfRequest(`/accounts/${accId}/cfd_tunnel`, 'POST', payload);
      if (!res.success) {
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }], isError: true };
      }

      const tunnelId = res.result.id;
      const tokenRes = await cfRequest(`/accounts/${accId}/cfd_tunnel/${tunnelId}/token`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            tunnel: res.result,
            token: tokenRes.result || null
          }, null, 2)
        }]
      };
    }

    if (name === 'configure_tunnel') {
      let accId = null;
      if (args?.account) {
        accId = await resolveAccountId(args.account);
      } else {
        const accounts = await getAccounts();
        for (const acc of accounts) {
          const check = await cfRequest(`/accounts/${acc.id}/cfd_tunnel/${args.tunnel_id}`);
          if (check.success && check.result) {
            accId = acc.id;
            break;
          }
        }
        if (!accId) accId = await getDefaultAccountId();
      }

      const payload = {
        config: {
          ingress: args.ingress
        }
      };
      const res = await cfRequest(`/accounts/${accId}/cfd_tunnel/${args.tunnel_id}/configurations`, 'PUT', payload);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    if (name === 'delete_tunnel') {
      let accId = null;
      if (args?.account) {
        accId = await resolveAccountId(args.account);
      } else {
        const accounts = await getAccounts();
        for (const acc of accounts) {
          const check = await cfRequest(`/accounts/${acc.id}/cfd_tunnel/${args.tunnel_id}`);
          if (check.success && check.result) {
            accId = acc.id;
            break;
          }
        }
        if (!accId) accId = await getDefaultAccountId();
      }

      const res = await cfRequest(`/accounts/${accId}/cfd_tunnel/${args.tunnel_id}`, 'DELETE');
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    if (name === 'raw_cloudflare_request') {
      const method = args.method || 'GET';
      const res = await cfRequest(args.endpoint, method, args.body);
      return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
