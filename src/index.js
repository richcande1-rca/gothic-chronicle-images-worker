// src/index.js
// Minimal routing + CORS + stub image API for Gothic Chronicle
// Safe to deploy now; we’ll swap the stub generator for real image gen later.

const ALLOWED_ORIGINS = new Set([
  "https://richcande1-rca.github.io",
  // If you use a custom domain later, add it here:
  // "https://yourdomain.com",
]);

function corsHeaders(origin) {
  const ok = origin && ALLOWED_ORIGINS.has(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  const h = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  return new Response(JSON.stringify(data, null, 2), { status, headers: h });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Routes
    let response;

    // 1) Root (keep your existing behavior)
    if (method === "GET" && url.pathname === "/") {
      response = new Response("Hello World!", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // 2) Health check (easy test endpoint)
    else if (method === "GET" && url.pathname === "/health") {
      response = json({ ok: true, service: "gothic-chronicle-images", ts: Date.now() });
    }

			  // 2.5) Front-end convenience: direct image URL for <img>
    // GET /image?room=gate&seed=gate
    else if (method === "GET" && url.pathname === "/image") {
      const room = (url.searchParams.get("room") || "").trim();
      const seed = (url.searchParams.get("seed") || room).trim();

      if (!room) {
        response = json({ ok: false, error: "Missing ?room=" }, 400);
        return withCors(response, origin);
      }

      // Keep payload deterministic and compatible with future generator
      const payload = {
        type: "scene_room",
        prompt: `Room: ${room}. Seed: ${seed}.`, // stub prompt for now
        seed: 0,
        w: 768,
        h: 768,
        variant: "v1",
      };

      const imageId = "img_" + (await sha256Hex(JSON.stringify(payload)));
      const imageUrl = `${url.origin}/api/image/${imageId}.png`;

      // Redirect so <img src="..."> works immediately
      response = new Response(null, {
        status: 302,
        headers: { Location: imageUrl },
      });
    }

    // 3) Generate endpoint (stub for now)
    // POST /api/generate  { prompt, seed, w, h, variant, type }
    else if (method === "POST" && url.pathname === "/api/generate") {
      let body;
      try {
        body = await request.json();
      } catch {
        response = json({ ok: false, error: "Invalid JSON body" }, 400);
        return withCors(response, origin);
      }

      const payload = {
        type: body?.type ?? "scene_card",
        prompt: body?.prompt ?? "",
        seed: Number.isFinite(body?.seed) ? body.seed : 0,
        w: Number.isFinite(body?.w) ? body.w : 768,
        h: Number.isFinite(body?.h) ? body.h : 768,
        variant: body?.variant ?? "v1",
      };

      if (!payload.prompt || typeof payload.prompt !== "string") {
        response = json({ ok: false, error: "Missing 'prompt' (string)" }, 400);
        return withCors(response, origin);
      }

      // Stable ID so same request = same imageId (great for caching later)
      const imageId = "img_" + (await sha256Hex(JSON.stringify(payload)));

      // For now we return a placeholder “image” route.
      // Later we’ll generate+store a real PNG and this URL will serve it.
      const imageUrl = `${url.origin}/api/image/${imageId}.png`;

      response = json({
        ok: true,
        cached: false, // stub
        imageId,
        url: imageUrl,
        request: payload,
      });
    }

    // 4) Image endpoint (stub)
    // GET /api/image/<id>.png
    else if (method === "GET" && url.pathname.startsWith("/api/image/")) {
      // For now, return a simple text response so you can confirm wiring.
      // Later this becomes: fetch from R2 and stream image/png.
      response = new Response("Image not generated yet (stub).", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Not found
    else {
      response = json(
        {
          ok: false,
          error: "Not found",
          hint: "Try GET /health or POST /api/generate",
          path: url.pathname,
          method,
        },
        404
      );
    }

    return withCors(response, origin);
  },
};

function withCors(response, origin) {
  const h = new Headers(response.headers);
  const cors = corsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(response.body, { status: response.status, headers: h });
}

