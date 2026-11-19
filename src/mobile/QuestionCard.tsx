import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  draftAnswer,
  emptyDraft,
  isComplete,
  needsSubmit,
  optionName,
  pickOption,
  questionHeader,
} from '@/features/chat/questionDraft';
import type { PickResult, QuestionDraft, QuestionEntry } from '@/features/chat/questionDraft';
import type { Question } from '@/lib/bindings/Question';
import type { QuestionAnswer } from '@/lib/bindings/QuestionAnswer';
import type { QuestionOption } from '@/lib/bindings/QuestionOption';
import './QuestionCard.css';

interface QuestionCardProps {
  entry: QuestionEntry;
  disabled: boolean;
  onAnswer: (requestId: string, answer: QuestionAnswer) => void;
}

export function QuestionCard({ entry, disabled, onAnswer }: QuestionCardProps): ReactElement {
  const [draft, setDraft] = useState<QuestionDraft>(() => emptyDraft(entry));

  if (entry.answer !== null) {
    return (
      <div className="question-card question-card--answered">
        {entry.questions[0]?.question} <strong>{entry.answer}</strong>
      </div>
    );
  }

  function pick(questionIndex: number, optionIndex: number): void {
    const result: PickResult | null = pickOption(entry, draft, questionIndex, optionIndex);
    if (result === null) {
      return;
    }
    if (result.kind === 'answer') {
      onAnswer(entry.requestId, result.answer);
      return;
    }
    setDraft(result.draft);
  }

  const isPermission: boolean = entry.questionKind === 'permission';
  const needsButton: boolean = !isPermission && needsSubmit(entry, draft);
  return (
    <div className="question-card">
      {entry.questions.map((question: Question, questionIndex: number) => {
        const chosen: readonly string[] = draft.labels[questionIndex] ?? [];
        return (
          <div className="question-card__question" key={questionIndex}>
            <div className="question-card__header">{questionHeader(question, questionIndex)}</div>
            <div className="question-card__text">{question.question}</div>
            <div className="question-card__options">
              {question.options.map((option: QuestionOption, optionIndex: number) => {
                const name: string = optionName(option.label).name;
                return (
                  <button
                    key={optionIndex}
                    type="button"
                    disabled={disabled}
                    className={`question-card__option${chosen.includes(name) ? ' question-card__option--chosen' : ''}`}
                    onClick={(): void => {
                      pick(questionIndex, optionIndex);
                    }}
                  >
                    <span>{name}</span>
                    {option.hint !== '' && (
                      <span className="question-card__hint">{option.hint}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {needsButton && (
        <button
          className="question-card__submit"
          type="button"
          disabled={disabled || !isComplete(entry, draft)}
          onClick={(): void => {
            onAnswer(entry.requestId, draftAnswer(draft));
          }}
        >
          Antworten
        </button>
      )}
    </div>
  );
}
