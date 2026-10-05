import fs from 'fs';
import path from 'path';

const root = process.cwd();
const skipDirs = new Set(['node_modules', '.git', 'ios', 'android', 'dist', '.expo', 'scripts']);

function existsModule(p) {
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.json'];
  for (const e of exts) {
    const cand = p + e;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return true;
  }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    for (const idx of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
      if (fs.existsSync(path.join(p, idx))) return true;
    }
  }
  return false;
}

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(name.name) || name.name.startsWith('.')) continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(name.name)) acc.push(p);
  }
  return acc;
}

const files = walk(root);
const missing = [];
const dupImports = [];
const rx = /(?:from\s+|import\(\s*|require\(\s*)['"](@\/[^'"]+)['"]/g;

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const importBlocks = text.match(/import\s*\{[\s\S]*?\}\s*from/g) || [];
  for (const block of importBlocks) {
    const names = [...block.matchAll(/(?:type\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?/g)]
      .map((x) => x[1])
      .filter((n) => !['import', 'from', 'type', 'typeof', 'as'].includes(n));
    const seen = new Map();
    for (const n of names) seen.set(n, (seen.get(n) || 0) + 1);
    for (const [n, c] of seen) {
      if (c > 1) dupImports.push(`${path.relative(root, f)}: ${n} x${c}`);
    }
  }
  let match;
  while ((match = rx.exec(text))) {
    const spec = match[1];
    const target = path.join(root, spec.slice(2));
    if (!existsModule(target)) missing.push(`${path.relative(root, f)} -> ${spec}`);
  }
}

console.log('--- missing @/ modules ---');
console.log(missing.length ? missing.join('\n') : 'none');
console.log('--- duplicate named imports ---');
console.log(dupImports.length ? [...new Set(dupImports)].join('\n') : 'none');
if (missing.length) process.exitCode = 1;
