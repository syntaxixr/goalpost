'use strict';

function levenshtein(a, b, options = {}) {
  if (options.ignoreCase) { a = a.toLowerCase(); b = b.toLowerCase(); }
  const max = options.maxDistance;
  if (!a.length) return max !== undefined && b.length > max ? max + 1 : b.length;
  if (!b.length) return max !== undefined && a.length > max ? max + 1 : a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (max !== undefined && rowMin > max) return max + 1;
  }
  const d = prev[b.length];
  return max !== undefined && d > max ? max + 1 : d;
}

module.exports = { levenshtein };
