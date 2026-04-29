export const PACKAGE_NAME = '@minspect/adapter-aider';

import type { Event } from '@minspect/core';

// Aider chat history parser skeleton. Real parser deferred until we can run
// Aider locally and capture `.aider.chat.history.md` + `git log` shape.

export interface AiderImportInput {
  chat_history_md?: string;
  git_log?: string;
}

export function parseAiderImport(_input: AiderImportInput): Event[] {
  return [];
}
