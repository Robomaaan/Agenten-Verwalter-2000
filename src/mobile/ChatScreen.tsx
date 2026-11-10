import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import { createChatLoader } from '@/features/chat/useChatEntries';
import type { ChatLoader, ChatState } from '@/features/chat/useChatEntries';
import { STATUS_LABEL } from '@/features/sessions/sessionStatus';
import type { ChatEntry } from '@/lib/bindings/ChatEntry';
import type { ChatEntryEvent } from '@/lib/bindings/ChatEntryEvent';
import type { QuestionAnswer } from '@/lib/bindings/QuestionAnswer';
import type { SessionSummary } from '@/lib/bindings/SessionSummary';
import { commandErrorText } from '@/lib/errors';
import { answer, loadChat, pause, resume, sendText } from '@/mobile/api';
import { ChatEntryView } from '@/mobile/ChatEntryView';
import './ChatScreen.css';

export interface ChatFeed {
  onEntry: (event: ChatEntryEvent) => void;
  /** Der Strom war weg: der Verlauf lädt neu, Entwurf und Auswahl bleiben. */
  onSync: () => void;
}

interface ChatScreenProps {
  session: SessionSummary;
  subscribeChat: (feed: ChatFeed) => () => void;
  onBack: () => void;
}

const STICK_TO_BOTTOM_PX = 120;
const NO_ENTRIES: readonly ChatEntry[] = [];

export function ChatScreen({ session, subscribeChat, onBack }: ChatScreenProps): ReactElement {
  const [chat, setChat] = useState<ChatState | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const loader = useRef<ChatLoader | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef<boolean>(true);
  const sessionId: string = session.id;

  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason: unknown) {
      setError(commandErrorText(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const current: ChatLoader = createChatLoader(sessionId, loadChat, controller.signal, setChat);
    loader.current = current;
    // Erst abonnieren, dann laden: ein Eintrag zwischen Seitenstand und Abo ginge sonst verloren.
    const unsubscribe: () => void = subscribeChat({
      onEntry: (event: ChatEntryEvent): void => {
        if (event.sessionId === sessionId) {
          current.receive(event.entry);
        }
      },
      onSync: current.loadLatest,
    });
    current.loadLatest();
    return (): void => {
      controller.abort();
      unsubscribe();
      loader.current = null;
    };
  }, [sessionId, subscribeChat]);

  const entries: readonly ChatEntry[] = chat?.entries ?? NO_ENTRIES;
  useLayoutEffect(() => {
    const element: HTMLDivElement | null = timeline.current;
    if (element !== null && stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [entries]);

  function onScroll(): void {
    const element: HTMLDivElement | null = timeline.current;
    if (element !== null) {
      stickToBottom.current =
        element.scrollHeight - element.scrollTop - element.clientHeight < STICK_TO_BOTTOM_PX;
    }
  }

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text: string = draft.trim();
    if (text === '') {
      return;
    }
    stickToBottom.current = true;
    void run(async (): Promise<void> => {
      await sendText(sessionId, text);
      setDraft('');
    });
  }

  function answerQuestion(requestId: string, questionAnswer: QuestionAnswer): void {
    void run((): Promise<void> => answer(sessionId, requestId, questionAnswer));
  }

  const canPause: boolean = ['starting', 'running', 'waiting'].includes(session.status);
  const canResume: boolean = session.status === 'paused';
  const chatError: string | null = chat?.loadError ?? chat?.olderError ?? null;
  return (
    <div className="chat-screen">
      <header className="chat-screen__header">
        <button className="chat-screen__back" type="button" onClick={onBack} aria-label="Zurück">
          ‹
        </button>
        <div className="chat-screen__title">
          <span className="chat-screen__name">
            #{session.number} {session.name}
          </span>
          <span className="chat-screen__status">{STATUS_LABEL[session.status]}</span>
        </div>
        {canPause && (
          <button
            className="chat-screen__action"
            type="button"
            disabled={busy}
            onClick={(): void => {
              void run((): Promise<void> => pause(sessionId));
            }}
          >
            Pause
          </button>
        )}
        {canResume && (
          <button
            className="chat-screen__action"
            type="button"
            disabled={busy}
            onClick={(): void => {
              void run((): Promise<void> => resume(sessionId));
            }}
          >
            Weiter
          </button>
        )}
      </header>
      <div className="chat-screen__timeline" ref={timeline} onScroll={onScroll}>
        {chat?.hasMore === true && (
          <button
            className="chat-screen__older"
            type="button"
            disabled={chat.loadingOlder}
            onClick={(): void => {
              stickToBottom.current = false;
              loader.current?.loadOlder();
            }}
          >
            Ältere laden
          </button>
        )}
        {entries.map((entry: ChatEntry) => (
          <ChatEntryView key={entry.seq} entry={entry} disabled={busy} onAnswer={answerQuestion} />
        ))}
      </div>
      {(error ?? chatError) !== null && (
        <div className="chat-screen__error">{error ?? chatError}</div>
      )}
      <form className="chat-screen__composer" onSubmit={submit}>
        <textarea
          className="chat-screen__input"
          value={draft}
          rows={2}
          placeholder={session.status === 'waiting' ? 'Antwort …' : 'Nachricht …'}
          onChange={(event): void => {
            setDraft(event.target.value);
          }}
        />
        <button className="chat-screen__send" type="submit" disabled={busy || draft.trim() === ''}>
          Senden
        </button>
      </form>
    </div>
  );
}
