// ════════════════════════════════════════════════
//  Cloudflare Worker — Proxy para api.anthropic.com
//  Pegá este código en:
//  workers.cloudflare.com → Create Worker → Edit code
// ════════════════════════════════════════════════

const ANTHROPIC_API_KEY = "sk-ant-api03-n4azMdgvnRC65UD6Z6DxHrmU2bl4Gl0BFqqKL63p3wu-J9vAiBitO3UypTaxqs1prh0Y6EFxuxYZGhIfVBukBA-CKv1OQAA";
const UPSTREAM          = "https://api.anthropic.com";

// Orígenes permitidos (agregá los tuyos si es necesario)
const ALLOWED_ORIGINS = [
  "https://claudioabril.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, anthropic-version",
    "Access-Control-Max-Age":       "86400",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";

    // ── Preflight ──
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ── Solo POST ──
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // ── Construir request hacia Anthropic ──
    const url      = UPSTREAM + new URL(request.url).pathname;
    const body     = await request.text();

    const upstream = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": request.headers.get("anthropic-version") ?? "2023-06-01",
      },
      body,
    });

    // ── Devolver respuesta con headers CORS ──
    const respHeaders = {
      ...Object.fromEntries(upstream.headers),
      ...corsHeaders(origin),
    };

    return new Response(upstream.body, {
      status:  upstream.status,
      headers: respHeaders,
    });
  },
};
