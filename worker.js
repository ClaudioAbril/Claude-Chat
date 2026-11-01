/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  AI Proxy Worker  –  NVIDIA NIM (OpenAI-compatible)      ║
 * ║                                                          ║
 * ║  Rutas:                                                  ║
 * ║    POST /v1/chat/completions  → Chat (NVIDIA NIM)        ║
 * ║    GET  /v1/models            → Catálogo de modelos      ║
 * ║    OPTIONS *                  → CORS preflight           ║
 * ║                                                          ║
 * ║  Headers que acepta del cliente:                         ║
 * ║    Authorization    → Bearer <token> NVIDIA (opcional)   ║
 * ║                                                          ║
 * ║  Variables de entorno del Worker (wrangler secret put):  ║
 * ║    NVIDIA_API_KEY                                        ║
 * ║                                                          ║
 * ║  Mecanismo de selección de modelos (igual que en         ║
 * ║  Analizador-Vulnerabilidades): la UI llama a /v1/models  ║
 * ║  con el botón "Probar conexión" y llena el dropdown del  ║
 * ║  campo "Modelo"; el catálogo es público, así que la      ║
 * ║  autenticación se valida aparte con un chat mínimo.      ║
 * ╚══════════════════════════════════════════════════════════╝
 */

// Base OpenAI-compatible de NVIDIA NIM (mismo preset que usa
// Analizador-Vulnerabilidades).
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

// CORS headers presentes en TODAS las respuestas (incluyendo errores).
// Sin esto el browser no puede leer el body de una 4xx y muestra "Failed to fetch".
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": [
    "Content-Type",
    "Authorization",
  ].join(", "),
};

// ── Entry point ────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    // 1. Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const path = new URL(request.url).pathname;

    if (path === "/v1/chat/completions" && request.method === "POST") {
      return handleChat(request, env);
    }

    if (path === "/v1/models" && request.method === "GET") {
      return handleModels(request, env);
    }

    return errResponse(`Method Not Allowed para: ${request.method} ${path}`, 405);
  },
};

// ── Auth ───────────────────────────────────────────────────────────────────

/**
 * Resuelve la API key de NVIDIA.
 * Prioridad: key del cliente (Authorization: Bearer) → variable del Worker.
 */
function resolveApiKey(request, env) {
  const authHeader = request.headers.get("authorization") ?? "";
  const clientKey  = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  return clientKey || (env.NVIDIA_API_KEY ?? "");
}

// ── Handler: chat completions ──────────────────────────────────────────────

async function handleChat(request, env) {
  const apiKey = resolveApiKey(request, env);

  if (!apiKey) {
    return errResponse(
      "No NVIDIA API key. Configurá una en el panel ⚙ o con `wrangler secret put NVIDIA_API_KEY`.",
      401
    );
  }

  const body = await request.text();

  let upstream;
  try {
    upstream = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body,
    });
  } catch (e) {
    return errResponse(`Error conectando con NVIDIA NIM: ${e.message}`, 502);
  }

  return proxyResponse(upstream);
}

// ── Handler: listado de modelos ────────────────────────────────────────────

/**
 * Proxy del catálogo de modelos (GET /v1/models de NVIDIA NIM, formato
 * OpenAI: { object: "list", data: [{ id, ... }] }).
 *
 * El catálogo es PÚBLICO (no valida la key), por eso la UI complementa con
 * un chat mínimo para verificar autenticación y que el modelo elegido exista.
 */
async function handleModels(request, env) {
  const apiKey = resolveApiKey(request, env);

  let upstream;
  try {
    upstream = await fetch(`${NVIDIA_BASE}/models`, {
      method: "GET",
      headers: apiKey ? { "Authorization": `Bearer ${apiKey}` } : {},
    });
  } catch (e) {
    return errResponse(`Error conectando con NVIDIA NIM: ${e.message}`, 502);
  }

  return proxyResponse(upstream);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Devuelve la respuesta upstream con los headers CORS agregados. */
async function proxyResponse(upstream) {
  const body = await upstream.text();
  return new Response(body, {
    status:  upstream.status,
    headers: {
      ...CORS,
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
    },
  });
}

/** Error estructurado en formato OpenAI-compatible. */
function errResponse(message, status) {
  return new Response(
    JSON.stringify({ error: { message, type: "proxy_error" } }),
    {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    }
  );
}
