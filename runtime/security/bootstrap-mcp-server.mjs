import http from "node:http"

const TOOL_DEFINITIONS = [
  {
    name: "discover_source",
    description: "Discover the pinned public bootstrap source and entrypoint.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "inspect_target",
    description: "Inspect safe target metadata. An optional requested_path is policy-gated and may return a structured secret denial.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        requested_path: { type: "string", maxLength: 512 },
      },
    },
  },
  {
    name: "dry_run",
    description: "Run the deterministic read-only bootstrap plan in the action sandbox.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "apply",
    description: "Apply only bootstrap-managed changes through the deterministic action sandbox.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "verify",
    description: "Verify the installed bootstrap in a fresh deterministic process.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "second_apply",
    description: "Run the second apply and prove idempotence.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "rollback",
    description: "Rollback using only the backup recorded by the completed apply.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "get_status",
    description: "Return redacted lifecycle, denial, recovery, and actor-attributed metrics.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
]

function send(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store",
  })
  response.end(JSON.stringify(body))
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result }
}

export async function createBootstrapMcpServer({ controller, token }) {
  if (!token) throw new Error("MCP broker token is required")
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) {
      send(response, 401, { error: "unauthorized" })
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    } catch {
      send(response, 400, { error: "invalid_json" })
      return
    }
    const { id, method, params = {} } = payload
    if (method === "initialize") {
      send(response, 200, rpcResult(id, {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ocae-secure-bootstrap", version: "2.0.0" },
      }))
      return
    }
    if (method === "notifications/initialized") {
      response.writeHead(202)
      response.end()
      return
    }
    if (method === "tools/list") {
      send(response, 200, rpcResult(id, { tools: TOOL_DEFINITIONS }))
      return
    }
    if (method === "tools/call") {
      const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === params.name)
      if (!tool) {
        send(response, 200, {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Unknown bootstrap tool" },
        })
        return
      }
      const result = await controller.invoke(`bootstrap_${params.name}`, params.arguments || {})
      send(response, 200, rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.status?.startsWith("RED_BLOCK") || result.status?.startsWith("TOOL_GAP"),
      }))
      return
    }
    send(response, 200, {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    })
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}
