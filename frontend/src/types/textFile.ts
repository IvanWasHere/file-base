/**
 * One window onto a file (PLAN.md §M31).
 *
 * Mirrors `backend/textfile`'s wire struct. The whole reader is built on the
 * rule this type encodes: a file is a path, an offset and a length, never a
 * string in memory. A 100GB log and a 10KB one produce exactly the same shape
 * and exactly the same cost.
 */
export interface FileChunk {
  /**
   * Where these bytes actually start — not necessarily where they were asked
   * for. Snapping moves it back to a line boundary and an offset past the end
   * of the file is clamped, so this is the number the reader displays and steps
   * from, never the one it requested.
   */
  offset: number
  /**
   * How many *bytes of the file* this window covers, which is not the length of
   * `data`: bytes that are not valid UTF-8 are replaced, and one bad byte
   * becomes one replacement character. The next window starts at
   * `offset + length`, so measuring the string instead would drift.
   */
  length: number
  data: string
  /**
   * The size at the moment of the read. Carried on every chunk rather than
   * taken once from the listing, because the reason to open a file this way is
   * often that something is still writing to it.
   */
  fileSize: number
  /**
   * Whether either edge of the window was moved to a line boundary. False when
   * snapping is off, and false when it was asked for and no newline was within
   * Go's scan budget — which is how the reader can say "this is one very long
   * line" rather than quietly showing a window that is not what was asked for.
   */
  snapped: boolean
}
