// Cloudflare Worker: AI relay for the battle simulator.
// Keeps the NVIDIA API key on the server (secret NVIDIA_API_KEY) and adds CORS
// so the GitHub Pages site can call it from the browser.
//
// Deploy: Cloudflare dashboard > Workers & Pages > Create > Worker > paste this file
//         Settings > Variables and Secrets > add secret NVIDIA_API_KEY = nvapi-...
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions';
const ALLOWED_ORIGINS = ['https://jageobyong358-prog.github.io', 'http://localhost:8765', 'http://localhost:8080'];
const ALLOWED_MODELS = ['minimaxai/minimax-m3.1-flash', 'deepseek-ai/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash', 'openai/gpt-oss-20b'];
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

export default {
  async fetch(request, env) {
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
    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: Math.min(Number(body.max_tokens) || 8000, MAX_TOKENS),
        temperature: 0.4,
      }),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: `upstream unreachable: ${err.message}` } }), { status: 502, headers: { ...headers, 'content-type': 'application/json' } });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...headers, 'content-type': upstream.headers.get('content-type') || 'application/json' },
    });
  },
};
