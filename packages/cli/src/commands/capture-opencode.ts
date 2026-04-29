import { parseOpenCodeEnvelope } from '@minspect/adapter-opencode';
import {
  readOpenCodeState,
  withOpenCodeStateLock,
  writeOpenCodeState,
} from '../session-state-opencode.js';
import { sendEvent } from '../transport.js';

export interface CaptureOpenCodeOptions {
  stateRoot?: string;
  // Test-only: pre-parsed envelope. If absent, stdin is read and JSON-parsed.
  rawEnvelope?: unknown;
}

async function readStdinJson(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Extract session_id from the envelope payload so we know which state file
// to load. Every variant has one somewhere; we just have to probe a few
// locations because SDK events put it in different spots.
function extractSessionId(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== 'object') return null;
  const env = envelope as { hookName?: unknown; payload?: unknown };
  const payload = env.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== 'object') return null;

  // tool.before / tool.after → payload.sessionID
  if (typeof payload.sessionID === 'string') return payload.sessionID;

  // event hook → payload.properties.{info | part | sessionID}
  const props = payload.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  if (typeof props.sessionID === 'string') return props.sessionID;

  const info = props.info as { id?: unknown; sessionID?: unknown } | undefined;
  if (info) {
    if (typeof info.sessionID === 'string') return info.sessionID;
    // session.created's info.id IS the session_id (message.updated info.id
    // is a message id — look at event type to disambiguate).
    if (typeof info.id === 'string' && payload.type === 'session.created') return info.id;
  }

  // message.part.updated → properties.part.sessionID
  const part = props.part as { sessionID?: unknown } | undefined;
  if (part && typeof part.sessionID === 'string') return part.sessionID;

  return null;
}

export async function runCaptureOpenCode(
  options: CaptureOpenCodeOptions = {},
): Promise<{ events: number; warnings: string[] } | null> {
  let envelope: unknown;
  if (options.rawEnvelope !== undefined) {
    envelope = options.rawEnvelope;
  } else {
    const raw = await readStdinJson();
    try {
      envelope = JSON.parse(raw);
    } catch {
      // Never block the agent. Echo nothing; exit 0 is handled by bin.ts.
      return null;
    }
  }

  const sessionId = extractSessionId(envelope);
  if (!sessionId) {
    // If we can't pin it to a session, we can still parse — but state won't
    // persist. That's fine for lifecycle events that produce no state delta.
    const result = parseOpenCodeEnvelope(envelope);
    for (const ev of result.events) await sendEvent(ev, options.stateRoot);
    return { events: result.events.length, warnings: result.warnings };
  }

  // Serialize read-modify-write per session so bursty plugin events don't
  // race and overwrite each other's state updates.
  return await withOpenCodeStateLock(sessionId, options.stateRoot, async () => {
    const prior = readOpenCodeState(sessionId, options.stateRoot);
    const result = parseOpenCodeEnvelope(envelope, prior);
    for (const ev of result.events) await sendEvent(ev, options.stateRoot);
    writeOpenCodeState(sessionId, result.next, options.stateRoot);
    return { events: result.events.length, warnings: result.warnings };
  });
}
