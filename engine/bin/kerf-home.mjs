#!/usr/bin/env node
// Kerf's start screen: paste a GitHub link or a folder, and Kerf opens the app
// with the editor attached.   node bin/kerf-home.mjs   →  http://localhost:4100
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProject, PROJECTS_DIR, projects, stopAll } from '../src/project.mjs';

const ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env');

const PORT = Number(process.env.KERF_PORT || 4100);
// Each key has its own line in .env; saving one never touches the others.
function setEnv(name, value) {
  const lines = (fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '').split('\n').filter((l) => l && !l.startsWith(name + '='));
  lines.push(`${name}=${value}`);
  fs.writeFileSync(ENV, lines.join('\n') + '\n');
  fs.chmodSync(ENV, 0o600);
}
let job = null;

function recent() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = path.join(PROJECTS_DIR, e.name);
      let remote = '';
      try { remote = fs.readFileSync(path.join(dir, '.git/config'), 'utf8').match(/url = (.+)/)?.[1] || ''; } catch {}
      const running = projects.get(e.name);
      return { id: e.name, source: remote.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') || dir, url: running?.proc?.exitCode === null ? running.url : null, at: fs.statSync(dir).mtimeMs };
    })
    .sort((a, b) => b.at - a.at);
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
  if (req.method === 'GET' && req.url === '/api/job') return send(res, 200, job && { ...job, repoRoot: undefined });
  if (req.method === 'GET' && req.url === '/api/key-status') {
    const env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
    return send(res, 200, { set: /^ANTHROPIC_API_KEY=sk-ant-\S+/m.test(env), unsplash: /^UNSPLASH_ACCESS_KEY=\S+/m.test(env) });
  }
  if (req.method === 'POST' && req.url === '/api/unsplash-key') {
    let body = '';
    for await (const c of req) body += c;
    const key = String(JSON.parse(body || '{}').key || '').trim();
    if (!/^[A-Za-z0-9_-]{30,}$/.test(key)) return send(res, 400, { error: 'That does not look like an Unsplash Access Key. Copy the “Access Key” from your Unsplash app page.' });
    setEnv('UNSPLASH_ACCESS_KEY', key);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && req.url === '/api/key') {
    let body = '';
    for await (const c of req) body += c;
    const key = String(JSON.parse(body || '{}').key || '').trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return send(res, 400, { error: 'That does not look like an Anthropic key. It starts with sk-ant-.' });
    setEnv('ANTHROPIC_API_KEY', key);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && req.url === '/api/recent') return send(res, 200, recent());
  if (req.method === 'POST' && req.url === '/api/open') {
    let body = '';
    for await (const c of req) body += c;
    const { source } = JSON.parse(body || '{}');
    if (!source || !String(source).trim()) return send(res, 400, { error: 'Paste a GitHub link or a folder path.' });
    if (job && !job.url && !job.error) return send(res, 409, { error: 'Kerf is already opening a project.' });
    job = { source, step: 'Starting', log: '' };
    openProject(String(source).trim(), (j) => (job = j));
    return send(res, 202, { ok: true });
  }
  send(res, 404, { error: 'Not found' });
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`Kerf is already running at http://localhost:${PORT} (or another app is using port ${PORT}).`);
  console.log(`To use a different port: KERF_PORT=4200 node bin/kerf-home.mjs`);
  process.exit(1);
}).listen(PORT, () => console.log(`Kerf is ready: http://localhost:${PORT}`));

process.on('SIGINT', () => { stopAll(); process.exit(0); });
process.on('SIGTERM', () => { stopAll(); process.exit(0); });

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kerf</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono&display=swap">
<style>
:root{--canvas:#1B1B1E;--panel:#232327;--raised:#2D2D32;--line:#3A3A40;--ink:#EDEDF0;--ink2:#B0B0BA;--ink3:#8B8B95;--select:#2B66D9;--intent:#E9B547;--danger:#F06A5F;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--canvas);color:var(--ink);font:400 13px/18px Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:560px;margin:0 auto;padding:12vh 16px 48px;display:flex;flex-direction:column;gap:28px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px}
h1{margin:0;font-size:28px;line-height:34px;font-weight:600;letter-spacing:-.02em}
p{margin:6px 0 0;color:var(--ink2)}
form{display:flex;gap:8px}
input{flex:1;min-width:0;height:40px;padding:0 12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;color:var(--ink);font:inherit;outline:none}
input:focus{border-color:var(--select)}
button{height:40px;padding:0 16px;border:0;border-radius:8px;background:var(--select);color:#fff;font:500 13px Geist,system-ui,sans-serif;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.hint{color:var(--ink3);font-size:12px}
.card{display:flex;flex-direction:column;gap:12px;padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:12px}
.status{display:flex;align-items:center;gap:10px;font-weight:500}
.spin{width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--ink);border-radius:50%;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
.err{color:var(--danger)}
pre{margin:0;max-height:180px;overflow:auto;padding:10px;background:var(--canvas);border-radius:8px;color:var(--ink3);font:400 11px/16px 'Geist Mono',ui-monospace,monospace;white-space:pre-wrap}
.recent{display:flex;flex-direction:column;gap:2px}
.recent h2{margin:0 0 6px;font-size:12px;font-weight:500;color:var(--ink3)}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;background:transparent;border:0;color:var(--ink);text-align:left;height:auto;font:inherit}
.row:hover{background:var(--panel)}
.row span:last-child{color:var(--ink3);font-size:12px}
a.open{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border-radius:8px;background:var(--ink);color:var(--canvas);text-decoration:none;font-weight:500;align-self:flex-start}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
details.logs summary{cursor:pointer;color:#8B8B95;font-size:12px;margin-top:10px}details.logs pre{margin-top:8px}</style></head>
<body><main>
<div class="brand"><svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="5.5" height="10" rx="1.5" fill="#EDEDF0"/><rect x="8.5" y="3" width="5.5" height="10" rx="1.5" fill="#EDEDF0" opacity=".45"/></svg>Kerf</div>
<div><h1>Open a project</h1><p>Paste a GitHub link or a folder on this computer. Kerf runs your app and opens it with the editor on top. Your code only changes when you edit.</p></div>
<form id="f"><input id="src" placeholder="github.com/team/app  or  ~/code/app" autocomplete="off" spellcheck="false" aria-label="GitHub link or folder"><button id="go">Open</button></form>
<span class="hint">Works with React apps built with Vite or Next.js and styled with Tailwind CSS v3. Private repos use your existing GitHub sign-in on this Mac.</span>
<div class="card" id="keycard"><div class="status" id="keystat"></div><span class="hint">For the AI step. It is saved only on this Mac, in a git-ignored file.</span><form id="kf" style="display:flex;gap:8px"><input id="kin" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" aria-label="Anthropic API key"><button id="ksave">Save key</button></form><span class="err" id="kerr"></span></div>
<div class="card" id="ucard"><div class="status" id="ustat"></div><span class="hint">Optional, for finding real photos from Unsplash (free). Create an app at <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noopener">unsplash.com/developers</a> and paste its Access Key.</span><form id="uf" style="display:flex;gap:8px"><input id="uin" type="password" placeholder="Unsplash Access Key" autocomplete="off" spellcheck="false" aria-label="Unsplash Access Key"><button id="usave">Save key</button></form><span class="err" id="uerr"></span></div>
<div id="job"></div>
<div class="recent" id="recent"></div>
</main>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
let polling=null,started=false;
async function open(source){
  $('go').disabled=true;started=true;
  const r=await fetch('/api/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})});
  if(!r.ok){const j=await r.json();$('job').innerHTML='<div class="card"><span class="err">'+esc(j.error)+'</span></div>';$('go').disabled=false;return}
  poll();
}
async function poll(){
  clearTimeout(polling);
  const j=await (await fetch('/api/job')).json();
  if(!j){return}
  const done=j.url||j.error;
  $('job').innerHTML='<div class="card"><div class="status">'+(j.error?'<span class="err">'+esc(j.error)+'</span>':j.url?'Ready':'<span class="spin"></span>'+esc(j.step))+'</div>'+
    (j.url?'<a class="open" href="'+esc(j.url)+'">Open in Kerf →</a>':'')+'<details class="logs"'+(j.error||window.__logsOpen?' open':'')+'><summary>Technical details</summary><pre id="log">'+esc(j.log.trim())+'</pre></details></div>';
  const dd=document.querySelector('#job details');if(dd)dd.ontoggle=()=>{window.__logsOpen=dd.open};
  const l=$('log');if(l)l.scrollTop=l.scrollHeight;
  if(j.url&&started){location.href=j.url;return}
  if(done){$('go').disabled=false;loadRecent();return}
  polling=setTimeout(poll,700);
}
async function loadRecent(){
  const list=await (await fetch('/api/recent')).json();
  $('recent').innerHTML=list.length?'<h2>Recent</h2>'+list.map(p=>'<button class="row" data-src="'+esc(p.source)+'"><span>'+esc(p.source)+'</span><span>'+(p.url?'Running':'Open')+'</span></button>').join(''):'';
}
$('f').addEventListener('submit',e=>{e.preventDefault();const v=$('src').value.trim();if(v)open(v)});
$('recent').addEventListener('click',e=>{const b=e.target.closest('[data-src]');if(b){$('src').value=b.dataset.src;open(b.dataset.src)}});
async function loadKey(){const s=await (await fetch('/api/key-status')).json();$('keystat').textContent=s.set?'Anthropic key saved on this Mac':'No Anthropic key yet';$('ustat').textContent=s.unsplash?'Unsplash key saved: photo search is on':'Photo search (Unsplash): no key yet';}
$('uf').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/unsplash-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:$('uin').value})});const j=await r.json();if(!r.ok){$('uerr').textContent=j.error;return}$('uin').value='';$('uerr').textContent='';loadKey()});
$('kf').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:$('kin').value})});const j=await r.json();if(!r.ok){$('kerr').textContent=j.error;return}$('kin').value='';$('kerr').textContent='';loadKey()});
loadKey();loadRecent();poll();
</script></body></html>`;
