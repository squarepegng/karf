// Versions and shipping: group edits into versions, show the screen as it was
// before a version, restore, and send everything to GitHub as one pull request.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KerfError } from './edit.mjs';

export function createSession(webRoot, editor) {
  const versions = []; // { n, at, from, to } — indices into editor.history
  let peek = null; // { n, current: Map(file → content) }

  const end = () => (versions.length ? versions[versions.length - 1].to : 0);
  const entries = (from, to) => editor.history.slice(from, to);
  const describe = (h) => {
    const s = h.summary, parts = [];
    if (s.removed.length || s.added.length) parts.push(`${s.removed.join(' ') || '—'} → ${s.added.join(' ')}`);
    if (s.text) parts.push(`“${s.text.to}”`);
    (s.props || []).forEach((p) => parts.push(`${p.name}: ${p.from ?? 'default'} → ${p.to}`));
    return { file: h.rel, loc: h.loc, label: parts.join(' · '), source: h.source || 'hand' };
  };

  function snapshot() {
    if (editor.history.length > end()) versions.push({ n: versions.length + 1, at: Date.now(), from: end(), to: editor.history.length });
    return list();
  }
  function list() {
    return {
      versions: versions.map((v) => ({ n: v.n, at: v.at, changes: entries(v.from, v.to).map(describe) })),
      draft: entries(end(), editor.history.length).map(describe),
      peeking: peek ? peek.n : null,
    };
  }
  // Undo every edit after version n (n = 0 means back to the start).
  function restore(n) {
    if (peek) unpeekNow();
    const target = n === 0 ? 0 : versions.find((v) => v.n === n)?.to;
    if (target == null) throw new KerfError('That version no longer exists.');
    while (editor.history.length > target) editor.undo();
    while (versions.length && versions[versions.length - 1].to > target) versions.pop();
    return list();
  }
  // Show the files as they were before version n, without losing anything.
  function peekBefore(n) {
    if (peek) unpeekNow();
    const v = versions.find((x) => x.n === n);
    if (!v) throw new KerfError('That version no longer exists.');
    const before = new Map();
    for (const h of entries(v.from, editor.history.length)) if (!before.has(h.file)) before.set(h.file, h.before);
    const current = new Map();
    for (const [f, content] of before) { current.set(f, fs.readFileSync(f, 'utf8')); fs.writeFileSync(f, content); }
    peek = { n, current };
    return list();
  }
  function unpeekNow() {
    if (!peek) return;
    for (const [f, content] of peek.current) fs.writeFileSync(f, content);
    peek = null;
  }

  /* ---------- git ---------- */
  function git(args, cwd, opts = {}) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });
    if (r.error) throw new KerfError('Git isn’t available on this computer.');
    if (r.status !== 0) throw new KerfError((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n').slice(-2).join(' '));
    return r.stdout.trim();
  }
  const hasGh = () => spawnSync('gh', ['--version'], { encoding: 'utf8' }).status === 0;
  function repoInfo() {
    let root, branch, remote = '';
    try { root = git(['rev-parse', '--show-toplevel'], webRoot); } catch { return { git: false }; }
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    try { remote = git(['remote', 'get-url', 'origin'], root); } catch {}
    const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
    const files = [...new Set(editor.history.map((h) => path.relative(root, h.file)))];
    // Porcelain lines start with a status column that can be a space, so don't trim them.
    const st = spawnSync('git', ['status', '--porcelain', '--', ...(files.length ? files : ['.'])], { cwd: root, encoding: 'utf8' }).stdout || '';
    const dirty = st.split('\n').filter((l) => l.length > 3).map((l) => l.slice(3));
    return { git: true, root, branch, remote, repo: m ? `${m[1]}/${m[2]}` : null, files: files.filter((f) => dirty.includes(f)), gh: hasGh() };
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design-updates';
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

  // Commit Kerf's edits on a kerf/ branch, push it, and open (or update) the pull request.
  function pullRequest({ title, body, dryRun }) {
    if (peek) throw new KerfError('Close the before view first.');
    snapshot();
    const info = repoInfo();
    if (!info.git) throw new KerfError('This project isn’t a Git repository, so there’s nothing to open a pull request on.');
    if (!info.files.length) throw new KerfError('There are no changes to send yet.');
    if (!info.remote) throw new KerfError('This project has no GitHub remote to push to.');
    title = String(title || 'Design updates from Kerf').trim();
    const branch = info.branch.startsWith('kerf/') ? info.branch : `kerf/${slug(title)}-${stamp()}`;
    const plan = { branch, base: info.branch.startsWith('kerf/') ? null : info.branch, files: info.files, title };
    if (dryRun) return { dryRun: true, ...plan };
    const id = [];
    try { git(['config', 'user.email'], info.root); } catch {
      // No git identity in this copy: use the GitHub account's noreply address if gh knows it.
      const u = hasGh() ? spawnSync('gh', ['api', 'user', '--jq', '.login + " " + (.id|tostring)'], { encoding: 'utf8' }).stdout.trim().split(' ') : [];
      id.push('-c', `user.name=${u[0] || 'Kerf'}`, '-c', `user.email=${u[1] ? `${u[1]}+${u[0]}` : 'kerf'}@users.noreply.github.com`);
    }
    if (branch !== info.branch) git(['checkout', '-b', branch], info.root);
    git(['add', '--', ...info.files], info.root);
    git([...id, 'commit', '-m', title, '-m', String(body || '')], info.root);
    git(['push', '-u', 'origin', branch], info.root);
    let url = null, updated = false, viaGh = false;
    if (info.gh) {
      const view = spawnSync('gh', ['pr', 'view', branch, '--json', 'url', '-q', '.url'], { cwd: info.root, encoding: 'utf8' });
      if (view.status === 0 && view.stdout.trim()) { url = view.stdout.trim(); updated = true; viaGh = true; }
      else {
        const made = spawnSync('gh', ['pr', 'create', '--head', branch, '--title', title, '--body', String(body || '')], { cwd: info.root, encoding: 'utf8' });
        if (made.status === 0) { url = made.stdout.trim().split('\n').pop(); viaGh = true; }
      }
    }
    if (!url && info.repo) url = `https://github.com/${info.repo}/compare/${encodeURIComponent(branch)}?expand=1`;
    return { ...plan, url, updated, needsGitHubStep: !viaGh };
  }

  return { snapshot, list, restore, peekBefore, unpeek: () => { unpeekNow(); return list(); }, isPeeking: () => !!peek, repoInfo, pullRequest };
}
