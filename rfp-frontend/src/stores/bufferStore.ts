/**
 * bufferStore.ts — Module-level storage for the raw workbook ArrayBuffer.
 *
 * Why this exists:
 * - ArrayBuffers cannot be serialized to localStorage (used by Zustand persist)
 * - Zustand devtools middleware also struggles with binary data
 * - We need the buffer to write answers back into the original file
 *
 * Trade-off: this won't survive a hard page refresh. Users need to re-upload
 * if they refresh — but within a single session it works perfectly.
 */

let _buffer: ArrayBuffer | null = null

export function setRawBuffer(buffer: ArrayBuffer): void {
  _buffer = buffer
}

export function getRawBuffer(): ArrayBuffer | null {
  return _buffer
}

export function clearRawBuffer(): void {
  _buffer = null
}