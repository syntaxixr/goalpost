'use strict';

const IRREGULAR = { person: 'people', child: 'children', mouse: 'mice', man: 'men', woman: 'women', tooth: 'teeth', foot: 'feet' };

function plural(lower) {
  if (IRREGULAR[lower]) return IRREGULAR[lower];
  if (/[^aeiou]y$/.test(lower)) return lower.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(lower)) return lower + 'es';
  return lower + 's';
}

function pluralize(word, count = 2) {
  if (count === 1 || count === -1) return word;
  const p = plural(word.toLowerCase());
  return word[0] && word[0] !== word[0].toLowerCase() ? p[0].toUpperCase() + p.slice(1) : p;
}

module.exports = { pluralize };
