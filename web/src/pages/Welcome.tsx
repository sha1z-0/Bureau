import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { api, put, type Onboarding, type OnboardingStep } from '../api';
import { go } from '../App';
import { Btn, useToast } from '../ui';
import { AnswerBankEditor, GithubPreview, LearningListEditor, LinksEditor, VoiceBankEditor } from '../editors';
import { CvUpload } from './Profile';
import { ApiKeyCard, ImapCard, SmtpCard, TelegramCard } from './Settings';
import { CampaignEditor } from './Campaigns';

interface StepDef {
  id: OnboardingStep;
  label: string;
  title: string;
  why: string;
  body: () => React.JSX.Element;
}

const STEPS: StepDef[] = [
  {
    id: 'cv',
    label: 'Your CV',
    title: 'Start with your CV',
    why: 'Bureau reads it once to build your profile. It is the source of truth: letters may rephrase it, never add to it.',
    body: () => <CvUpload bare />,
  },
  {
    id: 'links',
    label: 'Links',
    title: 'Where your work lives',
    why: 'Forms ask for these, and your GitHub and portfolio become evidence with a source behind every line.',
    body: () => <LinksEditor compact />,
  },
  {
    id: 'github',
    label: 'GitHub',
    title: 'What your GitHub shows',
    why: 'A preview of what Bureau reads from your public repos. Each fact it records keeps a link to where it came from.',
    body: () => <GithubPreview />,
  },
  {
    id: 'voice',
    label: 'Voice bank',
    title: 'Your own words',
    why: 'Letters are built by editing these passages, so they keep sounding like you.',
    body: () => <VoiceBankEditor />,
  },
  {
    id: 'answers',
    label: 'Answer bank',
    title: 'Answers forms always ask for',
    why: 'Fill what applies. Anything new a form asks comes to you as a question, never a guess.',
    body: () => <AnswerBankEditor />,
  },
  {
    id: 'learning',
    label: 'Learning list',
    title: 'What you are learning now',
    why: 'Honest stretch framing: a skill you are learning can be named as one, never claimed as known.',
    body: () => <LearningListEditor />,
  },
  {
    id: 'apikey',
    label: 'Claude API key',
    title: 'Connect Claude',
    why: 'Bureau scores, writes and checks with your own key. It is encrypted on this computer and never shown again.',
    body: () => <ApiKeyCard bare />,
  },
  {
    id: 'mailbox',
    label: 'Mailbox',
    title: 'A mailbox for the hunt',
    why: 'Use a dedicated job-search address. Bureau sends email applications over SMTP and reads replies over IMAP.',
    body: () => (
      <div className="stack" style={{ gap: 'var(--s-6)' }}>
        <SmtpCard bare />
        <ImapCard bare />
      </div>
    ),
  },
  {
    id: 'telegram',
    label: 'Telegram',
    title: 'Hear about interviews at once',
    why: 'Interview alerts, the daily digest and new questions reach your phone, and /stop works from anywhere.',
    body: () => <TelegramCard bare />,
  },
  {
    id: 'campaign',
    label: 'First campaign',
    title: 'Your first campaign',
    why: 'It rehearses first: every form is filled and checked but nothing is sent until the rehearsal days are over.',
    body: () => <></>,
  },
];

export default function Welcome() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['onboarding'], queryFn: () => api<Onboarding>('/api/onboarding') });
  const [step, setStep] = useState<OnboardingStep | null>(null);
  useEffect(() => {
    if (data && !step) setStep(data.current);
  }, [data, step]);
  const save = useMutation({
    mutationFn: (patch: { current?: OnboardingStep; complete?: OnboardingStep; skip?: OnboardingStep; done?: boolean }) => put<Onboarding>('/api/onboarding', patch),
    onSuccess: (o) => {
      qc.setQueryData(['onboarding'], o);
      qc.invalidateQueries({ queryKey: ['shell'] });
    },
    onError: toast.error,
  });

  if (!data || !step) return <div className="skeleton" style={{ height: 480 }} />;
  const i = STEPS.findIndex((s) => s.id === step);
  const def = STEPS[i];
  const next = STEPS[i + 1]?.id;
  const prev = STEPS[i - 1]?.id;
  const state = (id: OnboardingStep) => data.steps.find((s) => s.id === id)!;
  const doneCount = data.steps.filter((s) => s.completed || s.ready).length;
  const move = (to: OnboardingStep, patch: { complete?: OnboardingStep; skip?: OnboardingStep } = {}) => {
    setStep(to);
    save.mutate({ current: to, ...patch });
    window.scrollTo({ top: 0 });
  };
  const finish = (campaignId?: string) => {
    save.mutate(
      { complete: 'campaign', done: true },
      {
        onSuccess: () => {
          toast.success('Setup is done. You can reopen it from Profile any time.');
          go(campaignId ? `campaigns?id=${campaignId}` : 'overview');
        },
      },
    );
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Set up Bureau</h1>
          <p>Ten short steps. Each one is saved as you go, so you can stop and come back. Skip anything that doesn't apply.</p>
        </div>
        <div className="page-actions">
          <Btn variant="ghost" onClick={() => save.mutate({ done: true }, { onSuccess: () => go('overview') })}>
            Finish later
          </Btn>
        </div>
      </header>
      <div className="wizard">
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, n) => {
            const st = state(s.id);
            const ok = st.completed || st.ready;
            return (
              <li key={s.id}>
                <button type="button" aria-current={s.id === step ? 'step' : undefined} onClick={() => move(s.id)}>
                  <span className={`step-mark ${ok ? 'done' : ''}`}>{ok ? <Check /> : n + 1}</span>
                  <span>
                    {s.label}
                    {st.skipped && !ok ? <span className="faint"> (skipped)</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <section className="wizard-card" aria-labelledby="step-title" data-testid={`step-${step}`}>
          <div className="wizard-phone-progress">
            <span>
              Step {i + 1} of {STEPS.length}, {doneCount} done
            </span>
            <div className="progress-track">
              <i style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
            </div>
          </div>
          <header>
            <h2 id="step-title">{def.title}</h2>
            <p>{def.why}</p>
          </header>
          {def.id === 'campaign' ? <CampaignEditor onDone={(c) => finish(c.id)} startLabel="Start the rehearsal" /> : <def.body />}
          <div className="wizard-foot">
            {prev ? (
              <Btn variant="ghost" onClick={() => move(prev)}>
                <ArrowLeft /> Back
              </Btn>
            ) : null}
            <span className="spacer" />
            {def.id === 'campaign' ? (
              <Btn variant="ghost" onClick={() => finish()} data-testid="wizard-finish">
                Finish without a campaign
              </Btn>
            ) : (
              <>
                <Btn variant="ghost" onClick={() => next && move(next, { skip: def.id })} data-testid="wizard-skip">
                  Skip for now
                </Btn>
                <Btn variant="primary" onClick={() => next && move(next, { complete: def.id })} data-testid="wizard-next">
                  Continue <ArrowRight />
                </Btn>
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
