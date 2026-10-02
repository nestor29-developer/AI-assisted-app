import { RULES } from './rules';
import { createDocumentQaTemplate } from './shared';

const EXAMPLES = `Examples of the output format. Your sources and questions will differ.

Sources: S1 "The warehouse opens at 07:00 and closes at 19:00 on weekdays." S2 "Deliveries are not accepted on public holidays."
Question: How many hours is the warehouse open each weekday?
{"answer":"The warehouse is open from 07:00 to 19:00 on weekdays, which is 12 hours [S1].","citations":[{"sourceId":"S1","quote":"The warehouse opens at 07:00 and closes at 19:00 on weekdays."}],"status":"answered","followUpQuestions":["Are deliveries accepted on public holidays?"]}

Sources: S1 "Standard shipping takes 3 to 5 business days."
Question: How long does shipping take and what does express shipping cost?
{"answer":"Standard shipping takes 3 to 5 business days [S1]. The sources do not say what express shipping costs.","citations":[{"sourceId":"S1","quote":"Standard shipping takes 3 to 5 business days."}],"status":"partially_answered","followUpQuestions":["Is there a free shipping threshold?"]}

Sources: S1 "Returns are accepted within 30 days of purchase."
Question: Who founded the company?
{"answer":"I could not find that in the provided sources.","citations":[],"status":"not_found","followUpQuestions":[]}`;

/** v1 plus worked examples: the only difference, so an evaluation isolates what examples buy. */
export const documentQaV2 = createDocumentQaTemplate({
  version: 'v2',
  systemInstruction: `${RULES}\n\n${EXAMPLES}`,
});
