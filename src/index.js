

You said:
continuing gothic game discussion:  it seems that we have a slight continuity  problem. when we enter the courtyard there is no fountains , but then when  we pick up the brass key and ghost appears next to a fountain in the courtyard

ChatGPT said:
Ahh yes — this is actually a classic deterministic-engine vs generative-image drift problem 🙂 and it makes total sense given how you’ve structured Gothic Chronicle (state-driven world + AI image prompts).

What’s happening is basically this:

👉 The image prompt is changing between states, but the Worker isn’t anchoring persistent scene elements (like the fountain), so the AI reinterprets the courtyard differently each time.

So visually:

First entry → AI imagines “courtyard” without fountain

After key pickup → state text adds drama → AI reinterprets courtyard and adds fountain

Result → continuity break

🧠 Why this happens (under the hood)
Your image generation probably works something like:

room = courtyard
state = [flags...]
prompt = buildPrompt(room, state)
The issue is:

👉 The base prompt for courtyard is not deterministic enough.

AI image models treat each prompt as a fresh scene unless you explicitly lock major features.

So unless your Worker says something like:

“stone courtyard with central fountain, always present…”

…the AI may decide:

courtyard = empty stone area

courtyard = statues

courtyard = overgrown garden

courtyard = fountain plaza

All valid interpretations.

✅ Correct architectural fix (not a hack)
You want environmental invariants.

Meaning:

Some scene elements are ALWAYS present regardless of narrative state.

In your case:

Courtyard MUST include fountain (core landmark)

🔧 Where to fix (Worker side — BEST place)
Inside your Cloudflare Worker where you build the prompt.

You probably have something like:

function buildPrompt(room, state) {
   if(room === "courtyard") {
       return "gothic courtyard ... " + stateDescription
   }
}
Instead change to:

if (room === "courtyard") {
   const baseScene =
     "moonlit gothic stone courtyard with a central weathered fountain, " +
     "aged statues, ivy-covered walls, dark romantic atmosphere";

   return baseScene + ", " + stateDescription;
}
Key idea:

👉 The fountain becomes part of the base immutable geometry.

🧱 Mental Model (SUPER important for your engine)
Separate:

1️⃣ Scene geometry (permanent world structure)
courtyard has fountain

hallway has stained glass

library has spiral staircase

These never change.

2️⃣ Narrative state overlays
ghost appears

gate unlocked

fog thicker

candles lit

These modify mood, not architecture.

Right now the AI is inventing geometry each render.

You want:

BASE WORLD + STATE MODIFIERS
not

STATE decides entire world
🎯 Why your ghost image suddenly gained a fountain
Likely your ghost state text included:

dramatic positioning

focal object

spatial reference

The model filled that with a fountain because:

👉 fountains are a common gothic courtyard trope.

So ironically the AI helped you discover what your courtyard probably should canonically include 😄

🚀 Optional next-level improvement (this will level up your whole system)
Instead of raw text building, create:

ROOM_CANON = {
  courtyard: {
     geometry: "stone courtyard with central fountain, gothic statues, iron gate",
     style: "dark romantic gothic horror"
  }
}
Then:

prompt = ROOM_CANON[room].geometry + stateModifiers
Now your world becomes visually consistent across:

renders

future expansions

new scenes

🔥 April’s strong recommendation (based on your engine design)
Do NOT try to fix this in:

render()

JS frontend

image reload logic

Fix ONLY in:

👉 Worker prompt builder

because that’s the single source of visual truth.

If you want, next step I can show you something VERY powerful:

👉 a 3-layer prompt architecture that will make Gothic Chronicle feel like one continuous cinematic world instead of AI snapshots.

(And honestly, you’re already 80% there.)


You said:
it has to be this block:    // Base prompt
        let prompt =
          Ultra realistic cinematic gothic horror.  +
          Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows.  +
          High detail, cinematic lighting, moody atmosphere.  +
          No text, no watermark, no modern objects. ;

        // ✅ Courtyard ghost only, and make it unmistakable
        if (room.toLowerCase() === "courtyard" && st.flags.has("courtyard_ghost_seen")) {
          prompt +=
            " Include a tall pale ghostly apparition near a cracked fountain; semi-transparent, subtle glow, Victorian haunting presence; mist coiling around its feet; eerie but clear focal subject.";
        }

ChatGPT said:
Yep — that’s exactly the block causing the continuity jump. Right now your base courtyard prompt does not guarantee a fountain, but your ghost-state add-on explicitly introduces one (“near a cracked fountain”). So the model is free to omit it on first entry, then “must” include it later.

Fix: make the fountain part of the courtyard’s base geometry (always), and keep the ghost add-on only about the ghost.
Here’s a clean drop-in rewrite of just that section (same style, minimal change):

// Base prompt
let prompt =
  `Ultra realistic cinematic gothic horror. ` +
  `Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows. ` +
  `High detail, cinematic lighting, moody atmosphere. ` +
  `No text, no watermark, no modern objects. `;

// ✅ Lock courtyard continuity: fountain is ALWAYS present
if (room.toLowerCase() === "courtyard") {
  prompt +=
    " Establishing features: a central cracked stone fountain is always present in the courtyard; " +
    "wet cobblestones, ivy-covered walls, weathered statues, wrought-iron gate in the distance; " +
    "same layout and landmarks, only mood/characters may change.";
}

// ✅ Courtyard ghost only, and make it unmistakable
if (room.toLowerCase() === "courtyard" && st.flags.has("courtyard_ghost_seen")) {
  prompt +=
    " Include a tall pale ghostly apparition beside the central cracked fountain; " +
    "semi-transparent, subtle glow, Victorian haunting presence; " +
    "mist coiling around its feet; eerie but clear focal subject.";
}
Why this works
First entry: courtyard prompt now always includes the fountain and landmarks.

After key/ghost: same courtyard + fountain stays, and you just add the ghost.

The AI stops “reinventing the courtyard” because you’ve anchored the geometry.

Extra tiny improvement (optional but nice)
Notice you currently have Scene: ${room} which can be vague (“courtyard” is a huge space). If you want even more stability, change only that line for courtyard:

`Scene: gothic estate courtyard (central cracked stone fountain, wet cobblestones, ivy walls). `
…but the earlier fix alone should solve the mismatch.

If you paste your full Worker prompt builder function (just that function), I can patch it in-place and keep your formatting exactly the way you like.


You said:
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
          Ultra realistic cinematic gothic horror.  +
          Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows.  +
          High detail, cinematic lighting, moody atmosphere.  +
          No text, no watermark, no modern objects. ;

        // ✅ Courtyard ghost only, and make it unmistakable
        if (room.toLowerCase() === "courtyard" && st.flags.has("courtyard_ghost_seen")) {
          prompt +=
            " Include a tall pale ghostly apparition near a cracked fountain; semi-transparent, subtle glow, Victorian haunting presence; mist coiling around its feet; eerie but clear focal subject.";
        }

        // Optional: react to candle_lit to brighten interiors slightly
        if (st.flags.has("candle_lit")) {
          prompt += " Add warm candlelight highlights and deeper shadow contrast.";
        }

        // 2) Deterministic seed (stable for same room+state+seedParam)
        const seed = await seedFromText(${room}::${state}::${seedParam});

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

ChatGPT said:
Perfect — thanks for dropping the whole block. You’re right on the money: the continuity break is because the fountain only exists in the ghost add-on, so the “first entry courtyard” prompt doesn’t pin it.

Here’s your same block, with the smallest surgical change: we add a courtyard base landmark clause (fountain always), and we tweak the ghost line to reference the central fountain (so it stays the same object).

✅ Drop-in replacement (only touches prompt building)
// Base prompt
let prompt =
  `Ultra realistic cinematic gothic horror. ` +
  `Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows. ` +
  `High detail, cinematic lighting, moody atmosphere. ` +
  `No text, no watermark, no modern objects. `;

// ✅ Courtyard continuity anchor: ALWAYS include the fountain + key landmarks
if (room.toLowerCase() === "courtyard") {
  prompt +=
    " Establishing features: a central cracked stone fountain is always present in the courtyard; " +
    "wet cobblestones, ivy-covered stone walls, weathered statues, wrought-iron gate in the distance; " +
    "keep the same layout and landmarks across renders; only mood/characters may change.";
}

// ✅ Courtyard ghost only, and make it unmistakable
if (room.toLowerCase() === "courtyard" && st.flags.has("courtyard_ghost_seen")) {
  prompt +=
    " Include a tall pale ghostly apparition beside the central cracked fountain; " +
    "semi-transparent, subtle glow, Victorian haunting presence; " +
    "mist coiling around its feet; eerie but clear focal subject.";
}
That’s it. Everything else in your handler can stay exactly as-is.

One important note about your caching (so you don’t get tricked)
Because your cache key is the full request URL, if your state differs between:

first entry (maybe m:m_gate_first or nothing)

after pickup (f:courtyard_ghost_seen|...)

…you’ll naturally get two different cached images. That’s fine.

But after you change the prompt, your old “no fountain” first-entry image might still show up if the URL matches an already-cached request.

Quick way to force new images (without changing any logic)
Just add something new into the request URL (any parameter) from the frontend once, like:

bump the t= timestamp you already use

or add v=2

Even a one-time “cache bust” will get you a fresh courtyard baseline.

(And yes — do a hard refresh in Chrome after you deploy, because you know that browser likes to cling to ghosts. 😄)

Even tighter continuity (optional, but tiny)
Right now you seed with:

`${room}::${state}::${seedParam}`
That means state changes = new seed = new composition, even if you want “same courtyard, plus ghost.”

If you ever want “same camera angle, same fountain placement” and only add the ghost, the trick is:

seed from room + seedParam only (stable composition)

let state only affect prompt text

But that’s optional — your new courtyard anchor will already solve the fountain appearing/disappearing problem.

If you paste the function parseState(state) (or tell me what flags you include on first courtyard entry vs after key), I can suggest the best “stable courtyard seed” strategy without breaking your deterministic caching.


You said:
here's the whole helper:     // src/index.js
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
        ${url.origin}/api/image/${imageId}.jpg +
        ?room=${encodeURIComponent(room)} +
        &state=${encodeURIComponent(state)} +
        &seed=${encodeURIComponent(seedParam)};

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
        json({ ok: true, imageId, url: ${url.origin}/api/image/${imageId}.jpg }),
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
          Ultra realistic cinematic gothic horror.  +
          Scene: ${room}. Fog, moonlight, ancient stone, dramatic shadows.  +
          High detail, cinematic lighting, moody atmosphere.  +
          No text, no watermark, no modern objects. ;

        // ✅ Courtyard ghost only, and make it unmistakable
        if (room.toLowerCase() === "courtyard" && st.flags.has("courtyard_ghost_seen")) {
          prompt +=
            " Include a tall pale ghostly apparition near a cracked fountain; semi-transparent, subtle glow, Victorian haunting presence; mist coiling around its feet; eerie but clear focal subject.";
        }

        // Optional: react to candle_lit to brighten interiors slightly
        if (st.flags.has("candle_lit")) {
          prompt += " Add warm candlelight highlights and deeper shadow contrast.";
        }

        // 2) Deterministic seed (stable for same room+state+seedParam)
        const seed = await seedFromText(${room}::${state}::${seedParam});

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

ChatGPT said:
Got it — your helper is clean, and parseState() is doing exactly what we expect. The continuity problem is 100% in prompt + seeding strategy, not parsing.

You’ve got two separate (but related) continuity levers:

Prompt invariants (make fountain always part of courtyard)

Seed stability (keep the “camera/layout” consistent across state changes)

You already saw #1. Now that you shared the whole file, we can do both in a way that still keeps your caching nice and deterministic.

1) Fix the fountain continuity (must-do)
Add this right after the base prompt:

// ✅ Courtyard continuity anchor: ALWAYS include the fountain + landmarks
if (room.toLowerCase() === "courtyard") {
  prompt +=
    " Establishing features: a central cracked stone fountain is always present in the courtyard; " +
    "wet cobblestones, ivy-covered stone walls, weathered statues, wrought-iron gate in the distance; " +
    "keep the same layout and landmarks across renders; only mood/characters may change.";
}
Then change your ghost add-on to reference “beside the central cracked fountain” instead of “near a cracked fountain”:

if (room.toLowerCase() === "courtyard" && st.flags.has("courtyard_ghost_seen")) {
  prompt +=
    " Include a tall pale ghostly apparition beside the central cracked stone fountain; " +
    "semi-transparent, subtle glow, Victorian haunting presence; mist coiling around its feet; " +
    "eerie but clear focal subject.";
}
That alone fixes the “fountain appears out of nowhere” issue.

2) Your bigger continuity problem (layout jump) is the seed formula
Right now you seed with:

const seed = await seedFromText(`${room}::${state}::${seedParam}`);
That guarantees: any state change ⇒ totally new seed ⇒ new composition/layout.

So even if the fountain exists in both prompts, the position of the fountain, camera angle, statues, etc. can swing wildly. That’s why it can still feel like “two different courtyards.”

Best approach: seed from stable “geometry state,” not narrative state
You already separate state into:

flags (like courtyard_ghost_seen, candle_lit)

miles (your milestones)

So we can do this:

✅ Keep the seed stable for a room unless a “geometry-changing” milestone occurs.

For now, courtyard geometry probably doesn’t change at all, so simplest:

Courtyard seed = ${room}::${seedParam} (ignore state entirely)

Other rooms can keep state in seed if you want them to shift more

Here’s the drop-in logic:

// 2) Deterministic seed
let seedKey = `${room}::${seedParam}`;

// If you WANT some rooms to change composition with state, do it selectively:
if (room.toLowerCase() !== "courtyard") {
  seedKey = `${room}::${state}::${seedParam}`;
}

const seed = await seedFromText(seedKey);
What this does
Courtyard becomes visually consistent across:

first entry

key pickup

ghost appearance

Ghost gets added to the same courtyard instead of generating a new courtyard.

3) One more critical thing: your cache key will still split images by state
Even if you stabilize the courtyard seed, your caching currently uses the full URL:

const cacheKey = new Request(url.toString(), { method: "GET" });
…and url.toString() includes state=....

So you’ll still store separate cached images for:

courtyard with no ghost

courtyard with ghost

That’s GOOD. You want two different images.

And since the courtyard seed is stable, they’ll share the same “layout DNA” — the ghost version will look like the same place.

Recommended “final form” patch (minimal + powerful)
Here is your prompt+seed section exactly how I’d ship it (only editing that part):

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
    "semi-transparent, subtle glow, Victorian haunting presence; mist coiling around its feet; " +
    "eerie but clear focal subject.";
}

// Optional: react to candle_lit to brighten interiors slightly
if (st.flags.has("candle_lit")) {
  prompt += " Add warm candlelight highlights and deeper shadow contrast.";
}

// 2) Deterministic seed (stable composition for courtyard)
let seedKey = `${room}::${seedParam}`;
if (room.toLowerCase() !== "courtyard") {
  seedKey = `${room}::${state}::${seedParam}`;
}
const seed = await seedFromText(seedKey);
Quick sanity check after deploy
After you deploy the Worker:

Hard refresh your game page (Chrome is stubborn)

Enter courtyard: confirm fountain present

Take brass key: confirm fountain still there AND ghost appears beside it

If the old “no fountain” courtyard keeps showing, it’s just the edge cache holding the old URL variant — bump your t= param once (or add &v=2) on the frontend to bust it.

If you want, paste your imageUrlForRoom() from game.js and I’ll show you the cleanest “version bump” that doesn’t mess with your deterministic IDs.


You said:
ok give me the entire fixed helper

ChatGPT said:
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



