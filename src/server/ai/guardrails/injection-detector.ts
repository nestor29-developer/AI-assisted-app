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
  /** Needs the original line breaks; every other rule sees whitespace collapsed to single spaces. */
  readonly lineStart?: boolean;
  readonly pattern: RegExp;
}

// "Do not ignore the instructions" is ordinary safety wording, not an attack.
const UNLESS_NEGATED = String.raw`(?<!\b(?:do\s?n['’]?t|never|not|cannot|can['’]?t|should\s?n['’]?t)\s)`;

const OVERRIDE_VERBS_ES_PT =
  'ignora|ignore|ignorar|olvida|olvide|omite|descarta|desconsidera|desconsidere|esquece|esqueca';

// Gaps are bounded ({0,N}) and text is lowercased, accent-free and whitespace-collapsed first, so every rule is linear.
const RULES: readonly Rule[] = [
  {
    signal: 'instruction_override',
    strong: true,
    pattern: new RegExp(
      UNLESS_NEGATED +
        String.raw`\b(?:ignore|disregard|forget|override|bypass|discard)\b.{0,20}\b(?:previous|prior|above|earlier|preceding|all|any|your|these|those)\b.{0,20}\b(?:instructions?|prompts?|rules|guidelines|directions|directives|programming|constraints|safeguards|guardrails|messages?|context)\b`,
    ),
  },
  {
    signal: 'instruction_override',
    strong: true,
    pattern: new RegExp(
      UNLESS_NEGATED +
        String.raw`\b(?:ignore|disregard|forget)\b.{0,12}\b(?:everything|anything|all)\b.{0,20}\b(?:above|before|previously|earlier|prior|told|said)\b`,
    ),
  },
  {
    signal: 'instruction_override',
    strong: true,
    pattern: /\b(?:new|updated|real|actual|revised)\s+(?:system\s+)?instructions?\s*:/,
  },
  {
    signal: 'instruction_override',
    strong: true,
    pattern: new RegExp(
      String.raw`\b(?:${OVERRIDE_VERBS_ES_PT})\b.{0,20}\b(?:anteriores|previas|previos|todas|todos|tus|sus|tuas|suas)\b.{0,20}\b(?:instrucciones|indicaciones|reglas|directrices|directivas|restricciones|instrucoes|regras|diretrizes|orientacoes|prompts?)\b`,
    ),
  },
  {
    signal: 'instruction_override',
    strong: true,
    pattern: new RegExp(
      String.raw`\b(?:${OVERRIDE_VERBS_ES_PT})\b.{0,20}\b(?:instrucciones|indicaciones|reglas|directrices|instrucoes|regras|diretrizes)\b.{0,12}\b(?:anteriores|previas|previos)\b`,
    ),
  },
  {
    signal: 'prompt_exfiltration',
    strong: true,
    pattern:
      /\b(?:reveal|show|print|repeat|output|display|leak|tell|give|share|recite|dump|disclose|expose)\b.{0,30}\b(?:your\s+(?:(?:system|initial|original|hidden|secret)\s+)?(?:prompt|instructions?|rules|guidelines|programming)|(?:the|these)\s+(?:system|initial|original|hidden|secret|developer)\s+(?:prompt|message|instructions?)|(?:the\s+)?(?:instructions?|rules|guidelines)\s+(?:you\s+(?:were|have\s+been)\s+given|given\s+to\s+you|above))\b/,
  },
  {
    signal: 'prompt_exfiltration',
    strong: true,
    pattern:
      /\b(?:revela|revele|muestra|muestrame|mostra|mostre|imprime|imprima|repite|repita|dime|diga|dame|escribe|filtra|divulga|comparte|compartilhe)\b.{0,30}\b(?:(?:tu|tus|teu|tuas|su|sus|seu|seus|sua|suas)\s+(?:prompt|instrucciones|instrucoes|reglas|regras|directrices|diretrizes)|(?:el|o)\s+prompt\s+(?:del?|do)\s+sistema|(?:las|as)\s+(?:instrucciones|instrucoes)\s+(?:del?|do)\s+sistema)\b/,
  },
  {
    signal: 'role_impersonation',
    strong: true,
    pattern:
      /<\|\s*(?:im_start|im_end|system|assistant|user|endoftext)\s*\|>|\[\s*\/?\s*inst\s*\]|<<\s*\/?\s*sys\s*>>/,
  },
  {
    // "System: Windows 11" is a spec line; it only counts when the same line talks to the reader.
    signal: 'role_impersonation',
    strong: false,
    lineStart: true,
    pattern:
      /^[ \t]{0,20}(?:system|assistant)[ \t]{0,20}:[^\n]{0,120}\b(?:you|your|must|always|never|ignore|respond|reply|answer|follow)\b/m,
  },
  {
    signal: 'role_impersonation',
    strong: false,
    pattern:
      /\byou are now\b|\bpretend (?:to be|you are)\b|\bfrom now on,? you\b|\byou (?:must|will|shall|should|have to) (?:now )?(?:act|behave|respond|answer) as\b/,
  },
  {
    // Our real tags carry a random nonce, so a spoofed one cannot close a block; it is still a tell.
    signal: 'delimiter_spoofing',
    strong: false,
    pattern:
      /<\/?\s*(?:sources?|history|conversation[-_ ]history|instructions?|system|context|documents?)(?:-[a-z0-9]{6,})?\b[^>]{0,40}>/,
  },
  {
    signal: 'jailbreak_phrase',
    strong: false,
    pattern:
      /\b(?:do anything now|jailbreak(?:ed|ing)?|developer mode|dan mode|no (?:restrictions|limitations|filters|rules))\b/,
  },
  {
    signal: 'exfiltration_url',
    strong: false,
    pattern:
      /\b(?:send|post|upload|forward|email|submit)\b.{0,60}\b(?:to|at)\b.{0,15}https?:\/\/\S{3,}/,
  },
];

export interface DetectOptions {
  /** Tag characters or bidi controls found by the sanitizer count as a strong hidden-text signal. */
  readonly hiddenUnicodeFound?: boolean;
}

// Every rule is linear, so the whole text is scanned; the cap only bounds memory for absurd inputs.
const MAX_SCAN_CHARS = 2_000_000;

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const MARKS = /\p{M}+/gu;

// Letters that look Latin, so "ignоre" with a Cyrillic "о" cannot slip past the patterns.
const LOOKALIKES: Readonly<Record<string, string>> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  һ: 'h',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ѵ: 'v',
  к: 'k',
  ο: 'o',
  α: 'a',
  ν: 'v',
  ι: 'i',
  ρ: 'p',
  κ: 'k',
  τ: 't',
  ε: 'e',
  ɡ: 'g',
  ı: 'i',
};
const LOOKALIKE_PATTERN = new RegExp(`[${Object.keys(LOOKALIKES).join('')}]`, 'g');

/** Folds away the cheap tricks (width, invisibles, accents, look-alikes) and, for most rules, line breaks. */
function prepare(text: string): { lines: string; flat: string } {
  const folded = text
    .normalize('NFKC')
    .replace(IGNORABLE, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(MARKS, '')
    .replace(LOOKALIKE_PATTERN, (char) => LOOKALIKES[char] ?? char);
  return { lines: folded, flat: folded.replace(/\s+/g, ' ') };
}

/** Heuristic only. It raises flags for logging and review; it is never the sole defense. */
export function detectInjection(text: string, options: DetectOptions = {}): InjectionVerdict {
  const { lines, flat } = prepare(text.slice(0, MAX_SCAN_CHARS));
  const signals = new Set<InjectionSignal>();
  let strong = false;

  for (const rule of RULES) {
    if (rule.pattern.test(rule.lineStart ? lines : flat)) {
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
