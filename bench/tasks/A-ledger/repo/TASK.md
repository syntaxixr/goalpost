# ledger — a small personal finance CLI

Build `ledger`, a command-line tool for tracking income and expenses.

- Node.js 18+ and **no npm dependencies** (Node built-ins only).
- `bin/ledger.js` is the CLI: `node bin/ledger.js <command> [args] [options]`.
- `src/` holds the library code, `test/` holds tests, `npm test` runs them (`"test": "node --test"` in `package.json`).
- `README.md` documents every command with an example.

## Data

- Transactions live in a JSON file: `ledger.json` in the current directory, or the path given with the global option `--file <path>` (accepted by every command, anywhere after the command name).
- A missing file means an empty ledger. Writes are atomic: write a temp file in the same directory, then rename it over the target.
- A transaction has `id` (integer, starts at 1, increases, never reused even after delete), `date` (`YYYY-MM-DD`), `amount` (stored as integer **cents**; positive = income, negative = expense), `category` (lowercase string), `note` (string, may be empty).
- Money is printed with exactly 2 decimals and a leading `-` for negatives: `-12.50`, `1200.00`, `0.30`.
  Adding `0.1` and `0.2` gives a balance of `0.30` (no float drift).

## Commands

### `add <amount> <category> [--date YYYY-MM-DD] [--note TEXT] [--repeat monthly --times N]`
- Prints `added #<id>`.
- `amount` looks like `-12.5`, `1200`, `+3.99`. More than 2 decimals or not a number → error.
- `category` is trimmed and lowercased; empty → error.
- `--date` defaults to today; it must be a real calendar date (`2025-02-30` → error).
- `--repeat monthly --times N` (N ≥ 1) adds N transactions one month apart starting at `--date`, keeping the day of month; when a month is shorter, use its last day (Jan 31 → Feb 28/29 → Mar 31). Prints `added #<first>..#<last>`.

### `list [--category C] [--from DATE] [--to DATE] [--json]`
- Sorted by date, then id. Filters combine; `--from`/`--to` are inclusive.
- Text output: one line per transaction, fields separated by single spaces: `#<id> <date> <amount> <category> <note>` (no trailing space when the note is empty).
- `--json`: a JSON array of `{"id","date","amount","category","note"}` with `amount` as a number in currency units (e.g. `-12.5`).

### `balance [--by-category]`
- Prints `balance: <amount>` (sum of all amounts).
- `--by-category`: one line per category `<category>: <amount>`, sorted by amount ascending (largest expense first), ties by category name.

### `delete <id>`
- Prints `deleted #<id>`.

### `edit <id> [--amount X] [--category C] [--date D] [--note TEXT]`
- Changes only the given fields, with the same validation as `add`. Prints `updated #<id>`.

### `budget set <category> <amount>` and `budget status`
- `budget set` stores a monthly limit (positive amount) for a category in the same file. Prints `budget <category> <amount>`.
- `budget status [--month YYYY-MM]` (default: current month): one line per budgeted category, sorted by name:
  `<category> spent <spent> of <limit> left <left>` where `spent` is the total of that category's expenses in the month as a positive number and `left = limit - spent`. When `left` is negative, append ` !` to the line.

### `import <file.csv>`
- CSV with a header row `date,amount,category,note`. Fields may be quoted with `"`; quoted fields may contain commas and `""` for a quote.
- Valid rows are added. Invalid rows are skipped and reported on **stderr** as `line <n>: <reason>` (n = line number in the file, header is line 1).
- Prints `imported <k>` to stdout. Exit code 1 if any row was invalid, 0 otherwise.

### `export --format csv|json`
- Writes all transactions to stdout. `json` is the same shape as `list --json`. `csv` has the header `id,date,amount,category,note`, amounts with 2 decimals, and quotes fields that contain a comma or quote.

### `report --month YYYY-MM`
Prints exactly these lines:
```
month: <YYYY-MM>
income: <sum of positive amounts>
expenses: <sum of negative amounts, as a positive number>
net: <income - expenses>
top: <cat1> <amt1>, <cat2> <amt2>, <cat3> <amt3>
```
`top` lists up to 3 categories with the largest expenses that month (amounts as positive numbers, largest first, ties by name); it is `top: none` when there are no expenses.

### `undo`
- Reverts the most recent change made by `add`, `delete`, `edit`, `import` or `budget set` (one level is enough; repeated `undo` may walk back further). Prints `undone`. With nothing to undo: prints `nothing to undo` and exits 1.

### `--help` and errors
- `node bin/ledger.js --help` (and `help`) prints usage that names every command above.
- Errors go to stderr. Exit code 2 for bad usage (unknown command, missing/invalid arguments, invalid values, unknown id); 0 on success.

## Library

`src/ledger.js` exports a class `Ledger`:
- `new Ledger(filePath)`; `add({amount, category, date, note})` → the new transaction (amount in currency units, e.g. `-12.5`);
- `list({category, from, to})` → array (same shape as `list --json`); `balance()` → number in currency units;
- `remove(id)`; `update(id, fields)`.
Changes made through the library are saved to the file immediately.
