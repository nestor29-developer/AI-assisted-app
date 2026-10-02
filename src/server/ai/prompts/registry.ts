import { documentQaV1 } from './document-qa/v1';
import { documentQaV2 } from './document-qa/v2';
import type { PromptTemplate } from './types';

export class UnknownPromptError extends Error {
  constructor(id: string, version: string, known: readonly string[]) {
    super(`Unknown prompt ${id}@${version}. Known versions: ${known.join(', ') || 'none'}`);
    this.name = 'UnknownPromptError';
  }
}

/** Templates keyed by `id@version`, so every request can record exactly which prompt produced it. */
export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate>();

  register(template: PromptTemplate): this {
    const key = `${template.id}@${template.version}`;
    if (this.templates.has(key)) throw new Error(`Prompt ${key} is already registered`);
    this.templates.set(key, template);
    return this;
  }

  get(id: string, version: string): PromptTemplate {
    const template = this.templates.get(`${id}@${version}`);
    if (!template) throw new UnknownPromptError(id, version, this.versions(id));
    return template;
  }

  versions(id: string): string[] {
    return [...this.templates.values()]
      .filter((template) => template.id === id)
      .map((template) => template.version);
  }
}

export function createDefaultPromptRegistry(): PromptRegistry {
  return new PromptRegistry().register(documentQaV1).register(documentQaV2);
}
