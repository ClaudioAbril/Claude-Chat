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
 * ║    x-app-token      → Token de acceso (si APP_TOKEN está ║
 * ║                       definido, es OBLIGATORIO)          ║
 * ║                                                          ║
 * ║  Variables de entorno del Worker (wrangler secret put):  ║
 * ║    NVIDIA_API_KEY                                        ║
 * ║    APP_TOKEN        → candado opcional: si se define,    ║
 * ║                       todos los pedidos deben traer el   ║
 * ║                       header x-app-token con ese valor.  ║
 * ║                       Evita que cualquiera con la URL    ║
 * ║                       pública use la API key.            ║
 * ║                                                          ║
 * ║  El chat se transmite en STREAMING: la respuesta upstream ║
 * ║  se re-envía tal cual (SSE si el cliente pidió stream).  ║
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
    "x-app-token",
  ].join(", "),
};

// ── Entry point ────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    // 1. Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // 2. Candado de acceso (opcional): si APP_TOKEN está definido en el
    //    Worker, TODO pedido debe traer el header x-app-token con ese valor.
    //    Sin esto, cualquiera con la URL pública podría usar la NVIDIA_API_KEY.
    const appToken = env.APP_TOKEN ?? "";
    if (appToken && request.headers.get("x-app-token") !== appToken) {
      return errResponse(
        "Token de acceso inválido o ausente (header x-app-token). Configuralo en el panel ⚙.",
        401
      );
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

/**
 * Devuelve la respuesta upstream con los headers CORS agregados.
 *
 * Pasa el body COMO STREAM (upstream.body) en lugar de bufferizarlo: si el
 * cliente pidió stream:true, NVIDIA responde SSE y los chunks llegan al
 * browser a medida que el modelo genera. Para respuestas JSON normales el
 * body también fluye igual (es un buffer chico).
 */
function proxyResponse(upstream) {
  return new Response(upstream.body, {
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
