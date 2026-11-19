import type { ReactElement } from 'react';
import { Markdown } from '@/components/Markdown';
import type { ChatEntry } from '@/lib/bindings/ChatEntry';
import type { Notice } from '@/lib/bindings/Notice';
import type { QuestionAnswer } from '@/lib/bindings/QuestionAnswer';
import type { TodoItem } from '@/lib/bindings/TodoItem';
import type { TodoState } from '@/lib/bindings/TodoState';
import type { ToolState } from '@/lib/bindings/ToolState';
import { QuestionCard } from '@/mobile/QuestionCard';
import './ChatEntryView.css';

interface ChatEntryViewProps {
  entry: ChatEntry;
  disabled: boolean;
  onAnswer: (requestId: string, answer: QuestionAnswer) => void;
}

const TOOL_MARK: Record<ToolState, string> = {
  running: '◌',
  done: '✓',
  failed: '✗',
  interrupted: '–',
};

const TODO_MARK: Record<TodoState, string> = {
  done: '✓',
  active: '▸',
  todo: '○',
};

function noticeText(notice: Notice): string | null {
  switch (notice.kind) {
    case 'compacted':
      return 'Kontext zusammengefasst';
    case 'modelSwitched':
      return 'Modell gewechselt';
    case 'modelFallback':
      return `Ausgewichen auf ${notice.fallbackModel}`;
    case 'info':
      return notice.text;
    case 'modeChanged':
      return 'Modus gewechselt';
    case 'reportUpdated':
      return 'Lagebericht aktualisiert';
    case 'turnSummary':
      return null;
  }
}

export function ChatEntryView({
  entry,
  disabled,
  onAnswer,
}: ChatEntryViewProps): ReactElement | null {
  switch (entry.kind) {
    case 'user':
      return <div className="chat-entry chat-entry--user">{entry.text}</div>;
    case 'text':
      return (
        <div className="chat-entry chat-entry--text">
          <Markdown text={entry.text} />
        </div>
      );
    case 'thinking':
      return (
        <details className="chat-entry chat-entry--thinking">
          <summary>Gedacht · {entry.seconds} s</summary>
          {entry.text}
        </details>
      );
    case 'tool':
      return (
        <div className={`chat-entry chat-entry--tool chat-entry--tool-${entry.state}`}>
          {TOOL_MARK[entry.state]} {entry.tool}{' '}
          <span className="chat-entry__target">{entry.target}</span>
        </div>
      );
    case 'todos':
      return (
        <ul className="chat-entry chat-entry--todos">
          {entry.items.map((item: TodoItem, index: number) => (
            <li key={index} className={`chat-entry__todo chat-entry__todo--${item.state}`}>
              {TODO_MARK[item.state]} {item.label}
            </li>
          ))}
        </ul>
      );
    case 'artifact':
      return <div className="chat-entry chat-entry--notice">Artefakt: {entry.file}</div>;
    case 'question':
      return <QuestionCard entry={entry} disabled={disabled} onAnswer={onAnswer} />;
    case 'error':
      return (
        <div className="chat-entry chat-entry--error">
          <strong>{entry.title}</strong> {entry.text}
        </div>
      );
    case 'notice': {
      const text: string | null = noticeText(entry.notice);
      return text === null ? null : <div className="chat-entry chat-entry--notice">{text}</div>;
    }
  }
}
