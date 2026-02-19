// src/index.js
// Gothic Chronicle Worker – clean routing version

const ALLOWED_ORIGINS = new Set([
  "https://richcande1-rca.github.io",
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function clampUInt32(n) {
  return (Number(n) >>> 0);
}

async function seedFromText(text) {
  const hex = await sha256Hex(text);
  // take first 8 hex chars => 32-bit seed
  return clampUInt32(parseInt(hex.slice(0, 8), 16));
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request, env, ctx) {

    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const method = request.method.toUpperCase();

    // =====================
    // CORS PREFLIGHT
    // =====================
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // =====================
    // ROOT
    // =====================
    if (method === "GET" && url.pathname === "/") {
      return withCors(
        new Response("Hello World!", {
          headers: { "Content-Type": "text/plain" },
        }),
        origin
      );
    }

    // =====================
    // HEALTH CHECK
    // =====================
    if (method === "GET" && url.pathname === "/health") {
      return withCors(
        json({ ok: true, service: "gothic-chronicle-images", ts: Date.now() }),
        origin
      );
    }

    // =====================
    // IMAGE REDIRECT
    // GET /image?room=&state=
    // =====================
    if (method === "GET" && url.pathname === "/image") {

      const room = (url.searchParams.get("room") || "").trim();
      const state = (url.searchParams.get("state") || "").trim();
			const seedParam = (url.searchParams.get("seed") || room).trim(); 

      if (!room) {
        return withCors(json({ ok:false, error:"Missing ?room=" },400), origin);
      }

      const payload = { room, state, w:768, h:768 };
      const imageId = "img_" + await sha256Hex(JSON.stringify(payload));

      const redirectUrl =
        `${url.origin}/api/image/${imageId}.jpg` +
        `?room=${encodeURIComponent(room)}` +
        `&state=${encodeURIComponent(state)}`;
		`&seed=${encodeURIComponent(seedParam)}`;

      return withCors(
        new Response(null,{
          status:302,
          headers:{ Location: redirectUrl }
        }),
        origin
      );
    }

    // =====================
    // API GENERATE (JSON helper)
    // =====================
    if (method === "POST" && url.pathname === "/api/generate") {

      let body;
      try {
        body = await request.json();
      } catch {
        return withCors(json({ ok:false, error:"Invalid JSON" },400), origin);
      }

      if (!body?.prompt) {
        return withCors(json({ ok:false, error:"Missing prompt" },400), origin);
      }

      const payload = {
        prompt: body.prompt,
        seed: body.seed ?? 0,
        w: body.w ?? 768,
        h: body.h ?? 768
      };

      const imageId = "img_" + await sha256Hex(JSON.stringify(payload));

      return withCors(
        json({
          ok:true,
          imageId,
          url:`${url.origin}/api/image/${imageId}.jpg`
        }),
        origin
      );
    }

// =====================
// REAL IMAGE GENERATION (DETERMINISTIC + CACHED)
// =====================
if (method === "GET" && url.pathname.startsWith("/api/image/")) {

  const room = (url.searchParams.get("room") || "gothic estate").trim();
  const state = (url.searchParams.get("state") || "").trim();
  const seedParam = (url.searchParams.get("seed") || room).trim();

  // Cache key = full request URL (includes room/state/seed + /api/image/<id>.jpg)
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;

  // 1) Try cache first
  const cached = await cache.match(cacheKey);
  if (cached) {
    return withCors(cached, origin);
  }

  const prompt =
    `Ultra realistic cinematic gothic horror, Transylvania 2026. ` +
    `Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows. ` +
    `High detail, cinematic lighting, moody atmosphere. ` +
    `No text, no watermark, no modern objects. ` +
    (state ? `Story tone: ${state}.` : "");

  try {
    if (!env.AI) {
      return withCors(
        json({ ok: false, error: "AI binding missing (env.AI undefined)" }, 500),
        origin
      );
    }

    // 2) Deterministic seed (stable for same room+state+seedParam)
    const seed = await seedFromText(`${room}::${state}::${seedParam}`);

    // 3) Generate
    const result = await env.AI.run("@cf/leonardo/phoenix-1.0", {
      prompt,
      // If the model supports seed, this helps consistency.
      // If ignored, caching still prevents re-gen for same URL.
      seed
    });

    const imageData = result?.image || result;

    const response = new Response(imageData, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        // Tell browsers/CDN this is safe to reuse for a long time
        "Cache-Control": "public, max-age=31536000, immutable",
      }
    });

    // 4) Store in edge cache (async)
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return withCors(response, origin);

  } catch (err) {
    return withCors(
      json({
        ok: false,
        error: "Image generation failed",
        detail: String(err?.message || err),
        hasAI: !!env.AI
      }, 500),
      origin
    );
  }
}

    // =====================
    // FALLBACK
    // =====================
    return withCors(json({ ok:false, error:"Not found" },404), origin);
  }
};
