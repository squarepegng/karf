// Open a project from a GitHub link or a folder: fetch it, find the web app
// inside, install it, and start it with Kerf attached.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROJECTS_DIR = path.join(os.homedir(), 'Kerf', 'projects');
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../bin/kerf.mjs');

// "https://github.com/acme/web", "github.com/acme/web.git", "acme/web" → { owner, repo }
export function parseGitHub(input) {
  const s = String(input).trim();
  if (/^[/~.]/.test(s)) return null; // a folder path
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function run(cmd, args, cwd, log) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, CI: '1' } });
    const out = (d) => log(String(d));
    p.stdout.on('data', out);
    p.stderr.on('data', out);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} failed (exit ${code})`))));
  });
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const deps = (pkg) => ({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) });

// Find folders that hold a React + Tailwind web app, up to three levels deep.
export function findApps(repoRoot) {
  const found = [];
  const visit = (dir, depth) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (pkg) {
      const d = deps(pkg);
      const tw = ['tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs', 'tailwind.config.ts'].find((f) => fs.existsSync(path.join(dir, f)));
      if (d.react && (tw || d.tailwindcss)) {
        found.push({
          dir,
          rel: path.relative(repoRoot, dir) || '.',
          name: pkg.name || path.basename(dir),
          framework: d.next ? 'next' : d.vite ? 'vite' : 'other',
          tailwindConfig: tw || null,
        });
      }
    }
    if (depth >= 3) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'dist', 'build', 'out'].includes(e.name)) visit(path.join(dir, e.name), depth + 1);
    }
  };
  visit(repoRoot, 0);
  return found;
}

// Which package manager the repo uses, and how to run it without installing anything globally.
export function packageManager(repoRoot) {
  const pkg = readJson(path.join(repoRoot, 'package.json'));
  const pinned = pkg?.packageManager?.match(/^(pnpm|yarn|npm)@(.+)$/);
  if (fs.existsSync(path.join(repoRoot, 'pnpm-lock.yaml')) || pinned?.[1] === 'pnpm') return { name: 'pnpm', cmd: 'npx', args: ['-y', `pnpm@${pinned?.[1] === 'pnpm' ? pinned[2] : 'latest'}`, 'install'] };
  if (fs.existsSync(path.join(repoRoot, 'yarn.lock'))) return { name: 'yarn', cmd: 'npx', args: ['-y', 'yarn', 'install'] };
  return { name: 'npm', cmd: 'npm', args: [fs.existsSync(path.join(repoRoot, 'package-lock.json')) ? 'ci' : 'install'] };
}

// Opened projects, keyed by id. Each keeps its own dev server.
export const projects = new Map();

export async function openProject(source, onUpdate = () => {}) {
  const job = { id: null, source, step: 'Starting', log: '', url: null, error: null, apps: [] };
  const log = (s) => { job.log = (job.log + s).slice(-6000); onUpdate(job); };
  const step = (s) => { job.step = s; log(`\n› ${s}\n`); };
  try {
    let repoRoot;
    const gh = parseGitHub(source);
    if (gh) {
      job.id = `${gh.owner}-${gh.repo}`.toLowerCase();
      repoRoot = path.join(PROJECTS_DIR, job.id);
      fs.mkdirSync(PROJECTS_DIR, { recursive: true });
      if (fs.existsSync(path.join(repoRoot, '.git'))) step(`Using your copy of ${gh.owner}/${gh.repo}`);
      else {
        step(`Downloading ${gh.owner}/${gh.repo} from GitHub`);
        await run('git', ['clone', '--depth', '50', `https://github.com/${gh.owner}/${gh.repo}.git`, repoRoot], PROJECTS_DIR, log);
      }
    } else {
      repoRoot = path.resolve(source.replace(/^~(?=$|\/)/, os.homedir()));
      if (!fs.existsSync(path.join(repoRoot, 'package.json')) && !fs.existsSync(repoRoot)) throw new Error('That isn’t a GitHub link or a folder on this computer.');
      job.id = path.basename(repoRoot).toLowerCase();
      step(`Using the folder ${repoRoot}`);
    }
    job.repoRoot = repoRoot;

    step('Looking for a React + Tailwind app');
    const apps = findApps(repoRoot);
    job.apps = apps.map((a) => ({ rel: a.rel, name: a.name, framework: a.framework }));
    if (!apps.length) throw new Error('No React + Tailwind app found in this project. Kerf v1 works with React apps styled with Tailwind.');
    const app = apps.find((a) => a.framework === 'vite');
    if (!app) throw new Error(apps.some((a) => a.framework === 'next') ? 'This is a Next.js app. Kerf supports Vite apps today; Next.js support is next on the roadmap.' : 'Kerf supports apps built with Vite today.');
    if (!app.tailwindConfig || app.tailwindConfig.endsWith('.ts')) throw new Error(`Found ${app.rel}, but it has no tailwind.config.js Kerf can read yet.`);
    log(`Found ${app.name} in ${app.rel}\n`);

    const pm = packageManager(repoRoot);
    if (!fs.existsSync(path.join(repoRoot, 'node_modules'))) {
      step(`Installing with ${pm.name} (first time only, this can take a minute)`);
      await run(pm.cmd, pm.args, repoRoot, log);
    }

    step('Starting the app with Kerf');
    const prev = projects.get(job.id);
    if (prev?.proc && prev.proc.exitCode === null) {
      job.url = prev.url;
    } else {
      job.url = await new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [RUNNER, app.dir], { env: process.env });
        let buf = '';
        const t = setTimeout(() => reject(new Error('The app didn’t start within 2 minutes.')), 120000);
        const on = (d) => {
          buf += d;
          log(String(d));
          const m = buf.match(/Local:\s+(http:\/\/localhost:\d+\/?)/);
          if (m) { clearTimeout(t); projects.set(job.id, { proc, url: m[1], repoRoot, app: app.rel }); resolve(m[1]); }
        };
        proc.stdout.on('data', on);
        proc.stderr.on('data', on);
        proc.on('close', (code) => { clearTimeout(t); reject(new Error(`The app stopped (exit ${code}). See the log.`)); });
      });
    }
    step('Ready');
  } catch (e) {
    job.error = e.message;
    log(`\n${e.message}\n`);
  }
  onUpdate(job);
  return job;
}

export function stopAll() {
  for (const p of projects.values()) p.proc?.kill();
}
