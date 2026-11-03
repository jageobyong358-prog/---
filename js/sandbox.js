// Runs the battle engine (and any user / AI written effect code) inside an
// opaque-origin sandboxed iframe with a CSP that forbids network access.
// The page talks to it with postMessage only.

const BOOT = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">
</head><body><script>
(function(){
  let battle = null;
  const reply = (id, ok, data) => parent.postMessage({ __lbs: 1, id, ok, data }, '*');
  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data || {};
    if (!m.__lbs) return;
    try {
      if (m.cmd === 'load') { (0, eval)(m.code); return reply(m.id, true, { builtins: LimbusEngine.BUILTIN_STATUSES, hooks: LimbusEngine.HOOK_NAMES }); }
      const E = LimbusEngine;
      switch (m.cmd) {
        case 'create': battle = E.createBattle(m.args); return reply(m.id, true, { view: E.view(battle), events: battle.events });
        case 'begin': { const r = E.beginTurn(battle); return reply(m.id, true, { view: E.view(battle), events: r.events }); }
        case 'resolve': { const r = E.resolveTurn(battle, m.args); return reply(m.id, true, { view: E.view(battle), events: r.events, result: r.result }); }
        case 'validate': return reply(m.id, true, E.validateEffect(m.args));
        default: return reply(m.id, false, 'unknown command ' + m.cmd);
      }
    } catch (err) { reply(m.id, false, String(err && err.stack || err)); }
  });
  parent.postMessage({ __lbs: 1, ready: true }, '*');
})();
<\/script></body></html>`;

class EngineSandbox {
  constructor() {
    this.seq = 0;
    this.waiting = new Map();
    this.ready = this._init();
  }

  async _init() {
    const code = await (await fetch(new URL('./engine/engine.js', import.meta.url))).text();
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.style.display = 'none';
    this.frame.title = 'engine-sandbox';
    const readyP = new Promise((res) => { this._onReady = res; });
    window.addEventListener('message', (e) => {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      const m = e.data || {};
      if (!m.__lbs) return;
      if (m.ready) { this._onReady(); return; }
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      m.ok ? w.res(m.data) : w.rej(new Error(m.data));
    });
    this.frame.srcdoc = BOOT;
    document.body.appendChild(this.frame);
    await readyP;
    const info = await this._send('load', null, code);
    this.builtins = info.builtins;
    this.hooks = info.hooks;
  }

  _send(cmd, args, code) {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.frame.contentWindow.postMessage({ __lbs: 1, id, cmd, args, code }, '*');
    });
  }

  async call(cmd, args) {
    await this.ready;
    return this._send(cmd, args);
  }
}

export const sandbox = new EngineSandbox();
