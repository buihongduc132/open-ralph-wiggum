/**
 * StreamAccumulator — bounded rolling buffer for agent output streams.
 *
 * Replaces unbounded `stdoutText += chunk` in streamProcessOutput().
 * Keeps only the last N bytes of output (rolling tail), incrementally
 * extracts error patterns, and tracks total bytes seen.
 *
 * Error patterns match the existing extractErrors() in ralph.ts.
 */

export interface StreamAccumulatorOptions {
   tailMaxBytes: number; // default: 2 * 1024 * 1024 (2MB)
}

const DEFAULT_TAIL_MAX_BYTES = 2 * 1024 * 1024;

const MAX_ERRORS = 10;
const MAX_ERROR_LINE_LENGTH = 200;

export class StreamAccumulator {
   private _tail: string = "";
   private _errors: string[] = [];
   private _errorSet: Set<string> = new Set();
   private _totalBytes: number = 0;
   private readonly tailMaxBytes: number;
   private _errorLineBuffer: string = "";

   constructor(options?: Partial<StreamAccumulatorOptions>) {
      this.tailMaxBytes = options?.tailMaxBytes ?? DEFAULT_TAIL_MAX_BYTES;
   }

   /**
    * Append a chunk of output. Both stdout and stderr streams feed the
    * same tail buffer and error scanner (errors can appear on either).
    */
   append(chunk: string): void {
      if (chunk.length === 0) return;

      // Track total bytes (string length ≈ UTF-8 byte count for ASCII-heavy agent output)
      this._totalBytes += chunk.length;

      // Append to tail
      this._tail += chunk;

      // Trim tail when it exceeds 2x threshold
      if (this._tail.length >= this.tailMaxBytes * 2) {
         this._tail = this._tail.slice(-this.tailMaxBytes);
      }

      // Incremental error extraction — scan new chunk line by line
      if (this._errors.length < MAX_ERRORS) {
         this.extractErrorsFromChunk(chunk);
      }
   }

   /** Rolling tail buffer — last N bytes of all appended content. */
   get tail(): string {
      return this._tail;
   }

   /** Up to 10 unique error lines (max 200 chars each). */
   get errors(): string[] {
      // Flush any remaining partial line in the error buffer
      if (this._errorLineBuffer.length > 0 && this._errors.length < MAX_ERRORS) {
         const line = this._errorLineBuffer;
         this._errorLineBuffer = "";
         this.scanLineForError(line);
      }
      return this._errors;
   }

   /** Total bytes appended across all chunks. */
   get totalBytes(): number {
      return this._totalBytes;
   }

   /** Clear all state. */
   reset(): void {
      this._tail = "";
      this._errors = [];
      this._errorSet.clear();
      this._totalBytes = 0;
      this._errorLineBuffer = "";
   }

   // ---------------------------------------------------------------------------
   // Private helpers
   // ---------------------------------------------------------------------------

   /**
    * Scan a chunk for error patterns, same logic as extractErrors() in ralph.ts.
    * Buffers the trailing partial line across calls to handle error patterns
    * split across chunk boundaries.
    */
   private extractErrorsFromChunk(chunk: string): void {
      const combined = this._errorLineBuffer + chunk;
      const lines = combined.split("\n");
      // Keep the last (potentially partial) line in the buffer for next call
      this._errorLineBuffer = lines.pop() ?? "";

      for (const line of lines) {
         if (this._errors.length >= MAX_ERRORS) break;
         this.scanLineForError(line);
      }
   }

   /** Check a single line for error patterns and add to errors if matched. */
   private scanLineForError(line: string): void {
      const lower = line.toLowerCase();
      const isMatch =
         lower.includes("error:") ||
         lower.includes("failed:") ||
         lower.includes("exception:") ||
         lower.includes("typeerror") ||
         lower.includes("syntaxerror") ||
         lower.includes("referenceerror") ||
         (lower.includes("test") && lower.includes("fail"));

      if (!isMatch) return;

      const cleaned = line.trim().substring(0, MAX_ERROR_LINE_LENGTH);
      if (cleaned && !this._errorSet.has(cleaned)) {
         this._errorSet.add(cleaned);
         this._errors.push(cleaned);
      }
   }
}
