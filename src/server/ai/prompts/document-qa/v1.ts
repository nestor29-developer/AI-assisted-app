import { RULES } from './rules';
import { createDocumentQaTemplate } from './shared';

/** The baseline: rules only. */
export const documentQaV1 = createDocumentQaTemplate({
  version: 'v1',
  systemInstruction: RULES,
});
