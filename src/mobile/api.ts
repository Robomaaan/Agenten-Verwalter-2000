import type { ChatEntryEvent } from '@/lib/bindings/ChatEntryEvent';
import type { ChatPage } from '@/lib/bindings/ChatPage';
import type { ProjectSummary } from '@/lib/bindings/ProjectSummary';
import type { QuestionAnswer } from '@/lib/bindings/QuestionAnswer';
import type { SessionSummary } from '@/lib/bindings/SessionSummary';

const RECONNECT_DELAY_MS = 3000;

export class NotSignedInError extends Error {
  constructor() {
    super('Nicht angemeldet');
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response: Response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (response.status === 401 && path !== '/api/login') {
    throw new NotSignedInError();
  }
  const text: string = await response.text();
  if (response.status === 409) {
    throw JSON.parse(text) as unknown;
  }
  if (!response.ok) {
    throw new Error(text === '' ? `HTTP ${String(response.status)}` : text);
  }
  return (text === '' ? null : JSON.parse(text)) as T;
}

export async function signIn(key: string): Promise<void> {
  await request<null>('/api/login', { key });
}

export function loadProjects(): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>('/api/projects');
}

export function loadSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>('/api/sessions');
}

export function loadChat(
  sessionId: string,
  before: number | null,
  limit: number,
): Promise<ChatPage> {
  const beforePart: string = before === null ? '' : `&before=${String(before)}`;
  return request<ChatPage>(
    `/api/chat?session=${encodeURIComponent(sessionId)}&limit=${String(limit)}${beforePart}`,
  );
}

export async function sendText(sessionId: string, text: string): Promise<void> {
  await request<null>('/api/send', { sessionId, text });
}

export async function answer(
  sessionId: string,
  requestId: string,
  questionAnswer: QuestionAnswer,
): Promise<void> {
  await request<null>('/api/answer', { sessionId, requestId, answer: questionAnswer });
}

export async function pause(sessionId: string): Promise<void> {
  await request<null>('/api/pause', { sessionId });
}

export async function resume(sessionId: string): Promise<void> {
  await request<null>('/api/resume', { sessionId });
}

export interface CoreEvents {
  onSession: (summary: SessionSummary) => void;
  onProject: (project: ProjectSummary) => void;
  onChat: (event: ChatEntryEvent) => void;
  /** Nach jedem Verbinden und Verbindungsverlust: was dazwischen kam, fehlt im Strom. */
  onSync: () => void;
}

/** Nach einer Antwort ungleich 200 (etwa 502 beim Neustart der App) gibt `EventSource` für immer auf;
 *  deshalb baut dies den Strom neu auf. */
export function connectEvents(events: CoreEvents): () => void {
  let source: EventSource | null = null;
  let retry: number | undefined;

  function open(): void {
    const current = new EventSource('/api/events');
    source = current;
    current.addEventListener('open', events.onSync);
    current.addEventListener('error', (): void => {
      if (current.readyState === EventSource.CLOSED) {
        events.onSync();
        retry = window.setTimeout(open, RECONNECT_DELAY_MS);
      }
    });
    current.addEventListener('session', (message: MessageEvent<string>): void => {
      events.onSession(JSON.parse(message.data) as SessionSummary);
    });
    current.addEventListener('project', (message: MessageEvent<string>): void => {
      events.onProject(JSON.parse(message.data) as ProjectSummary);
    });
    current.addEventListener('chat', (message: MessageEvent<string>): void => {
      events.onChat(JSON.parse(message.data) as ChatEntryEvent);
    });
  }

  open();
  return (): void => {
    window.clearTimeout(retry);
    source?.close();
  };
}
