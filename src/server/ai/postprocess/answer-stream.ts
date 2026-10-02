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

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

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
      const code = Number.parseInt(this.unicodeDigits, 16);
      return this.consume(Number.isNaN(code) ? '�' : String.fromCharCode(code));
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

  /** Holds a trailing high surrogate back until its pair arrives, so every delta is well-formed. */
  private emit(text: string): string {
    let out = this.pendingHighSurrogate + text;
    this.pendingHighSurrogate = '';
    if (out.length > 0 && isHighSurrogate(out.charCodeAt(out.length - 1))) {
      this.pendingHighSurrogate = out.slice(-1);
      out = out.slice(0, -1);
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
          flushed = this.emit('�');
        }
      }
      if (this.depth === 1) this.expecting = 'comma';
    }
    return flushed;
  }
}
