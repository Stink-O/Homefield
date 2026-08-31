#!/usr/bin/env node
// Checks that a HomeField MCP endpoint is reachable and that an API key works.
//
//   node scripts/mcp-check.mjs <base-url> <hf_live_token>
//   node scripts/mcp-check.mjs http://localhost:3000 hf_live_abc...
//
// No dependencies — plain fetch. Run it when a client says "connection failed"
// and you need to know whether the problem is the server, the key, or the
// client. Each check prints what it proves, so a failure names its own cause.

const [, , rawUrl, token] = process.argv;

if (!rawUrl || !token) {
  console.error("usage: node scripts/mcp-check.mjs <base-url> <hf_live_token>");
  process.exit(2);
}

const base = rawUrl.replace(/\/+$/, "");
const endpoint = `${base}/api/mcp`;

const PROTOCOL = "2026-07-28";
const META = {
  "io.modelcontextprotocol/clientCapabilities": {
    protocolVersion: PROTOCOL,
    extensions: {},
  },
};

let failures = 0;

function report(ok, label, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Sends one JSON-RPC call and unwraps the SSE framing the server replies with. */
async function rpc(method, params = {}, { headers = {} } = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The server answers as SSE; without this Accept it refuses the request.
      Accept: "application/json, text/event-stream",
      "Mcp-Method": method,
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: META },
    }),
  });

  const text = await res.text();
  const payload = text.startsWith("event:")
    ? text.split("\n").find((l) => l.startsWith("data: "))?.slice(6)
    : text;

  let body = null;
  try {
    body = payload ? JSON.parse(payload) : null;
  } catch {
    /* non-JSON body is itself the finding */
  }
  return { status: res.status, body, raw: text };
}

console.log(`\nHomeField MCP check → ${endpoint}\n`);

// 1. Is the app up at all? Distinguishes "wrong URL" from "bad key".
try {
  const health = await fetch(`${base}/api/health`);
  report(health.ok, "server reachable", `GET /api/health → ${health.status}`);
} catch (err) {
  report(false, "server reachable", err.message);
  console.log("\nThe app is not answering at that URL. Check the host and port.\n");
  process.exit(1);
}

// 2. The endpoint must exist and demand auth, not redirect to the login page.
// A 302 here means /api/mcp is missing from the middleware allowlist.
{
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    redirect: "manual",
  });
  const redirected = res.status >= 300 && res.status < 400;
  report(
    res.status === 401,
    "unauthenticated requests are refused",
    redirected
      ? `got ${res.status} redirect — /api/mcp is not allowlisted in auth.config.ts`
      : `→ ${res.status}`,
  );
}

// 3. The key itself.
const list = await rpc("tools/list");
const tools = list.body?.result?.tools;
report(Array.isArray(tools), "API key accepted", Array.isArray(tools)
  ? `${tools.length} tools available`
  : `→ ${list.status} ${JSON.stringify(list.body?.error ?? list.raw).slice(0, 160)}`);

if (!Array.isArray(tools)) {
  console.log("\nThe server is up but rejected the key. It may be revoked, expired,");
  console.log("or belong to an account awaiting approval. Mint a new one in");
  console.log("Settings → Agent access.\n");
  process.exit(1);
}

for (const t of tools) console.log(`         · ${t.name}`);

// 4. A read that proves the key can actually reach data, not just authenticate.
const ws = await rpc("tools/call", { name: "list_workspaces", arguments: {} });
report(ws.body?.result?.isError !== true, "key can read its workspaces",
  ws.body?.result?.isError ? String(ws.body.result.content?.[0]?.text).slice(0, 120) : undefined);

// 5. Cookies must never confer authority here, since the app has no CSRF tokens.
{
  const res = await rpc("tools/list", {}, { headers: { Cookie: "authjs.session-token=probe" } });
  report(res.status === 401, "session cookies are rejected", `→ ${res.status}`);
}

console.log(
  failures === 0
    ? "\nAll checks passed. This key is ready to use.\n"
    : `\n${failures} check${failures === 1 ? "" : "s"} failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
