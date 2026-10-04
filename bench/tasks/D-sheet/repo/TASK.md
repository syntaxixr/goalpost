# minisheet — a spreadsheet formula engine

Build `minisheet`, a small spreadsheet engine library. Node.js 18+, **no npm dependencies**.
`src/sheet.js` exports a class `Sheet`. Tests go in `test/` and run with `npm test` (`node --test`).
`README.md` lists every supported function.

## API

- `sheet.set(ref, input)` — `input` is a string.
  - Starts with `=` → a formula.
  - Otherwise a literal: a number when it parses as one (`42`, `-3.5`, `1e3`, ` 7 `), `TRUE`/`FALSE`
    (any case) → boolean, anything else → text (kept as typed). `''` clears the cell.
- `sheet.get(ref)` — the current value: a number, a string, a boolean, `null` for an empty cell, or an
  error string (see Errors). Values always reflect the latest inputs: changing a cell updates every
  formula that depends on it, directly or indirectly.
- `sheet.getInput(ref)` — the raw input string (`''` for an empty cell).
- References are case-insensitive (`a1` = `A1`), columns `A`–`ZZ`, rows `1`–`9999`. `$` markers
  (`$A$1`, `A$1`) are allowed and ignored. An invalid reference passed to `set`/`get` throws an `Error`.

## Formulas

- Literals: numbers (`3`, `2.5`, `.5`, `1e2`), strings in double quotes with `""` as an escaped quote,
  `TRUE`, `FALSE` (any case).
- References `A1`, ranges `A1:B3` (any two corners), function calls `NAME(arg, ...)` with
  case-insensitive names, parentheses.
- Operators, from lowest to highest precedence:
  1. comparison `=  <>  <  >  <=  >=` (left-assoc)
  2. concatenation `&` (left-assoc)
  3. `+  -` (left-assoc)
  4. `*  /` (left-assoc)
  5. `^` (right-assoc: `2^3^2` = 512)
  6. unary `-` and `+` (so `-2^2` = 4, like common spreadsheets)
  7. postfix `%` (divides by 100: `50%` = 0.5)
- Whitespace between tokens is ignored.

### Values and coercion

- An empty cell is `0` in arithmetic and `""` in text operations.
- Arithmetic and numeric function arguments: booleans are 1/0, text that parses as a number is that
  number, other text → `#VALUE!`.
- `&` turns numbers into their plain JavaScript string (`1.5` → `"1.5"`), booleans into `TRUE`/`FALSE`.
- Comparisons: numbers compare numerically, text compares case-insensitively, booleans `FALSE < TRUE`;
  across types numbers < text < booleans. An empty cell compares as `0` with numbers and `""` with text.
- A formula whose result is a range (e.g. `=A1:A3`) gives `#VALUE!`. A formula that is just a reference to an
  empty cell (`=B7`) gives `0`.
- Results that are not finite numbers (e.g. `=SQRT(-1)` style results, overflow) give `#NUM!`.

### Errors

Errors are the strings `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`, `#NUM!`, `#CIRC!`, `#ERROR!`.
- Division by zero → `#DIV/0!`. Unknown function → `#NAME?`. A reference outside `A1:ZZ9999` inside a
  formula → `#REF!`. A formula that can't be parsed → `#ERROR!`.
- Every cell in a circular reference chain (including `=A1` in `A1`) evaluates to `#CIRC!`; cells that
  depend on a cycle but are not part of it get `#CIRC!` too. Breaking the cycle restores normal values.
- Errors propagate: any operator or function that receives an error argument returns the first error it
  meets (left to right), except functions that handle errors (`IFERROR`, `IFNA`, `ISERROR`, `ISNA`).

## Functions

In the descriptions, "numbers in the arguments" means: for a range or cell-reference argument (`A1:B3`,
`A1`), only cells holding numbers count (text, booleans and empty cells are skipped); a value written in
the formula or produced by an expression (`5`, `"3"`, `TRUE`, `A1*2`) is coerced as in arithmetic.
Wrong argument counts → `#VALUE!`.

### Math
- `SUM`, `PRODUCT`, `MIN`, `MAX`, `AVERAGE` over the numbers in the arguments. `MIN`/`MAX` of no numbers
  is 0; `AVERAGE` of no numbers is `#DIV/0!`.
- `COUNT` — how many numbers; `COUNTA` — how many non-empty values; `COUNTBLANK(range)` — empty cells.
- `ROUND(x, digits)`, `ROUNDUP(x, digits)`, `ROUNDDOWN(x, digits)` — half away from zero for `ROUND`;
  `ROUNDUP` away from zero, `ROUNDDOWN` toward zero; `digits` may be negative (`ROUND(1234, -2)` = 1200).
- `INT(x)` — round down (`INT(-1.5)` = -2). `MOD(a, b)` — result has the sign of `b`
  (`MOD(-7, 3)` = 2); `b` = 0 → `#DIV/0!`.
- `ABS(x)`, `SQRT(x)` (negative → `#NUM!`), `POWER(a, b)`.

### Logic
- `IF(cond, then, [else])` — `else` defaults to `FALSE`. Only the chosen branch is evaluated (an error in
  the other branch does not matter).
- `IFS(c1, v1, c2, v2, ...)` — first true condition; none → `#N/A`.
- `AND(...)`, `OR(...)`, `XOR(...)` over booleans/numbers (0 is false); text arguments → `#VALUE!`;
  ranges skip text and empty cells. `NOT(x)`.
- `IFERROR(x, alt)` — `alt` when `x` is any error. `IFNA(x, alt)` — only for `#N/A`.

### Text
- `LEN`, `UPPER`, `LOWER`, `TRIM` (removes leading/trailing spaces and collapses inner runs of spaces).
- `LEFT(text, [n=1])`, `RIGHT(text, [n=1])`, `MID(text, start, n)` (1-based); negative `n` → `#VALUE!`.
- `CONCAT(...)` — joins everything, ranges included (row by row).
- `TEXTJOIN(delimiter, ignore_empty, ...)`.
- `SUBSTITUTE(text, old, new, [instance])` — all occurrences, or only the `instance`-th one.
- `FIND(needle, haystack, [start=1])` — case-sensitive, 1-based; not found → `#VALUE!`.
  `SEARCH` — same but case-insensitive and supports wildcards `*` and `?`.
- `REPT(text, n)`, `EXACT(a, b)` (case-sensitive equality), `VALUE(text)` (text → number, else `#VALUE!`).

### Lookup
- `VLOOKUP(value, range, col, [approx=TRUE])` — `approx` FALSE: first exact match in the first column
  (text case-insensitive); TRUE: largest value ≤ `value` in a first column sorted ascending. No match →
  `#N/A`; `col` outside the range → `#REF!`.
- `INDEX(range, row, [col=1])` — 1-based; outside → `#REF!`.
- `MATCH(value, range, [type=1])` — position in a one-row or one-column range; `0` exact, `1` largest
  value ≤ `value` (sorted ascending), `-1` smallest value ≥ `value` (sorted descending). No match → `#N/A`.
- `CHOOSE(index, v1, v2, ...)` — index out of range → `#VALUE!`.

### Conditional aggregates
- `SUMIF(range, criteria, [sum_range])`, `COUNTIF(range, criteria)`, `AVERAGEIF(range, criteria, [avg_range])`.
- Criteria: a number or text (`5`, `"apple"`) means equality (text case-insensitive, wildcards `*` `?`
  allowed); text starting with an operator — `">5"`, `">=5"`, `"<5"`, `"<=5"`, `"<>5"`, `"=5"`,
  `"<>apple"` — compares with that operator. `AVERAGEIF` with no matching numbers → `#DIV/0!`.

### Information
- `ISBLANK(x)`, `ISNUMBER(x)`, `ISTEXT(x)`, `ISERROR(x)`, `ISNA(x)`, `ISLOGICAL(x)`.
