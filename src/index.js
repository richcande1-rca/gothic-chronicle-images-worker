// src/index.js
// Minimal routing + CORS + image API for Gothic Chronicle (Cloudflare Worker)
// - GET  /           -> Hello World
// - GET  /health     -> JSON health check
// - GET  /image      -> 302 redirect to stable /api/image/<hash>.jpg
// - POST /api/generate -> JSON returns stable URL
// - GET  /api/image/<id>.jpg -> REAL image generation (Cloudflare AI)

const ALLOWED_ORIGINS = new Set([
  "https://richcande1-rca.github.io",
  // "http://localhost:5173", // uncomment if you test locally
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

function withCors(response, origin) {
  const h = new Headers(response.headers);
  const cors = corsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(response.body, { status: response.status, headers: h });
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
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Normalize whatever CF AI returns into a Response body
function imageResponseBody(image) {
  // Some CF models return ArrayBuffer / Uint8Array
  if (image instanceof ArrayBuffer) return image;
  if (image instanceof Uint8Array) return image;
  // Some may return { image: ... } or base64; keep it flexible:
  if (image && typeof image === "object") {
    if (image.image instanceof ArrayBuffer) return image.image;
    if (image.image instanceof Uint8Array) return image.image;
    if (typeof image.image === "string") {
      // if base64 string (no data URL), decode:
      try {
        const b64 = image.image.replace(/^data:.*;base64,/, "");
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      } catch {
        // fallthrough
      }
    }
  }
  // If it’s already a stream or something Response can take, just pass through
  return image;
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

    let response;

    // 1) Root
    if (method === "GET" && url.pathname === "/") {
      response = new Response("Hello World!", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
      return withCors(response, origin);
    }

    // 2) Health
    if (method === "GET" && url.pathname === "/health") {
      response = json({ ok: true, service: "gothic-chronicle-images", ts: Date.now() });
      return withCors(response, origin);
    }

    // 3) Friendly <img> endpoint: /image?room=&seed=&state=
    // Redirects to stable /api/image/<hash>.jpg
    if (method === "GET" && url.pathname === "/image") {
      const room = (url.searchParams.get("room") || "").trim();
      const seed = (url.searchParams.get("seed") || room).trim();
      const state = (url.searchParams.get("state") || "").trim();

      if (!room) {
        response = json({ ok: false, error: "Missing ?room=" }, 400);
        return withCors(response, origin);
      }

      const payload = {
        type: "scene_room",
        room,
        state,
        seed,
        w: 768,
        h: 768,
        variant: "v1",
      };

      const imageId = "img_" + (await sha256Hex(JSON.stringify(payload)));

      // Keep room/state as query params so /api/image can use them to build prompt.
      const imageUrl = `${url.origin}/api/image/${imageId}.jpg?room=${encodeURIComponent(room)}&state=${encodeURIComponent(state)}`;

      response = new Response(null, { status: 302, headers: { Location: imageUrl } });
      return withCors(response, origin);
    }

    // 4) POST /api/generate  { prompt, seed, w, h, variant, type }
    if (method === "POST" && url.pathname === "/api/generate") {
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

      const imageId = "img_" + (await sha256Hex(JSON.stringify(payload)));
      const imageUrl = `${url.origin}/api/image/${imageId}.jpg`;

      response = json({
        ok: true,
        cached: false,
        imageId,
        url: imageUrl,
        request: payload,
      });

      return withCors(response, origin);
    }

    // 5) GET /api/image/<id>.jpg  (REAL IMAGE)
    if (method === "GET" && url.pathname.startsWith("/api/image/")) {
      // We don't strictly need the id for generation right now, but it’s nice for caching later.
      const id = url.pathname.slice("/api/image/".length);

      const room = (url.searchParams.get("room") || "gothic estate").trim();
      const state = (url.searchParams.get("state") || "").trim();

      const prompt =
        `Ultra realistic cinematic gothic horror, Transylvania 2026. ` +
        `Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows. ` +
        `High detail, cinematic lighting, moody atmosphere. ` +
        `No text, no watermark, no modern objects. ` +
        (state ? `Story tone: ${state}.` : "");

      try {
        const image = await env.AI.run("@cf/leonardo/phoenix-1.0", { prompt });

        response = new Response(imageResponseBody(image), {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            // Optional: encourage CDN caching if you want stable URLs to be cache-friendly
            // "Cache-Control": "public, max-age=31536000, immutable",
          },
        });

        return withCors(response, origin);
      } catch (err) {
        response = json(
          {
            ok: false,
            error: "Image generation failed",
            id,
            detail: String(err?.message || err),
          },
          500
        );
        return withCors(response, origin);
      }
    }

    // 6) Not found
    response = json({ ok: false, error: "Not found", path: url.pathname }, 404);
    return withCors(response, origin);
  },
};
