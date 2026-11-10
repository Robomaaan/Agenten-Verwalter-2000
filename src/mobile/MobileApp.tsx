import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ChatEntryEvent } from '@/lib/bindings/ChatEntryEvent';
import type { ProjectSummary } from '@/lib/bindings/ProjectSummary';
import type { SessionSummary } from '@/lib/bindings/SessionSummary';
import { NotSignedInError, connectEvents, loadProjects, loadSessions, signIn } from '@/mobile/api';
import { ChatScreen } from '@/mobile/ChatScreen';
import type { ChatFeed } from '@/mobile/ChatScreen';
import { LoginScreen } from '@/mobile/LoginScreen';
import { SessionList } from '@/mobile/SessionList';
import './MobileApp.css';

type SignIn = 'checking' | 'signedOut' | 'signedIn';

const KEY_HASH_PREFIX = '#k=';
const SESSION_STATE_KEY = 'sessionId';

function replaceById<T extends { id: string }>(items: readonly T[], next: T): T[] {
  return items.some((item: T) => item.id === next.id)
    ? items.map((item: T) => (item.id === next.id ? next : item))
    : [...items, next];
}

function sessionFromHistory(): string | null {
  const state: unknown = window.history.state;
  if (typeof state === 'object' && state !== null && SESSION_STATE_KEY in state) {
    const value: unknown = (state as Record<string, unknown>)[SESSION_STATE_KEY];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/** Meldet mit `…/mobile.html#k=<Schlüssel>` an; der Schlüssel verlässt die Adresszeile sofort wieder. */
async function consumeKeyFromUrl(): Promise<void> {
  const hash: string = window.location.hash;
  if (!hash.startsWith(KEY_HASH_PREFIX)) {
    return;
  }
  window.history.replaceState(window.history.state, '', window.location.pathname);
  await signIn(decodeURIComponent(hash.slice(KEY_HASH_PREFIX.length))).catch((): void => undefined);
}

export function MobileApp(): ReactElement {
  const [signedIn, setSignedIn] = useState<SignIn>('checking');
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [openSessionId, setOpenSessionId] = useState<string | null>(sessionFromHistory);
  const [loadError, setLoadError] = useState<string | null>(null);
  const chatFeeds = useRef<Set<ChatFeed>>(new Set());

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [nextProjects, nextSessions] = await Promise.all([loadProjects(), loadSessions()]);
      setProjects(nextProjects);
      setSessions(nextSessions);
      setLoadError(null);
      setSignedIn('signedIn');
    } catch (error: unknown) {
      if (error instanceof NotSignedInError) {
        setSignedIn('signedOut');
        return;
      }
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void consumeKeyFromUrl().then(reload);
  }, [reload]);

  useEffect(() => {
    if (signedIn !== 'signedIn') {
      return undefined;
    }
    return connectEvents({
      onSession: (summary: SessionSummary): void => {
        setSessions((previous: SessionSummary[]) => replaceById(previous, summary));
      },
      onProject: (project: ProjectSummary): void => {
        setProjects((previous: ProjectSummary[]) => replaceById(previous, project));
      },
      onChat: (event: ChatEntryEvent): void => {
        chatFeeds.current.forEach((feed: ChatFeed) => {
          feed.onEntry(event);
        });
      },
      onSync: (): void => {
        void reload();
        chatFeeds.current.forEach((feed: ChatFeed) => {
          feed.onSync();
        });
      },
    });
  }, [signedIn, reload]);

  useEffect(() => {
    function onPopState(): void {
      setOpenSessionId(sessionFromHistory());
    }
    window.addEventListener('popstate', onPopState);
    return (): void => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const subscribeChat = useCallback((feed: ChatFeed): (() => void) => {
    chatFeeds.current.add(feed);
    return (): void => {
      chatFeeds.current.delete(feed);
    };
  }, []);

  function openSession(sessionId: string): void {
    window.history.pushState({ [SESSION_STATE_KEY]: sessionId }, '');
    setOpenSessionId(sessionId);
  }

  function closeSession(): void {
    window.history.back();
  }

  async function submitKey(key: string): Promise<void> {
    await signIn(key);
    await reload();
  }

  if (signedIn === 'checking') {
    return (
      <div className="mobile-app mobile-app--center">
        {loadError === null ? (
          'Verbinde …'
        ) : (
          <>
            <p>{loadError}</p>
            <button
              className="mobile-app__retry"
              type="button"
              onClick={(): void => {
                void reload();
              }}
            >
              Erneut versuchen
            </button>
          </>
        )}
      </div>
    );
  }
  if (signedIn === 'signedOut') {
    return <LoginScreen onSubmit={submitKey} />;
  }
  const openedSession: SessionSummary | undefined = sessions.find(
    (session: SessionSummary) => session.id === openSessionId,
  );
  return (
    <div className="mobile-app">
      {loadError !== null && <div className="mobile-app__error">{loadError}</div>}
      {openedSession === undefined ? (
        <SessionList projects={projects} sessions={sessions} onOpen={openSession} />
      ) : (
        <ChatScreen session={openedSession} subscribeChat={subscribeChat} onBack={closeSession} />
      )}
    </div>
  );
}
