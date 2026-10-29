'use strict';
// Just enough semantic versioning for Satisfactory mods (ficsit.app): versions like 3.10.0 or
// 1.2.0-beta.1, and ranges like ^3.7.0, ~1.2, >=1.0.0 <2.0.0, 1.x, *, 1.0.0 - 2.0.0 and a || b.
// Game builds are plain numbers (">=365306"), which read as 365306.0.0.

function parse(v) {
  const m = /^\s*[=v]*\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(String(v ?? ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2] || 0), patch: Number(m[3] || 0), pre: m[4] ? m[4].split('.') : [] };
}

function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1; // a release is newer than its prereleases
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn && Number(a[i]) !== Number(b[i])) return Number(a[i]) < Number(b[i]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function compare(a, b) {
  const x = typeof a === 'string' ? parse(a) : a;
  const y = typeof b === 'string' ? parse(b) : b;
  if (!x || !y) return 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

// One "x-range" (1, 1.2, 1.x, *) as how many of its parts were given.
function partial(text) {
  const parts = String(text).replace(/^[=v]+/, '').split('-')[0].split('.');
  const given = parts.findIndex((p) => p === '' || /^[xX*]$/.test(p));
  const n = given === -1 ? Math.min(parts.length, 3) : given;
  const v = parse(String(text).replace(/(\.|^)[xX*]/g, '$10').replace(/^[xX*]$/, '0'));
  return { v: v || { major: 0, minor: 0, patch: 0, pre: [] }, n };
}

const bump = (v, part) =>
  part === 'major' ? { major: v.major + 1, minor: 0, patch: 0, pre: ['0'] } : part === 'minor' ? { major: v.major, minor: v.minor + 1, patch: 0, pre: ['0'] } : { major: v.major, minor: v.minor, patch: v.patch + 1, pre: ['0'] };

// A comparator set (space-separated, all must hold) as [[op, version], ...].
function comparators(set) {
  const out = [];
  const text = set.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  if (hyphen) {
    const lo = partial(hyphen[1]);
    const hi = partial(hyphen[2]);
    out.push(['>=', lo.v]);
    if (hi.n === 3) out.push(['<=', hi.v]);
    else if (hi.n > 0) out.push(['<', bump(hi.v, hi.n === 1 ? 'major' : 'minor')]);
    return out;
  }
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(tok);
    const op = m[1] || '';
    const { v, n } = partial(m[2] || '*');
    if (op === '^') {
      out.push(['>=', v]);
      if (v.major > 0 || n < 2) out.push(['<', bump(v, 'major')]);
      else if (v.minor > 0 || n < 3) out.push(['<', bump(v, 'minor')]);
      else out.push(['<', bump(v, 'patch')]);
    } else if (op === '~') {
      out.push(['>=', v]);
      out.push(['<', bump(v, n < 2 ? 'major' : 'minor')]);
    } else if (op === '' || op === '=') {
      if (n === 0) continue; // *
      if (n === 3) out.push(['=', v]);
      else {
        out.push(['>=', v]);
        out.push(['<', bump(v, n === 1 ? 'major' : 'minor')]);
      }
    } else if (n === 0) {
      if (op === '<' || op === '>') out.push(['<', { major: 0, minor: 0, patch: 0, pre: ['0'] }]); // matches nothing
    } else {
      // Partial bounds: >1.2 means >=1.3.0, <=1.2 means <1.3.0.
      if (n < 3 && (op === '>' || op === '<=')) out.push([op === '>' ? '>=' : '<', bump(v, n === 1 ? 'major' : 'minor')]);
      else out.push([op, v]);
    }
  }
  return out;
}

function test(op, v, bound) {
  const c = compare(v, bound);
  return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
}

function satisfies(version, range) {
  const v = typeof version === 'string' ? parse(version) : version;
  if (!v) return false;
  const r = String(range ?? '').trim();
  if (!r || r === '*') return !v.pre.length;
  return r.split('||').some((set) => {
    const comps = comparators(set);
    if (!comps.every(([op, b]) => test(op, v, b))) return false;
    // Prereleases only match a range that names a prerelease of the same version.
    if (!v.pre.length) return true;
    return comps.some(([, b]) => b.pre.length && b.pre[0] !== '0' && b.major === v.major && b.minor === v.minor && b.patch === v.patch);
  });
}

module.exports = { parse, compare, satisfies };
