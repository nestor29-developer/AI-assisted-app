export type InjectionSignal =
  | 'instruction_override'
  | 'prompt_exfiltration'
  | 'role_impersonation'
  | 'delimiter_spoofing'
  | 'jailbreak_phrase'
  | 'hidden_unicode'
  | 'exfiltration_url';

export type InjectionLevel = 'none' | 'suspicious' | 'high';

export interface InjectionVerdict {
  readonly level: InjectionLevel;
  /** Signal names only, never the matched text, so verdicts are safe to log. */
  readonly signals: readonly InjectionSignal[];
}

interface Rule {
  readonly signal: InjectionSignal;
  readonly strong: boolean;
  readonly pattern: RegExp;
}

// Gaps are bounded ({0,N}) so no rule can backtrack catastrophically on adversarial input.
const RULES: readonly Rule[] = [
  {
    signal: 'instruction_override',
    strong: true,
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\b.{0,20}\b(?:previous|prior|above|earlier|preceding|all|any|your|the|these)\b.{0,20}\b(?:instructions?|prompts?|rules?|guidelines?|directions?|context|system)\b/i,
  },
  {
    signal: 'instruction_override',
    strong: true,
    pattern: /\b(?:new|updated|real|actual)\s+instructions?\s*:/i,
  },
  {
    signal: 'prompt_exfiltration',
    strong: true,
    pattern:
      /\b(?:reveal|show|print|repeat|output|display|leak|tell me)\b.{0,25}\b(?:your|the)\b.{0,15}\b(?:system\s+prompt|instructions?|initial\s+prompt|hidden\s+prompt)\b/i,
  },
  {
    signal: 'role_impersonation',
    strong: true,
    pattern: /<\|(?:im_start|im_end|system|assistant|user)\|>|\[\/?INST\]|<<\/?SYS>>/i,
  },
  {
    signal: 'role_impersonation',
    strong: false,
    pattern: /(?:^|\n)\s*(?:system|assistant|developer)\s*:/i,
  },
  {
    signal: 'role_impersonation',
    strong: false,
    pattern: /\byou are now\b|\bpretend (?:to be|you are)\b|\bfrom now on,? you\b/i,
  },
  {
    signal: 'delimiter_spoofing',
    strong: true,
    pattern:
      /<\/?\s*(?:sources?|source|question|history|conversation[-_ ]history|instructions?)\b[^>]{0,40}>/i,
  },
  {
    signal: 'jailbreak_phrase',
    strong: false,
    pattern:
      /\b(?:do anything now|jailbreak|developer mode|no (?:restrictions|limitations|filters))\b/i,
  },
  {
    signal: 'exfiltration_url',
    strong: false,
    pattern:
      /\b(?:send|post|upload|forward|email|submit)\b.{0,60}\b(?:to|at)\b.{0,15}https?:\/\/\S{3,}/i,
  },
];

export interface DetectOptions {
  /** Tag characters or bidi controls found by the sanitizer count as a strong hidden-text signal. */
  readonly hiddenUnicodeFound?: boolean;
}

// Scanning beyond this adds cost, not accuracy: injections sit in a few hundred characters.
const MAX_SCAN_CHARS = 200_000;

/** Heuristic only. It raises flags for logging and review; it is never the sole defense. */
export function detectInjection(text: string, options: DetectOptions = {}): InjectionVerdict {
  const scanned = text.slice(0, MAX_SCAN_CHARS).normalize('NFKC');
  const signals = new Set<InjectionSignal>();
  let strong = false;

  for (const rule of RULES) {
    if (rule.pattern.test(scanned)) {
      signals.add(rule.signal);
      strong ||= rule.strong;
    }
  }
  if (options.hiddenUnicodeFound) {
    signals.add('hidden_unicode');
    strong = true;
  }

  const level: InjectionLevel =
    signals.size === 0 ? 'none' : strong || signals.size >= 2 ? 'high' : 'suspicious';
  return { level, signals: [...signals] };
}
