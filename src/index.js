// src/index.js
// Gothic Chronicle Worker – clean routing version (fixed)

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

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedFromText(text) {
  const hex = await sha256Hex(text);
  return clampUInt32(parseInt(hex.slice(0, 8), 16));
}

// Parse `state` like: "f:courtyard_ghost_seen,candle_lit|m:m_courtyard_first"
function parseState(stateStr) {
  const out = { flags: new Set(), miles: new Set() };
  if (!stateStr) return out;

  const parts = stateStr.split("|");
  for (const p of parts) {
    if (p.startsWith("f:")) {
      p.slice(2)
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(s => out.flags.add(s));
    } else if (p.startsWith("m:")) {
      p.slice(2)
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(s => out.miles.add(s));
    }
  }
  return out;
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
        new Response("Hello World!", { headers: { "Content-Type": "text/plain" } }),
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
    // GET /image?room=&state=&seed=&t=
    // =====================
    if (method === "GET" && url.pathname === "/image") {
      const room = (url.searchParams.get("room") || "").trim();
      const state = (url.searchParams.get("state") || "").trim();
      const seedParam = (url.searchParams.get("seed") || room).trim();

      if (!room) {
        return withCors(json({ ok: false, error: "Missing ?room=" }, 400), origin);
      }

      // IMPORTANT: include seed in payload so imageId differs across seeds too
      const payload = { room, state, seed: seedParam, w: 768, h: 768 };
      const imageId = "img_" + await sha256Hex(JSON.stringify(payload));

      const redirectUrl =
        `${url.origin}/api/image/${imageId}.jpg` +
        `?room=${encodeURIComponent(room)}` +
        `&state=${encodeURIComponent(state)}` +
        `&seed=${encodeURIComponent(seedParam)}`;

      return withCors(
        new Response(null, { status: 302, headers: { Location: redirectUrl } }),
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
        return withCors(json({ ok: false, error: "Invalid JSON" }, 400), origin);
      }

      if (!body?.prompt) {
        return withCors(json({ ok: false, error: "Missing prompt" }, 400), origin);
      }

      const payload = {
        prompt: body.prompt,
        seed: body.seed ?? 0,
        w: body.w ?? 768,
        h: body.h ?? 768
      };

      const imageId = "img_" + await sha256Hex(JSON.stringify(payload));

      return withCors(
        json({ ok: true, imageId, url: `${url.origin}/api/image/${imageId}.jpg` }),
        origin
      );
    }

    // =====================
    // REAL IMAGE GENERATION (DETERMINISTIC + CACHED)
    // =====================
    if (method === "GET" && url.pathname.startsWith("/api/image/")) {
      try {
        const room = (url.searchParams.get("room") || "gothic estate").trim();
        const state = (url.searchParams.get("state") || "").trim();
        const seedParam = (url.searchParams.get("seed") || room).trim();

        // Cache key = full request URL (includes room/state/seed + /api/image/<id>.jpg)
        const cacheKey = new Request(url.toString(), { method: "GET" });
        const cache = caches.default;

        // 1) Try cache first
        const cached = await cache.match(cacheKey);
        if (cached) return withCors(cached, origin);

        const st = parseState(state);

        // Base prompt
        let prompt =
          `Ultra realistic cinematic gothic horror. ` +
          `Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows. ` +
          `High detail, cinematic lighting, moody atmosphere. ` +
          `No text, no watermark, no modern objects. `;

        // ✅ Courtyard continuity anchor: ALWAYS include the fountain + landmarks
        if (room.toLowerCase() === "courtyard") {
          prompt +=
            " Establishing features: a central cracked stone fountain is always present in the courtyard; " +
            "wet cobblestones, ivy-covered stone walls, weathered statues, wrought-iron gate in the distance; " +
            "keep the same layout and landmarks across renders; only mood/characters may change.";
        }

        // ✅ Courtyard ghost only, and make it unmistakable
        if (room.toLowerCase() === "courtyard" && st.flags.has("courtyard_ghost_seen")) {
          prompt +=
            " Include a tall pale ghostly apparition beside the central cracked stone fountain; " +
            "semi-transparent, subtle glow, Victorian haunting presence; " +
            "mist coiling around its feet; eerie but clear focal subject.";
        }

        // Optional: react to candle_lit to brighten interiors slightly
        if (st.flags.has("candle_lit")) {
          prompt += " Add warm candlelight highlights and deeper shadow contrast.";
        }

        // 2) Deterministic seed
        //    Courtyard: keep composition stable across state changes
        //    Other rooms: allow state to influence composition (optional)
        let seedKey = `${room}::${seedParam}`;
        if (room.toLowerCase() !== "courtyard") {
          seedKey = `${room}::${state}::${seedParam}`;
        }
        const seed = await seedFromText(seedKey);

        // 3) Generate
        const result = await env.AI.run("@cf/leonardo/phoenix-1.0", {
          prompt,
          seed
        });

        const imageData = result?.image || result;

        const response = new Response(imageData, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
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
    return withCors(json({ ok: false, error: "Not found" }, 404), origin);
  }
};
