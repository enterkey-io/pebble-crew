import { useEffect, useRef, useState } from 'react';
import type { TranscriptCard } from './presentation';
import { CircleHelp } from 'lucide-react';
import type { SessionClient } from '@hermes-client/protocol';
import { RequestDomain, type QuestionRequest } from '@hermes-client/protocol';
import { ApprovalSurface } from '../components/ai-elements/confirmation';
import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireTitle,
  QuestionnaireChoices,
  QuestionnaireChoice,
  QuestionnaireInput,
  QuestionnaireActions,
  QuestionnaireSubmit,
} from '../components/ui/questionnaire';
import { Button } from '../components/ui/button';
import { Notice } from '../ui/primitives';

function Question({
  client,
  sessionId,
  request,
  question,
  onAnswer,
  draft,
  onDraft,
  outcome,
}: {
  client: SessionClient;
  sessionId: string;
  request: QuestionRequest;
  question: QuestionRequest['questions'][number];
  onAnswer: (state: 'answered' | 'expired') => void;
  draft: { text: string; choices: string[] };
  onDraft: (value: { text: string; choices: string[] }) => void;
  outcome: 'answered' | 'expired' | 'inactive' | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitted = outcome;
  const name = question.id;
  const choices = question.choices;
  async function respond(answer: string | string[] | null) {
    if (busy || submitted) return;
    setBusy(true);
    setError('');
    try {
      const state = await new RequestDomain(client).answer(sessionId, request.id, name, answer);
      onAnswer(state);
    } catch {
      setError('Your answer could not be confirmed. Check the conversation before trying again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <ApprovalSurface title="Question" description="" icon={CircleHelp}>
      {submitted ? (
        <p role="status" className="text-sm text-muted-foreground">
          {submitted === 'expired'
            ? 'Question expired'
            : submitted === 'inactive'
              ? 'Question no longer pending'
              : 'Answer submitted'}
        </p>
      ) : (
        <Questionnaire
          items={[{ name, choices: choices.map((value) => ({ value })) }]}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget)
              .getAll(name)
              .filter((value): value is string => typeof value === 'string' && !!value.trim());
            if (values.length) void respond(question.multiple ? values : (values.at(-1) ?? null));
          }}
        >
          <QuestionnaireItem name={name} multiple={question.multiple} disabled={busy}>
            <QuestionnaireTitle>{question.title}</QuestionnaireTitle>
            {!!choices.length && (
              <QuestionnaireChoices className="max-h-[22dvh] overflow-y-auto overscroll-contain">
                {choices.map((choice) => (
                  <QuestionnaireChoice
                    key={choice}
                    value={choice}
                    checked={draft.choices.includes(choice)}
                    onChange={(event) =>
                      onDraft({
                        ...draft,
                        choices: question.multiple
                          ? event.target.checked
                            ? [...draft.choices, choice]
                            : draft.choices.filter((value) => value !== choice)
                          : [choice],
                      })
                    }
                  >
                    {choice}
                  </QuestionnaireChoice>
                ))}
              </QuestionnaireChoices>
            )}
            <QuestionnaireInput
              aria-label="Your answer"
              placeholder={choices.length ? 'Other answer' : 'Your answer'}
              value={draft.text}
              onChange={(event) => onDraft({ ...draft, text: event.target.value })}
              maxLength={4000}
            />
            {error && <Notice error>{error}</Notice>}
            <QuestionnaireActions>
              <Button variant="quiet" disabled={busy} onClick={() => void respond(null)}>
                Skip
              </Button>
              <QuestionnaireSubmit disabled={busy}>Submit</QuestionnaireSubmit>
            </QuestionnaireActions>
          </QuestionnaireItem>
        </Questionnaire>
      )}
    </ApprovalSurface>
  );
}

export function useQuestionCards({
  client,
  sessionId,
  version,
  scope,
}: {
  client: SessionClient | undefined;
  sessionId: string | undefined;
  version: number;
  scope: string | undefined;
}): TranscriptCard[] {
  const [, setBatch] = useState<{
    scope: string | undefined;
    sessionId: string;
    requests: QuestionRequest[];
  }>();
  const [refresh, setRefresh] = useState(0);
  const snapshots = useRef(new Map<string, QuestionRequest[]>());
  const [, render] = useState(0);
  const drafts = useRef(new Map<string, { text: string; choices: string[] }>());
  const outcomes = useRef(new Map<string, 'answered' | 'expired' | 'inactive'>());
  const owner = useRef(scope);
  if (owner.current !== scope) {
    owner.current = scope;
    drafts.current.clear();
    snapshots.current.clear();
    outcomes.current.clear();
  }
  useEffect(() => {
    if (!client || !sessionId) return;
    const connection = client,
      session = sessionId;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await new RequestDomain(connection).questions(session);
        if (active)
          setBatch(() => {
            const saved = snapshots.current.get(scope + ':' + session) ?? [];
            const missing = saved.filter((row) => !data.some((next) => next.id === row.id));
            for (const request of missing)
              for (const question of request.questions) {
                const key = scope + ':' + session + ':' + request.id + ':' + question.id;
                if (!outcomes.current.has(key)) outcomes.current.set(key, 'inactive');
              }
            const merged = [...data, ...missing];
            snapshots.current.set(scope + ':' + session, merged);
            return { scope, sessionId: session, requests: merged };
          });
      } catch {
        /* Pending cards remain usable across stream restoration. */
      } finally {
        if (active) timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [client, scope, sessionId, version, refresh]);
  if (!client || !sessionId) return [];
  const requests = snapshots.current.get(scope + ':' + sessionId) ?? [];
  return requests.flatMap((request) =>
    request.questions.map((question) => {
      const key = scope + ':' + sessionId + ':' + request.id + ':' + question.id;
      const outcome = outcomes.current.get(key) ?? (question.answered ? 'answered' : undefined);
      return {
        id: 'question:' + request.id + ':' + question.id,
        needsInput: !outcome,
        content: (
          <Question
            key={key}
            client={client}
            sessionId={sessionId}
            request={request}
            question={question}
            draft={drafts.current.get(key) ?? { text: '', choices: [] }}
            outcome={outcome}
            onDraft={(value) => {
              drafts.current.set(key, value);
              render((n) => n + 1);
            }}
            onAnswer={(state) => {
              outcomes.current.set(key, state);
              drafts.current.delete(key);
              setRefresh((n) => n + 1);
            }}
          />
        ),
      };
    }),
  );
}
