// src/index.js
// Gothic Chronicle Worker – clean routing version (FINAL w/ versioned cache bust)

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

// Parse state like: "f:courtyard_ghost_seen,candle_lit|m:m_courtyard_first"
function parseState(stateStr) {
  const out = { flags: new Set(), miles: new Set() };
  if (!stateStr) return out;

  const parts = stateStr.split("|");
  for (const p of parts) {
    if (p.startsWith("f:")) {
      p.slice(2).split(",").map(s => s.trim()).filter(Boolean).forEach(s => out.flags.add(s));
    } else if (p.startsWith("m:")) {
      p.slice(2).split(",").map(s => s.trim()).filter(Boolean).forEach(s => out.miles.add(s));
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
    // GET /image?room=&state=&seed=&v=&t=
    // =====================
    if (method === "GET" && url.pathname === "/image") {
      const room = (url.searchParams.get("room") || "").trim();
      const state = (url.searchParams.get("state") || "").trim();
      const seedParam = (url.searchParams.get("seed") || room).trim();
      const v = (url.searchParams.get("v") || "1").trim(); // ✅ prompt/cache version

      if (!room) {
        return withCors(json({ ok: false, error: "Missing ?room=" }, 400), origin);
      }

      // IMPORTANT: include seed + v in payload so imageId changes when prompts change
      const payload = { room, state, seed: seedParam, v, w: 768, h: 768 };
      const imageId = "img_" + await sha256Hex(JSON.stringify(payload));

      const redirectUrl =
        `${url.origin}/api/image/${imageId}.jpg` +
        `?room=${encodeURIComponent(room)}` +
        `&state=${encodeURIComponent(state)}` +
        `&seed=${encodeURIComponent(seedParam)}` +
        `&v=${encodeURIComponent(v)}` +
        (url.searchParams.get("debug") === "1" ? `&debug=1` : "");

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
        const v = (url.searchParams.get("v") || "1").trim(); // ✅ keep in URL for cache identity

        // Cache key = full request URL (includes room/state/seed/v + /api/image/<id>.jpg)
        const cacheKey = new Request(url.toString(), { method: "GET" });
        const cache = caches.default;

        // 1) Try cache first
        const cached = await cache.match(cacheKey);
        if (cached) return withCors(cached, origin);

        const st = parseState(state);

        const roomKey = room.toLowerCase();
        const isCourtyard = roomKey.includes("courtyard");

        // ===== PROMPT BUILD =====

        const sceneLine = isCourtyard
          ? "Scene: a moonlit gothic stone courtyard with a central cracked stone fountain clearly visible at center frame."
          : `Scene: ${room}.`;

        let prompt =
          `Ultra realistic cinematic gothic horror. ` +
          `${sceneLine} ` +
          `Fog, moonlight, ancient stone, dramatic shadows. ` +
          `High detail, cinematic lighting, moody atmosphere. ` +
          `No text, no watermark, no modern objects. `;

        // Courtyard anchor
        if (isCourtyard) {
          prompt +=
            " The central cracked stone fountain MUST be clearly visible and centered; " +
            "wet cobblestones, ivy-covered walls, weathered statues, wrought-iron gate in distance. " +
            "Keep consistent layout across renders.";
        }

// Ghost positioning (SAFE ZONE — visible, not cropped, not centered)
if (isCourtyard && st.flags.has("courtyard_ghost_seen")) {
  prompt +=
" A clearly visible human-shaped apparition stands LEFT OF THE CENTRAL FOUNTAIN " +
" as a dominant subject in the scene. " +
" The full figure is unmistakably humanoid in proportion and posture. " +
" The body appears semi-transparent and partially incomplete. " +
" Sections of the torso and limbs dissolve into drifting vapor, " +
" then reform in unstable patterns. " +
" Moonlight passes through fractured areas of the figure, " +
" revealing gaps in its form. " +
" The silhouette remains readable and centered in frame. " +
" No detailed facial features, only a faint hollow suggestion of a face. " +
" The apparition appears to be struggling to remain cohesive. " +
" Full figure visible in frame, not cropped and not obscured. " +
" The apparition is clearly NOT a statue or solid sculpture; " +
" it appears suspended, shifting, and weightless above the fountain. ";

  if (st.flags.has("candle_lit")) {
    prompt +=
      " Add warm candlelight interacting with the mist, " +
      " creating subtle glowing highlights and deeper shadows. ";
  }
}

        // 2) Deterministic seed
        // Courtyard: stable composition across state changes
        // Other rooms: state influences composition (optional)
       let seedKey = `${room}::${seedParam}`;

if (isCourtyard && st.flags.has("courtyard_ghost_seen")) {
  // new deterministic camera for the ghost moment
  seedKey = `${room}::${seedParam}::ghost`;
} else if (!isCourtyard) {
  seedKey = `${room}::${state}::${seedParam}`;
}

const seed = await seedFromText(seedKey);

        // Debug mode
        if (url.searchParams.get("debug") === "1") {
          return withCors(
            json({ ok: true, room, state, seedParam, v, isCourtyard, seedKey, seed, prompt }),
            origin
          );
        }

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
