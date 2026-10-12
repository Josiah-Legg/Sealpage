# The Sealpage file format

A `.slpg` file is an **encrypted container** (Part 2) whose plaintext is a UTF-8
text document written in **Sealmark**, Sealpage's own markup (Part 1).

This document is precise enough to write a compatible reader or writer.
The reference implementation is:

| Concern | Source |
| --- | --- |
| Document model | `src/shared/model.ts` |
| Sealmark serialiser / parser | `src/shared/markup/serialize.ts`, `parse.ts`, `inline.ts` |
| Container | `src/main/crypto/container.ts` |
| Key derivation | `src/main/crypto/kdf.ts` |

Notation: `U+XXXX` is a Unicode code point, `0xNN` is a byte, "LF" is U+000A.

---

## Part 1 — Sealmark (the plaintext)

### 1.1 Overview

Sealmark is line oriented. A document is a first line declaring the format
version followed by **blocks** separated by blank lines. Every block type is
recognised by how its first line begins, so a parser only ever needs to look at
the start of a line to know what it is reading.

```
~sealpage 1

= Quarterly review

== Summary

Revenue grew *12%* year on year. See the [full report](https://example.com/q3).

- First point
  - A nested point
- Second point

@code "python"
| def greet(name):
|     return f"Hello, {name}"

---
```

Design rules:

* **Text encoding** is UTF-8 without a byte order mark. Lines end with a single
  LF. The file ends with one LF.
* The text is always well-formed Unicode (no unpaired surrogates). A writer
  replaces an unpaired surrogate with U+FFFD before serialising.
* **One block never spans a blank line**, and the serialiser writes exactly one
  blank line between blocks.
* The **serialiser is strict** (it emits exactly the canonical form described
  here). The **parser is lenient and total**: it never fails, and a line it
  does not recognise becomes a paragraph, so no text is ever dropped.
* The round-trip guarantee is `parse(serialise(d)) = normalise(d)` for every
  document `d`, and `serialise(parse(t)) = t` for every `t` produced by the
  serialiser.

### 1.2 The version line

The first line is `~sealpage ` followed by the markup version as a decimal
integer. This document describes version `1`.

Any other line beginning with `~` is reserved for future document-level
metadata. A version 1 reader ignores such lines.

### 1.3 Line classification

After the version line, a reader classifies each line by testing these rules
in order. `SP` is one space (U+0020), `EOL` is end of line.

| # | Line matches | Meaning |
| - | --- | --- |
| 1 | empty, or only spaces / tabs | Blank line: ends the current block |
| 2 | starts with `~` | Reserved metadata: ignored |
| 3 | exactly `---` | Divider block |
| 4 | one to four `=`, then `SP` or `EOL` | Title (1) or subheading level 1–3 (2–4) |
| 5 | `@code`, `@table` or `@graph`, then `SP` or `EOL` | Start of a code, table or graph block |
| 6 | zero or more pairs of spaces, then a list marker, then `SP` or `EOL` | List item |
| 7 | `>`, then `SP` or `EOL` | Quote paragraph |
| 8 | anything else | Paragraph |

List markers are `-` (bullet), `+` (numbered), `-[ ]` (unchecked checklist
item) and `-[x]` (checked checklist item).

Lines beginning with `|` or `:` are **body lines**. They are only meaningful
directly after a `@code`, `@table` or `@graph` line; anywhere else they fall
under rule 8.

### 1.4 Blocks

In the following, *inline* means inline content as defined in §1.5. Wherever a
block line carries inline content it is written as the block's prefix, one
space, and the inline text. When the inline content is empty, the space is
omitted too (`=`, `-`, `>` on their own).

#### Title and subheadings

```
= Document title
== Subheading level 1
=== Subheading level 2
==== Subheading level 3
```

#### Paragraph

A paragraph is one line of inline content with no prefix.

* An **empty paragraph** is written as a single backslash: `\`.
* If the inline text would begin with one of `~ = - + @ > :` it is preceded by
  a backslash (`\- not a list`). Together with the inline escaping rules (which
  always escape `|`, and never let a line start with whitespace) this
  guarantees a paragraph is never mistaken for another block.

#### Divider

```
---
```

#### Code block

```
@code "language label"
| first line of code
|
|     indented line
```

* The language label is a JSON string (RFC 8259). It may be `""`.
* Each line of code is written as `| ` followed by the line verbatim, or just
  `|` for an empty line. Nothing in a code line is escaped or interpreted.
* Reading: a body line that starts with `| ` contributes everything after
  those two characters; any other body line contributes everything after the
  `|`. The code text is the lines joined with LF.
* The block ends at the first line that does not start with `|`.
* A code block always has at least one body line (an empty code block is one
  `|` line).

Because every code line carries its own prefix there is no closing fence and
therefore nothing inside the code can end the block early.

#### Lists

```
- bullet item
- another
  + nested numbered item
  + second
    -[x] nested, checked
    -[ ] nested, unchecked
- back at the top
```

* An item is `indent marker [SP inline]`. The indent is two spaces per nesting
  level.
* A run of consecutive list lines forms one list group. Within a group, a line
  indented deeper than the previous item starts a nested list under that item
  (an indent more than one level deeper is treated as exactly one level
  deeper). Returning to a shallower indent closes the nested lists.
* At any one level, consecutive items with the same kind of marker (bullet,
  numbered, checklist) belong to the same list; a change of kind starts a new
  sibling list.
* An item holds one line of inline content and any number of nested lists.

Two separate top-level lists of the same kind are distinguished by the blank
line between them.

#### Block quote

```
> First paragraph of the quote.
> Second paragraph.
```

Each line is one paragraph of the quote. Consecutive `>` lines form one quote.

#### Table

```
@table header
| Name | Role |
| Ada | Engineer |
| Grace | Admiral |
```

* The directive is `@table`, optionally followed by the word `header`, which
  marks the first row as a header row.
* Each row is `|`, then for each cell: one space, the cell's inline content,
  one space, `|`. An empty cell is therefore two spaces between bars.
* Reading a row: split the line at every unescaped `|` (a `|` preceded by an
  odd number of backslashes is escaped). Discard the piece before the first
  bar and, if it is empty, the piece after the last bar. From each remaining
  piece remove one leading space if present, and one trailing space if present
  and not itself escaped. What is left is the cell's inline content.
* Tables are rectangular; a reader pads short rows with empty cells. A table
  has at least one row and one column.

#### Graph

```
@graph grouped-bar
: title "Revenue by quarter"
: x-label "Quarter"
: y-label "USD (thousands)"
: legend show bottom
: bins 0
| ["Quarter","2023","2024"]
| ["Q1","120","135.5"]
| ["Q2","98","142"]
```

* The directive is `@graph` followed by the chart type: `bar`, `grouped-bar`,
  `stacked-bar`, `line`, `area`, `pie`, `scatter` or `histogram`. An unknown or
  missing type is read as `bar`.
* **Property lines** start with `: ` followed by a property name and value:

  | Property | Value |
  | --- | --- |
  | `title`, `x-label`, `y-label` | a JSON string |
  | `legend` | `show` or `hide`, then `top`, `bottom`, `left` or `right` |
  | `bins` | histogram bin count, integer 0–200; `0` means automatic |

  Unknown properties are ignored. Missing properties take the defaults
  `""`, `""`, `""`, `show bottom`, `0`.
* **Data lines** start with `| ` followed by a JSON array of strings. The first
  data line is the column names; each further data line is one row.
  Column 0 is the label (or x) column and every other column is a data series.
* The data is stored exactly as the user typed it, as strings. Turning cells
  into numbers is the job of the application (see `src/shared/graph/data.ts`):
  blank cells are gaps, thousands separators, a leading currency symbol and a
  trailing `%` are accepted, anything else non-numeric is skipped with a
  warning.
* There are always at least two columns, and every row has exactly as many
  cells as there are columns (a reader pads or, after widening the column list
  to the widest row, never has to truncate).
* The serialiser always writes all five property lines, in the order shown.

How each chart type uses the table:

| Type | Column 0 | Other columns |
| --- | --- | --- |
| `bar`, `grouped-bar`, `stacked-bar`, `line`, `area` | category labels | one numeric series each |
| `pie` | slice labels | first series only; values ≤ 0 are skipped |
| `scatter` | numeric x | one y series each |
| `histogram` | ignored | values of every series are binned over shared bins |

### 1.5 Inline content

Inline content is a sequence of **text runs** and **hard line breaks**, written
on one physical line. Each text run carries four independent marks: bold,
italic, code, and an optional link target.

#### Marks

| Syntax | Meaning |
| --- | --- |
| `*` | toggle **bold** |
| `_` | toggle *italic* |
| `` ` `` | toggle `code` |
| `[` … `](target)` | the enclosed content links to `target` |

The three toggle characters are **switches, not brackets**: each occurrence
flips its mark on or off, independently of the others, so they never need to
nest. `*a _b* c_` is bold "a ", bold-italic "b", italic " c". All marks are off
at the start of a line and are implicitly reset at its end (the serialiser
nevertheless closes every mark it opened).

A link starts at an unescaped `[`. The reader looks ahead for the next
unescaped `]`; if it is immediately followed by `(` and there is a later
unescaped `)`, the text between `[` and `]` is the link content, and the text
between `(` and `)`, unescaped, is the target. Otherwise the `[` is literal
text. Links do not nest. Toggles inside the brackets work as usual, and toggle
state carries across the link's boundaries. A link whose target is empty is
read as plain content with no link.

#### Escapes

A backslash introduces an escape:

| Escape | Produces |
| --- | --- |
| `\` + any ASCII punctuation character or space | that character, literally |
| `\n` | a hard line break |
| `\t` | a tab (U+0009) |
| `\u{H…}` (1–6 hex digits) | the code point U+H…; U+FFFD if it is a surrogate or above U+10FFFF |
| `\` at the very end of the content | nothing |
| `\` + anything else | a literal backslash (the following character is read normally) |

The serialiser applies exactly these rules when writing text:

1. `\ * _ ` `` ` `` ` [ ] |` are always escaped with a backslash.
   In link targets `(` and `)` are escaped too.
2. Control characters — U+0000–U+001F except tab, U+007F–U+009F, U+2028 and
   U+2029 — are written as `\u{HEX}` (upper-case hex, no padding).
3. A hard line break is written as `\n`.
4. If the finished line starts or ends with a space it is written as `\u{20}`;
   a leading or trailing tab is written as `\t`. A serialised line therefore
   never begins or ends with whitespace.

Text never contains a raw line terminator: in the model, CR, LF and CRLF inside
text are converted to hard line breaks.

### 1.6 Normal form

The application keeps documents in a normal form, and the parser always returns
one. A compatible writer should produce it too:

* Inline: no empty text runs; adjacent runs with identical marks are merged;
  link targets contain no CR/LF and are never empty.
* Code: line terminators are LF only; the language label is a single trimmed
  line.
* Lists: no empty lists; adjacent *nested* sibling lists of the same kind are
  merged; `checked` is false outside checklists.
* Quotes have at least one paragraph. Tables are rectangular and at least 1×1.
* Graphs: at least two columns, rectangular rows, `bins` in 0–200, labels and
  cells are single lines.

### 1.7 Grammar summary (EBNF)

```
document   = version LF { LF block } ;
version    = "~sealpage " digits ;
block      = title | heading | paragraph | divider | code | list | quote | table | graph ;

title      = "=" [ " " inline ] LF ;
heading    = ( "==" | "===" | "====" ) [ " " inline ] LF ;
paragraph  = ( "\" | [ "\" ] inline ) LF ;
divider    = "---" LF ;

code       = "@code " json-string LF codeline { codeline } ;
codeline   = "|" [ " " any-chars ] LF ;

list       = item { item } ;
item       = { "  " } marker [ " " inline ] LF ;
marker     = "-" | "+" | "-[ ]" | "-[x]" ;

quote      = quoteline { quoteline } ;
quoteline  = ">" [ " " inline ] LF ;

table      = "@table" [ " header" ] LF row { row } ;
row        = "|" cell { cell } LF ;
cell       = " " inline " |" ;

graph      = "@graph " type LF
             ": title " json-string LF
             ": x-label " json-string LF
             ": y-label " json-string LF
             ": legend " ( "show" | "hide" ) " " ( "top" | "bottom" | "left" | "right" ) LF
             ": bins " digits LF
             datarow { datarow } ;
datarow    = "| " json-array-of-strings LF ;
type       = "bar" | "grouped-bar" | "stacked-bar" | "line" | "area" | "pie" | "scatter" | "histogram" ;

inline     = { text-char | escape | "*" | "_" | "`" | link } ;
link       = "[" inline "](" target ")" ;
```

---

## Part 2 — The encrypted container

### 2.1 Layout

All multi-byte integers are unsigned and big-endian.

| Offset | Size | Field | Value in version 1 |
| ---: | ---: | --- | --- |
| 0 | 8 | Magic | `89 53 4C 50 47 0D 0A 1A` (`\x89SLPG\r\n\x1a`) |
| 8 | 1 | Container version | `1` |
| 9 | 1 | KDF identifier | `1` = Argon2id, version 1.3 (0x13) |
| 10 | 1 | Cipher identifier | `1` = AES-256-GCM, per-file key via HKDF-SHA-256 |
| 11 | 1 | Content type | `1` = document (Sealmark text), `2` = application state |
| 12 | 2 | Header length | `88` |
| 14 | 2 | Reserved | `0` |
| 16 | 4 | Argon2 memory cost | in KiB (default 262144 = 256 MiB) |
| 20 | 4 | Argon2 time cost | passes (default 3) |
| 24 | 4 | Argon2 parallelism | lanes (default 4) |
| 28 | 16 | KDF salt | random; identifies the master key |
| 44 | 32 | File salt | random, new for every save |
| 76 | 12 | Nonce | random, new for every save |
| 88 | n | Ciphertext | same length as the plaintext |
| 88+n | 16 | Authentication tag | GCM tag |

The smallest valid file is 104 bytes (empty plaintext). The magic follows the
PNG convention: a high-bit byte, a name, CR LF and a control-Z, so that
transfer in "text mode" or 7-bit stripping is detected immediately.

### 2.2 Keys

**Master key.** 32 bytes:

```
master = Argon2id(password = UTF-8(NFC(passphrase)),
                  salt     = KDF salt (16 bytes),
                  m        = memory cost in KiB,
                  t        = time cost,
                  p        = parallelism,
                  taglen   = 32)          # RFC 9106, version 0x13, no secret, no associated data
```

The passphrase is normalised to Unicode NFC and encoded as UTF-8 before use.
The KDF salt and parameters are public and stored in every file, so a file plus
the passphrase is always enough to recreate the key. The parameters a reader
accepts are bounded: 8·p ≤ m ≤ 1 048 576 KiB, 1 ≤ t ≤ 64, 1 ≤ p ≤ 16.

**File key.** 32 bytes, different for every save of every file:

```
file_key = HKDF-SHA-256(ikm  = master,
                        salt = file salt (32 bytes),
                        info = ASCII "sealpage/file-key/v1" || content-type byte,
                        L    = 32)        # RFC 5869
```

### 2.3 Encryption

```
ciphertext, tag = AES-256-GCM(key   = file_key,
                              nonce = nonce (12 bytes),
                              aad   = header bytes 0..87 (the whole header),
                              plaintext)
```

The tag is 16 bytes. The whole header — magic, version, identifiers, content
type, KDF parameters, both salts and the nonce — is authenticated as additional
data, so no header field can be altered without detection.

A writer **must** draw a new random file salt and a new random nonce from a
cryptographically secure generator for every encryption. Because each save has
its own key, a (key, nonce) pair is never reused.

### 2.4 Decryption and errors

A reader proceeds in this order and stops at the first failure:

1. The file is at least 104 bytes and starts with the magic → otherwise **bad format**.
2. Container version is `1`. A larger number → **unsupported version** (written
   by a newer Sealpage); `0` → **bad format**.
3. KDF id, cipher id, content type, header length, reserved field and Argon2
   parameter bounds are valid → otherwise **bad format**.
4. Derive the file key and run AES-256-GCM decryption with the header as AAD.
   If the tag does not verify → **cannot decrypt**.

"Cannot decrypt" covers a wrong key and any modification or truncation of the
file; the two are deliberately indistinguishable and Sealpage shows the same
plain message for both. A reader **must not** release any plaintext before the
tag has been verified.

### 2.5 Versioning and migration

* A change that an old reader cannot handle increments the container version
  (byte 8). The header length field lets a future version append header fields
  while old data stays locatable.
* New KDFs or ciphers get new identifier values in bytes 9 and 10; existing
  values never change meaning.
* The markup has its own version on the first plaintext line (§1.2), so the
  text format can evolve without touching the container.
* To migrate a file, decrypt it with the old rules and write it again with the
  new ones; saving a document in Sealpage always writes the current version.

### 2.6 Other files Sealpage writes

These live in the application data folder and are not documents, but are
described here for completeness.

**`keystore.bin`** — the master key, wrapped by the operating system:

```
"SLPGKEY1" (8 ASCII bytes) || protect(blob)

blob (61 bytes) = version (1 byte, = 1)
               || Argon2 memory KiB (u32) || time cost (u32) || parallelism (u32)
               || KDF salt (16 bytes) || master key (32 bytes)
```

`protect` is Electron's `safeStorage.encryptString` applied to the Base64 text
of the blob; on Windows its key is protected by DPAPI for the current user and
kept by Chromium in `chromium\Local State` inside the data folder.

**`session.bin`** — the open folder and tabs, as JSON, encrypted as a container
with content type `2` under the master key.

**`settings.json`** — plain JSON with non-sensitive preferences only (style,
window size, shortcuts, …).

**Temporary files** — while saving `name.slpg`, Sealpage writes the complete new
container to `.name.slpg.<16 hex digits>.sealpage-tmp` in the same folder,
flushes it to disk and renames it over the original. These files only ever
contain ciphertext, and leftovers from a crash are deleted on the next launch.
