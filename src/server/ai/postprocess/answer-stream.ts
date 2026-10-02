type Expecting = 'key' | 'colon' | 'value' | 'comma';
type Role = 'key' | 'answer' | 'other';

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  '/': '/',
  '\\': '\\',
  '"': '"',
};

const REPLACEMENT = '\u{FFFD}';
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Pulls the top-level "answer" string out of streamed JSON as it arrives, in linear time. */
export class AnswerStreamExtractor {
  private depth = 0;
  private expecting: Expecting = 'key';
  private currentKey = '';
  private keyBuffer = '';
  private inString = false;
  private role: Role = 'other';
  private escape: 'none' | 'slash' | 'unicode' = 'none';
  private unicodeDigits = '';
  private pendingHighSurrogate = '';
  private answerDone = false;
  private full = '';

  /** Everything extracted so far. */
  get text(): string {
    return this.full;
  }

  get done(): boolean {
    return this.answerDone;
  }

  /** Feeds the next chunk and returns only the answer text that became available. */
  push(chunk: string): string {
    let delta = '';
    for (const char of chunk) delta += this.step(char);
    return delta;
  }

  private step(char: string): string {
    return this.inString ? this.stringChar(char) : this.structuralChar(char);
  }

  private structuralChar(char: string): string {
    switch (char) {
      case '{':
      case '[':
        this.depth += 1;
        if (this.depth === 1) this.expecting = 'key';
        break;
      case '}':
      case ']':
        this.depth -= 1;
        if (this.depth === 1) this.expecting = 'comma';
        break;
      case '"':
        this.beginString();
        break;
      case ':':
        if (this.depth === 1) this.expecting = 'value';
        break;
      case ',':
        if (this.depth === 1) this.expecting = 'key';
        break;
      default:
        // A bare literal (number, true, null) used as a top-level value.
        if (this.depth === 1 && this.expecting === 'value' && !/\s/.test(char))
          this.expecting = 'comma';
    }
    return '';
  }

  private beginString(): void {
    this.inString = true;
    this.escape = 'none';
    if (this.depth === 1 && this.expecting === 'key') {
      this.role = 'key';
      this.keyBuffer = '';
    } else if (
      this.depth === 1 &&
      this.expecting === 'value' &&
      this.currentKey === 'answer' &&
      !this.answerDone
    ) {
      this.role = 'answer';
    } else {
      this.role = 'other';
    }
  }

  private stringChar(char: string): string {
    if (this.escape === 'slash') {
      this.escape = 'none';
      if (char === 'u') {
        this.escape = 'unicode';
        this.unicodeDigits = '';
        return '';
      }
      return this.consume(SIMPLE_ESCAPES[char] ?? char);
    }
    if (this.escape === 'unicode') {
      this.unicodeDigits += char;
      if (this.unicodeDigits.length < 4) return '';
      this.escape = 'none';
      const isHex = /^[0-9a-f]{4}$/i.test(this.unicodeDigits);
      return this.consume(
        isHex ? String.fromCharCode(Number.parseInt(this.unicodeDigits, 16)) : REPLACEMENT,
      );
    }
    if (char === '\\') {
      this.escape = 'slash';
      return '';
    }
    if (char === '"') return this.endString();
    return this.consume(char);
  }

  private consume(text: string): string {
    if (this.role === 'key') {
      if (this.keyBuffer.length < 64) this.keyBuffer += text;
      return '';
    }
    return this.role === 'answer' ? this.emit(text) : '';
  }

  /** Keeps every delta well-formed: a split pair waits for its other half, a stray half becomes U+FFFD. */
  private emit(text: string): string {
    let out = '';
    for (const char of text) {
      const unit = char.charCodeAt(0);
      if (this.pendingHighSurrogate) {
        const high = this.pendingHighSurrogate;
        this.pendingHighSurrogate = '';
        if (isLowSurrogate(unit)) {
          out += high + char;
          continue;
        }
        out += REPLACEMENT;
      }
      if (isHighSurrogate(unit) && char.length === 1) this.pendingHighSurrogate = char;
      else out += isLowSurrogate(unit) && char.length === 1 ? REPLACEMENT : char;
    }
    this.full += out;
    return out;
  }

  private endString(): string {
    this.inString = false;
    let flushed = '';
    if (this.role === 'key') {
      this.currentKey = this.keyBuffer;
      this.expecting = 'colon';
    } else {
      if (this.role === 'answer') {
        this.answerDone = true;
        if (this.pendingHighSurrogate) {
          this.pendingHighSurrogate = '';
          flushed = this.emit(REPLACEMENT);
        }
      }
      if (this.depth === 1) this.expecting = 'comma';
    }
    return flushed;
  }
}
