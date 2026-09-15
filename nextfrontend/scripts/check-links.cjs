#!/usr/bin/env node
/* global process, console, __dirname */
/**
 * Fails when an internal link points at a page that does not exist.
 *
 * Checks every hard-coded internal target in href=..., router.push/replace(...), redirect(...) and
 * location.href = ... against the App Router pages under app/. In production Next.js prefetches visible
 * links, so a dead link shows up as a 404 in the browser console even if nobody clicks it.
 *
 * Usage: node scripts/check-links.cjs [path-to-nextfrontend]   (npm run check:links)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));

const walk = (dir) =>
    fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
        : [];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One pattern per page: [param] segments match any value, (group) folders are not part of the URL.
const routes = walk(path.join(root, 'app'))
    .filter((f) => /[\\/]page\.(tsx|jsx|ts|js)$/.test(f))
    .map((f) => {
        const segs = path
            .relative(path.join(root, 'app'), path.dirname(f))
            .split(path.sep)
            .filter((s) => s && !/^\(.*\)$/.test(s));
        const pattern = segs.map((s) => (/^\[.*\]$/.test(s) ? '[^/]+' : escapeRe(s))).join('/');
        return new RegExp(`^/${pattern}$`);
    });
const isPage = (target) => routes.some((re) => re.test(target));

const files = ['app', 'components', 'hooks', 'lib', 'context']
    .flatMap((d) => walk(path.join(root, d)))
    .filter((f) => /\.(tsx?|jsx?)$/.test(f));

const linkRe = /(?:href\s*[=:]\s*\{?\s*|router\.(?:push|replace)\(\s*|redirect\(\s*|location\.href\s*=\s*)[`'"](\/[^`'"?#\s]*)/g;
const dead = new Map();
let checked = 0;

for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(linkRe)) {
        // Template parameters stand for a single path segment.
        const target = match[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\/+$/, '') || '/';
        if (/^\/(api|_next|uploads|socket\.io)(\/|$)/.test(target)) continue; // served by the API, not pages
        checked += 1;
        if (isPage(target)) continue;
        const line = text.slice(0, match.index).split('\n').length;
        if (!dead.has(target)) dead.set(target, []);
        dead.get(target).push(`${path.relative(root, file)}:${line}`);
    }
}

console.log(`${routes.length} pages, ${checked} internal links checked in ${files.length} files`);
for (const [target, where] of dead) console.log(`dead link ${target}  <- ${where.join(', ')}`);
if (dead.size) {
    console.log(`\n${dead.size} link target(s) have no page`);
    process.exit(1);
}
console.log('no dead internal links');
