import type { ReactElement } from 'react';
import { StatusIcon } from '@/components/StatusIcon';
import { STATUS_LABEL, displayStatus, metaLine } from '@/features/sessions/sessionStatus';
import type { ProjectSummary } from '@/lib/bindings/ProjectSummary';
import type { SessionSummary } from '@/lib/bindings/SessionSummary';
import './SessionList.css';

interface SessionListProps {
  projects: readonly ProjectSummary[];
  sessions: readonly SessionSummary[];
  onOpen: (sessionId: string) => void;
}

interface ProjectGroup {
  project: ProjectSummary;
  sessions: SessionSummary[];
}

function groupByProject(
  projects: readonly ProjectSummary[],
  sessions: readonly SessionSummary[],
): ProjectGroup[] {
  return projects
    .map((project: ProjectSummary) => ({
      project,
      sessions: sessions
        .filter((session: SessionSummary) => session.projectId === project.id)
        .sort((left: SessionSummary, right: SessionSummary) => right.number - left.number),
    }))
    .filter((group: ProjectGroup) => group.sessions.length > 0)
    .sort(
      (left: ProjectGroup, right: ProjectGroup) =>
        latestActivity(right.sessions) - latestActivity(left.sessions),
    );
}

function latestActivity(sessions: readonly SessionSummary[]): number {
  return Math.max(...sessions.map((session: SessionSummary) => session.lastActivityAt));
}

export function SessionList({ projects, sessions, onOpen }: SessionListProps): ReactElement {
  const groups: ProjectGroup[] = groupByProject(projects, sessions);
  const waiting: SessionSummary[] = groups.flatMap((group: ProjectGroup) =>
    group.sessions.filter((session: SessionSummary) => session.status === 'waiting'),
  );

  function row(session: SessionSummary, project: string | null): ReactElement {
    const meta: string | null = metaLine(session);
    return (
      <li key={session.id}>
        <button
          className="session-list__row"
          type="button"
          onClick={(): void => {
            onOpen(session.id);
          }}
        >
          <StatusIcon status={displayStatus(session, sessions)} size={14} />
          <span className="session-list__text">
            <span className="session-list__name">
              {project === null ? '' : `${project} › `}#{session.number} {session.name}
            </span>
            <span className="session-list__meta">{meta ?? STATUS_LABEL[session.status]}</span>
          </span>
          {session.unread && <span className="session-list__unread" aria-label="ungelesen" />}
        </button>
      </li>
    );
  }

  if (groups.length === 0) {
    return <p className="session-list__empty">Keine Sessions.</p>;
  }
  return (
    <div className="session-list">
      {waiting.length > 0 && (
        <section className="session-list__group session-list__group--waiting">
          <h2 className="session-list__heading">Wartet auf dich</h2>
          <ul className="session-list__rows">
            {waiting.map((session: SessionSummary) =>
              row(
                session,
                projects.find((project: ProjectSummary) => project.id === session.projectId)
                  ?.name ?? null,
              ),
            )}
          </ul>
        </section>
      )}
      {groups.map((group: ProjectGroup) => (
        <section className="session-list__group" key={group.project.id}>
          <h2 className="session-list__heading">{group.project.name}</h2>
          <ul className="session-list__rows">
            {group.sessions.map((session: SessionSummary) => row(session, null))}
          </ul>
        </section>
      ))}
    </div>
  );
}
