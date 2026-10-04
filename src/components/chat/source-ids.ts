/** Every answer cites S1, S2 and so on, so each card scopes its element ids with its own prefix. */
export const sourceRowId = (scope: string, sourceId: string) => `${scope}-source-${sourceId}`;

export const excerptId = (scope: string, sourceId: string) => `${scope}-excerpt-${sourceId}`;
