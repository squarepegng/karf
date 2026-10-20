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

const TW_CONFIGS = ['tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs', 'tailwind.config.ts', 'tailwind.config.mts', 'tailwind.config.cts'];
const major = (v) => { const m = String(v || '').match(/(\d+)/); return m ? +m[1] : null; };
function installedMajor(dir, name) {
  for (let d = dir; d; d = path.dirname(d) === d ? null : path.dirname(d)) {
    const v = readJson(path.join(d, 'node_modules', name, 'package.json'))?.version;
    if (v) return major(v);
  }
  return null;
}

// Can Kerf open this app? Returns null if yes, or a plain reason why not.
export function appProblem(dir) {
  const d = deps(readJson(path.join(dir, 'package.json')));
  const tw = TW_CONFIGS.find((f) => fs.existsSync(path.join(dir, f)));
  if (!d.react) return 'Kerf works with React apps, and this one doesn’t use React.';
  if (d['react-scripts']) return 'This app uses Create React App. Kerf supports apps built with Vite or Next.js.';
  if (Object.keys(d).some((k) => k.startsWith('@remix-run/'))) return 'This is a Remix app. Kerf supports apps built with Vite or Next.js; Remix is not supported yet.';
  if (d.astro) return 'This is an Astro site. Kerf supports React apps built with Vite or Next.js.';
  if (d.gatsby) return 'This is a Gatsby site. Kerf supports apps built with Vite or Next.js.';
  if (!d.next && !d.vite) return 'Kerf supports apps built with Vite or Next.js, and couldn’t tell how this one is built.';
  if (d.next && (installedMajor(dir, 'next') ?? major(d.next)) < 13) return 'This app uses Next.js 12 or older. Kerf needs Next.js 13 or newer.';
  if (!d.tailwindcss && !tw) return 'This app isn’t styled with Tailwind CSS, which Kerf uses to change styles.';
  if ((installedMajor(dir, 'tailwindcss') ?? major(d.tailwindcss)) >= 4) return 'This app uses Tailwind CSS v4. Kerf works with Tailwind v3 today; v4 support is coming.';
  if (!tw) return 'Kerf couldn’t find this app’s tailwind.config file.';
  return null;
}

// Find folders that hold a React web app, up to three levels deep, with whether Kerf can open each.
export function findApps(repoRoot) {
  const found = [];
  const visit = (dir, depth) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    const d = deps(pkg);
    if (pkg && d.react) {
      found.push({
        dir,
        rel: path.relative(repoRoot, dir) || '.',
        name: pkg.name || path.basename(dir),
        framework: d.next ? 'next' : d.vite ? 'vite' : 'other',
        tailwindConfig: TW_CONFIGS.find((f) => fs.existsSync(path.join(dir, f))) || null,
        problem: appProblem(dir),
      });
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
    job.apps = apps.map((a) => ({ rel: a.rel, name: a.name, framework: a.framework, problem: a.problem }));
    if (!apps.length) throw new Error('Kerf didn’t find a React app in this project. It works with React apps built with Vite or Next.js and styled with Tailwind CSS.');
    const app = apps.find((a) => !a.problem);
    if (!app) {
      const a = apps[0];
      throw new Error(apps.length === 1 || a.rel === '.' ? a.problem : `${a.problem} (in ${a.rel})`);
    }
    log(`Found ${app.name} in ${app.rel} (${app.framework === 'next' ? 'Next.js' : 'Vite'})\n`);

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
          if (m) { const url = (m[1].endsWith('/') ? m[1] : m[1] + '/') + '__kerf/'; clearTimeout(t); projects.set(job.id, { proc, url, repoRoot, app: app.rel }); resolve(url); }
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
