# Open issues

## #1 wordWrap: long words overflow and paragraphs get merged

`wordWrap('see https://example.com/a/very/long/path ok', 10)` returns a line longer than 10,
and when the first word is too long the output starts with an empty line. Text with blank lines
between paragraphs comes back as one paragraph.

Expected:
- No output line is longer than `width`. A word longer than `width` is cut into pieces of exactly
  `width` characters (the last piece may be shorter) and the pieces go on their own lines.
- No empty line at the start or the end.
- Paragraphs separated by a blank line (`\n\n`, possibly with spaces on the blank line) are wrapped
  separately and stay separated by exactly one blank line. Single newlines inside a paragraph are
  treated as spaces.

## #2 truncate: result is longer than `max`, and emoji get cut in half

`truncate('hello world', 8)` returns `'hello wo…'` (9 characters). `truncate('👍👍👍', 2)` returns
broken surrogate pairs.

Expected:
- Length is counted in Unicode code points (`Array.from(str).length`), not UTF-16 units.
- If `str` fits in `max`, it is returned unchanged.
- Otherwise the result **including** the ellipsis is at most `max` code points, and whitespace right
  before the ellipsis is removed: `truncate('hello world', 7)` → `'hello…'`.
- `ellipsis` can be any string, e.g. `truncate('abcdef', 5, '...')` → `'ab...'`.

## #3 parseCSVLine breaks on quoted commas and escaped quotes

`parseCSVLine('a,"b,c",d')` returns 4 fields.

Expected:
- Fields wrapped in double quotes may contain commas, and `""` inside them stands for one `"`:
  `parseCSVLine('1,"say ""hi""",x')` → `['1', 'say "hi"', 'x']`.
- Empty fields are kept: `parseCSVLine('a,,b,')` → `['a', '', 'b', '']`.
- Also add `parseCSV(text)`: splits a whole document into rows (arrays of fields). Rows end with
  `\n` or `\r\n`; a quoted field may contain line breaks; a trailing newline does not create an
  empty row. Export it from `src/index.js`.

## #4 formatTable crashes or prints "undefined" for ragged rows

`formatTable([['a', 'b', 'c'], ['d']])` prints `undefined`, and a later row with more cells than
the first one loses its extra cells.

Expected: the number of columns is the longest row; missing cells are treated as empty strings.

## #5 formatTable: right-align numbers and an optional header separator

Feature request:
- A column whose non-empty cells are all numbers (`typeof === 'number'` or a numeric string such as
  `'12.5'` or `'-3'`) is right-aligned. With `{ header: true }` the first row is ignored when
  deciding whether a column is numeric, and the header cell is right-aligned too in that column.
- `{ header: true }` adds a separator line after the first row: for each column `'-'` repeated to the
  column width, joined with `'-|-'`.
- No trailing spaces at the end of any line.

## #6 pluralize: "day" becomes "daies", irregular nouns are wrong

Expected:
- `y` after a vowel just adds `s` (`day` → `days`); after a consonant `y` → `ies` (`city` → `cities`).
- Words ending in `s`, `x`, `z`, `ch`, `sh` add `es` (`box` → `boxes`, `church` → `churches`).
- Irregular: person→people, child→children, mouse→mice, man→men, woman→women, tooth→teeth, foot→feet.
- A capitalised word keeps its capital: `Person` → `People`, `City` → `Cities`.
- Singular only for `count` 1 and -1; `0` items are plural.

## #7 render: no HTML escaping, "undefined" for missing keys

`render('<p>{{name}}</p>', { name: '<script>' })` injects raw HTML (security), and missing keys
render as the text `undefined`.

Expected:
- `{{key}}` HTML-escapes `& < > " '` (as `&amp; &lt; &gt; &quot; &#39;`).
- `{{{key}}}` inserts the value without escaping.
- Dotted paths: `{{user.name}}`.
- Defaults: `{{name|anonymous}}` uses `anonymous` when the value is missing, `null` or `''`.
- Missing values without a default render as an empty string.
- Spaces inside the braces are allowed: `{{ user.name }}`.

## #8 levenshtein returns 0 when one string is empty; add options

Expected:
- `levenshtein('', 'abc')` → 3, `levenshtein('abc', '')` → 3, `levenshtein('', '')` → 0.
- Third argument `options`:
  - `ignoreCase: true` compares case-insensitively.
  - `maxDistance: n`: when the real distance is greater than `n`, return `n + 1`
    (the implementation may stop early). When it is `<= n`, return the real distance.
