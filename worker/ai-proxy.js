// Cloudflare Worker: AI relay for the battle simulator.
// Keeps the NVIDIA API key on the server (secret NVIDIA_API_KEY) and adds CORS
// so the GitHub Pages site can call it from the browser.
//
// Deploy: Cloudflare dashboard > Workers & Pages > Create > Worker > paste this file
//         Settings > Variables and Secrets > add secret NVIDIA_API_KEY = nvapi-...
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions';
const ALLOWED_ORIGINS = ['https://jageobyong358-prog.github.io', 'http://localhost:8765', 'http://localhost:8080'];
const ALLOWED_MODELS = ['minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3-ultra-550b-a55b', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash'];
const EFFORTS = ['low', 'medium', 'high'];
const MAX_TOKENS = 32000;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const enc = new TextEncoder();
const sse = (obj) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers });
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('origin not allowed', { status: 403, headers });
    if (!env.NVIDIA_API_KEY) return new Response('NVIDIA_API_KEY secret is not set', { status: 500, headers });

    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400, headers }); }
    const { model, messages } = body || {};
    if (!ALLOWED_MODELS.includes(model)) return new Response('model not allowed', { status: 400, headers });
    if (!Array.isArray(messages) || !messages.length || messages.length > 40) return new Response('bad messages', { status: 400, headers });
    for (const m of messages) {
      if (!['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 80000) {
        return new Response('bad message', { status: 400, headers });
      }
    }

    // Answer at once with an event stream. While NVIDIA queues the request we send
    // SSE comments (": ping") so nothing in between drops a silent connection;
    // then the upstream stream is piped through. Upstream errors arrive as
    // `data: {"error": {...}}` events.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const ping = () => writer.write(enc.encode(': ping\n\n')).catch(() => {});
    ping();
    let timer = setInterval(ping, 5000);
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const work = (async () => {
      try {
        const upstream = await fetch(UPSTREAM, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: Math.min(Number(body.max_tokens) || 8000, MAX_TOKENS),
            temperature: 0.4,
            stream: true,
            ...(EFFORTS.includes(body.reasoning_effort) ? { reasoning_effort: body.reasoning_effort } : {}),
          }),
        });
        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text();
          let msg = text.slice(0, 300);
          try { const j = JSON.parse(text); msg = j.detail || j.error?.message || j.title || msg; } catch { /* keep text */ }
          stop();
          await writer.write(sse({ error: { status: upstream.status, message: msg } }));
          return;
        }
        const reader = upstream.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          stop(); // real data is flowing; no more pings (they could split an SSE line)
          await writer.write(value);
        }
      } catch (err) {
        stop();
        await writer.write(sse({ error: { status: 502, message: `upstream unreachable: ${err.message}` } })).catch(() => {});
      } finally {
        stop();
        await writer.close().catch(() => {});
      }
    })();
    ctx.waitUntil(work);
    return new Response(readable, { headers: { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  },
};
