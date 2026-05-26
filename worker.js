/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  AI Proxy Worker  –  Multi-provider                     ║
 * ║                                                          ║
 * ║  Rutas:                                                  ║
 * ║    POST /v1/messages          → Anthropic               ║
 * ║    POST /v1/chat/completions  → GitHub Models / OpenAI  ║
 * ║    OPTIONS *                  → CORS preflight          ║
 * ║                                                          ║
 * ║  Headers que acepta del cliente:                         ║
 * ║    x-user-api-key   → API key Anthropic (opcional)      ║
 * ║    Authorization    → Bearer <token> para OAI/GitHub    ║
 * ║    x-provider       → "github" | "openai" (default)     ║
 * ║                                                          ║
 * ║  Variables de entorno del Worker (wrangler secret put):  ║
 * ║    ANTHROPIC_API_KEY                                     ║
 * ║    GITHUB_TOKEN                                          ║
 * ║    OPENAI_API_KEY                                        ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const UPSTREAMS = {
  anthropic: "https://api.anthropic.com/v1/messages",
  github:    "https://models.inference.ai.azure.com/chat/completions",
  openai:    "https://api.openai.com/v1/chat/completions",
};

// CORS headers presentes en TODAS las respuestas (incluyendo errores).
// Sin esto el browser no puede leer el body de una 4xx y muestra "Failed to fetch".
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": [
    "Content-Type",
    "Authorization",
    "anthropic-version",
    "x-user-api-key",
    "x-provider",
  ].join(", "),
};

// ── Entry point ────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    // 1. Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "POST") {
      return errResponse("Method Not Allowed", 405);
    }

    const path = new URL(request.url).pathname;

    if (path === "/v1/messages") {
      return handleAnthropic(request, env);
    }

    if (path === "/v1/chat/completions") {
      return handleOpenAICompat(request, env);
    }

    return errResponse(`Unknown path: ${path}`, 404);
  },
};

// ── Handler: Anthropic ─────────────────────────────────────────────────────

async function handleAnthropic(request, env) {
  // Prioridad: key del cliente → variable de entorno del Worker
  const apiKey =
    request.headers.get("x-user-api-key") ||
    (env.ANTHROPIC_API_KEY ?? "");

  if (!apiKey) {
    return errResponse(
      "No Anthropic API key. Configurá una en el panel ⚙ o en las variables del Worker.",
      401
    );
  }

  const body = await request.text();

  let upstream;
  try {
    upstream = await fetch(UPSTREAMS.anthropic, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
        "x-api-key":         apiKey,
      },
      body,
    });
  } catch (e) {
    return errResponse(`Error conectando con Anthropic: ${e.message}`, 502);
  }

  return proxyResponse(upstream);
}

// ── Handler: OpenAI-compatible (GitHub Models, OpenAI) ────────────────────

async function handleOpenAICompat(request, env) {
  const provider = (request.headers.get("x-provider") || "openai").toLowerCase();

  if (!UPSTREAMS[provider]) {
    return errResponse(`Provider desconocido: "${provider}". Usá "github" u "openai".`, 400);
  }

  // Extraer token del header Authorization: "Bearer <token>"
  const authHeader = request.headers.get("authorization") ?? "";
  const clientKey  = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  // Prioridad: key del cliente → variable de entorno del Worker
  const apiKey =
    clientKey ||
    (provider === "github" ? env.GITHUB_TOKEN : env.OPENAI_API_KEY) ||
    "";

  if (!apiKey) {
    return errResponse(
      `No API key para "${provider}". Configurá una en el panel ⚙ o en las variables del Worker.`,
      401
    );
  }

  const body = await request.text();

  let upstream;
  try {
    upstream = await fetch(UPSTREAMS[provider], {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body,
    });
  } catch (e) {
    return errResponse(`Error conectando con ${provider}: ${e.message}`, 502);
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

/** Error estructurado en formato compatible con ambas APIs. */
function errResponse(message, status) {
  return new Response(
    JSON.stringify({ error: { message, type: "proxy_error" } }),
    {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    }
  );
}
