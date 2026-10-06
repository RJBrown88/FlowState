/** One rendered bar: the text segments between "//" caesura marks. */
export type Bar = string[];

/** Split a (possibly still streaming) verse into bars, skipping blank lines. */
export function parseBars(verse: string): Bar[] {
  return verse
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('//').map((segment) => segment.trim()));
}
