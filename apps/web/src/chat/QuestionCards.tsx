import { useEffect, useState } from 'react';
import type { TranscriptCard } from './presentation';
import { CircleHelp } from 'lucide-react';
import type { BotBridgeClient } from '@hermes-client/protocol';
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
}: {
  client: BotBridgeClient;
  sessionId: string;
  request: QuestionRequest;
  question: QuestionRequest['questions'][number];
  onAnswer: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<'answered' | 'expired'>();
  const name = question.id;
  const choices = question.choices;
  async function respond(answer: string | string[] | null) {
    if (busy || submitted) return;
    setBusy(true);
    setError('');
    try {
      const state = await new RequestDomain(client).answer(sessionId, request.id, name, answer);
      setSubmitted(state);
      onAnswer();
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
          {submitted === 'expired' ? 'Question expired' : 'Answer submitted'}
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
              <QuestionnaireChoices>
                {choices.map((choice) => (
                  <QuestionnaireChoice key={choice} value={choice}>
                    {choice}
                  </QuestionnaireChoice>
                ))}
              </QuestionnaireChoices>
            )}
            <QuestionnaireInput
              aria-label="Your answer"
              placeholder={choices.length ? 'Other answer' : 'Your answer'}
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
}: {
  client: BotBridgeClient | undefined;
  sessionId: string | undefined;
  version: number;
}): TranscriptCard[] {
  const [batch, setBatch] = useState<{ sessionId: string; requests: QuestionRequest[] }>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!client || !sessionId) return;
    const connection = client,
      session = sessionId;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await new RequestDomain(connection).questions(session);
        if (active) setBatch({ sessionId: session, requests: data });
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
  }, [client, sessionId, version, refresh]);
  if (!client || !sessionId) return [];
  const requests = batch?.sessionId === sessionId ? batch.requests : [];
  return requests.flatMap((request) =>
    request.questions
      .filter((question) => !question.answered)
      .map((question) => ({
        id: 'question:' + request.id + ':' + question.id,
        content: (
          <Question
            key={request.id + ':' + question.id}
            client={client}
            sessionId={sessionId}
            request={request}
            question={question}
            onAnswer={() => setRefresh((n) => n + 1)}
          />
        ),
      })),
  );
}
