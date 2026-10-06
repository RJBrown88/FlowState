# Blueprint 1 — Enter-key race and bar rendering

**Goal:** a verse can only be generated once at a time, bars are numbered 01, 02, 03… with no gaps, and no text from the model is dropped.

**Files:** `src/App.tsx`, new `src/lib/bars.ts`
**Size:** ~15 changed lines in `App.tsx`, ~20-line new helper
**Dependencies:** none (no `package.json` changes)

---

## 1a. Enter key starts a second generation while one is running

### Root cause
The "Spit Bars" button has `disabled={isSpitting || !seed.trim()}` (`App.tsx:223`), but the input's key handler (`App.tsx:131`) calls `handleSpit()` directly:

```tsx
onKeyDown={(e) => e.key === 'Enter' && handleSpit()}
```

`handleSpit` (`App.tsx:70`) only checks that the seed isn't empty. Pressing Enter mid-generation:
1. clears the verse (`setVerse('')`),
2. starts a second stream,
3. leaves the first stream running. Both loops then append to the same state with `setVerse(prev => prev + chunk)`, so the output interleaves the two verses word by word.
4. Whichever stream finishes first sets `isSpitting` to false, which re-enables the button while the other stream is still writing.

### Fix options

**[A] State guard (recommended):** one line at the top of `handleSpit`:
```ts
if (!seed.trim() || isSpitting) return;
```
This works because React applies `setIsSpitting(true)` before the next keyboard event is handled, so a second Enter sees `isSpitting === true`. It's also the same rule the button already uses, so the two input paths stay consistent.

**[B] Ref guard:** an `inFlight = useRef(false)` set at the start and cleared in `finally`. It's immune to render timing, but it's a second source of truth next to `isSpitting`. It becomes worthwhile in Phase 3, where an `AbortController` ref replaces it naturally, so there's no need to add it now.

### Edge cases to confirm
- Holding Enter down (key auto-repeat) produces exactly one generation.
- Enter with an empty or whitespace-only seed still does nothing.
- After a generation finishes or fails, Enter works again.

---

## 1b. Bar numbers skip (01, 03, 05…)

### Root cause
`App.tsx:287–298` numbers bars by their position in the **raw** line list:

```tsx
{verse.split('\n').map((line, idx) => {
  if (!line.trim()) return null;                  // blank lines hidden…
  ...
  {String(idx + 1).padStart(2, '0')}              // …but still counted
```

The prompt asks Gemini to "use line breaks between bars". When the model leaves blank lines between bars, every blank line takes up a number. The same index also drives the entrance animation delay (`delay: idx * 0.05`, line 295), so later bars appear later than they should.

### Fix
Filter out blank lines **before** numbering. Do the parsing in a pure helper so it can be unit-tested later (backlog item: Vitest):

`src/lib/bars.ts`
```ts
/** One rendered bar: the text segments between "//" caesura marks. */
export type Bar = string[];

export function parseBars(verse: string): Bar[] {
  return verse
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('//').map((segment) => segment.trim()));
}
```

`App.tsx` then maps over `parseBars(verse)`, and `idx` is the bar index, so numbering and animation delay are both correct.

### Streaming check
While a verse streams in, the last line is incomplete and changes with every chunk. That's still fine:
- bars are only ever appended, so index keys (`key={idx}`) stay stable and existing bars don't re-mount or re-animate;
- a blank line that arrives as two separate chunks (`"\n"` then `"\n"`) is still filtered out, because the filter runs on the whole accumulated text on every render.

---

## 1c. Text after a second `//` disappears

### Root cause
`App.tsx:289` splits on `//`, then renders only `parts[0]` and `parts[1]`. If the model writes two caesuras in one bar (which happens in CHOPPER mode, where short phrases are the goal), everything after the second `//` is silently dropped.

### Fix options

**[A] Render every `//` as a caesura (recommended):** `parseBars` already returns all segments, so render them separated by caesura marks:
```tsx
<div className="flex flex-wrap items-center">
  {bar.map((segment, i) => (
    <React.Fragment key={i}>
      {i > 0 && <span className="caesura">//</span>}
      <span className="group-hover:text-neon-green transition-colors">{segment}</span>
    </React.Fragment>
  ))}
</div>
```
This shows exactly what the model wrote, and it makes a model breaking the one-caesura rule visible instead of hiding it.

**[B] First `//` is the caesura, the rest is literal text:** split at the first `indexOf('//')` only. This keeps the two-column look strict, but the extra `//` then shows up as plain text.

---

## 1d. Optional: cap the entrance delay

With the numbering fix, bar 16 waits `15 × 0.05 = 0.75 s` after mounting before it fades in, even though its text has already arrived. It's mostly invisible, but `delay: Math.min(idx, 4) * 0.05` keeps the staggered look on the first few bars without making the tail lag. Skip it if you like the current feel.

---

## Verification

1. `npm run lint` and `npm run build` pass.
2. Helper check, no test framework needed (Node 22 runs TypeScript directly):
   ```bash
   node -e "
   import('./src/lib/bars.ts').then(({ parseBars }) => {
     console.log(JSON.stringify(parseBars('a // b\n\nc // d // e\n   \nf')));
   })"
   ```
   Expected: `[["a","b"],["c","d","e"],["f"]]`
3. Manual, in `npm run dev`:
   - Generate a verse and press Enter repeatedly while it streams → one coherent verse, button stays disabled until it ends.
   - Numbers run 01…N with no gaps.
   - Set GRID = CHOPPER a few times and look for bars with two `//` marks: all segments render.

## Out of scope
- Error text is currently written into the verse and parsed as a bar. Phase 3 replaces this with a separate error state.
- Cancel button → Phase 3.
