'use client';

/**
 * The three-layer checkpoint editor: clue (find it), challenge (prove you're
 * there), reveal (earn the story). The field set mirrors `Checkpoint` in
 * @ww/shared exactly — this form is the only place a human authors content, so
 * a field missing here is a field that silently ships empty.
 *
 * Two normalizations happen at the boundary rather than at publish time:
 *   - accepted answers are lowercased and trimmed as they are entered, because
 *     the server-side matcher compares against that form
 *   - `hint` is kept equal to the first hint tier, which is the invariant the
 *     domain type documents
 */

import { useCallback, useRef, useState } from 'react';
import type { Checkpoint, HistoricalSource } from '@ww/shared';
import { CHALLENGE_KINDS } from '@/lib/creatorDraft';

export interface CheckpointFormProps {
  checkpoint: Checkpoint;
  isFinalDestination: boolean;
  onChange: (patch: Partial<Checkpoint>) => void;
  onDelete: () => void;
  onMakeFinalDestination: () => void;
}

/** Reference images are grounding material, not photographs — 800px is plenty,
 *  and small matters because the whole draft has to fit in localStorage. */
const REF_MAX_EDGE_PX = 800;
const REF_JPEG_QUALITY = 0.72;

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 40,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'inherit',
};

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        className="muted"
        style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', marginBottom: 4, textTransform: 'uppercase' }}
      >
        {props.label}
      </span>
      {props.children}
      {props.hint && (
        <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
          {props.hint}
        </span>
      )}
    </label>
  );
}

function Section(props: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 2px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {props.title}
      </h3>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
        {props.caption}
      </p>
      {props.children}
    </section>
  );
}

function Text(props: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  if (props.rows) {
    return (
      <textarea
        value={props.value}
        rows={props.rows}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
      />
    );
  }
  return (
    <input
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      style={inputStyle}
    />
  );
}

function NumberField(props: { value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(props.value) ? props.value : 0}
      min={props.min}
      step={props.step ?? 1}
      onChange={(e) => props.onChange(Number(e.target.value))}
      style={inputStyle}
    />
  );
}

/** Chip input. Every value is stored lowercased + trimmed, per the matcher. */
function AnswerTags({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [pending, setPending] = useState('');

  const commit = useCallback(
    (raw: string) => {
      const next = raw.toLowerCase().trim();
      setPending('');
      if (!next || values.includes(next)) return;
      onChange([...values, next]);
    },
    [values, onChange],
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: values.length ? 6 : 0 }}>
        {values.map((v) => (
          <span key={v} className="badge" style={{ background: 'var(--surface-2)' }}>
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        value={pending}
        placeholder="Type an answer, press Enter"
        onChange={(e) => setPending(e.target.value)}
        onBlur={() => commit(pending)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit(pending);
          }
        }}
        style={inputStyle}
      />
    </div>
  );
}

function HintRows({
  hints,
  onChange,
}: {
  hints: Array<{ text: string; costXp: number }>;
  onChange: (next: Array<{ text: string; costXp: number }>) => void;
}) {
  const patch = (i: number, part: Partial<{ text: string; costXp: number }>) =>
    onChange(hints.map((h, idx) => (idx === i ? { ...h, ...part } : h)));

  return (
    <div>
      {hints.map((h, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={h.text}
            placeholder={i === 0 ? 'Tier 1 — a nudge' : 'Tier 2 — nearly a giveaway'}
            onChange={(e) => patch(i, { text: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            type="number"
            value={h.costXp}
            title="XP cost (negative)"
            onChange={(e) => patch(i, { costXp: Number(e.target.value) })}
            style={{ ...inputStyle, width: 84 }}
          />
          <button className="btn" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => onChange(hints.filter((_, idx) => idx !== i))}>
            ×
          </button>
        </div>
      ))}
      <button
        className="btn"
        style={{ minHeight: 36, fontSize: 13 }}
        onClick={() => onChange([...hints, { text: '', costXp: hints.length === 0 ? -15 : -25 }])}
      >
        + Add hint tier
      </button>
    </div>
  );
}

function SourceRows({
  sources,
  onChange,
}: {
  sources: HistoricalSource[];
  onChange: (next: HistoricalSource[]) => void;
}) {
  const patch = (i: number, part: Partial<HistoricalSource>) =>
    onChange(sources.map((s, idx) => (idx === i ? { ...s, ...part } : s)));

  return (
    <div>
      {sources.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={s.title}
            placeholder="Source title"
            onChange={(e) => patch(i, { title: e.target.value })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            value={s.url ?? ''}
            placeholder="https://…"
            onChange={(e) => patch(i, { url: e.target.value || undefined })}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button className="btn" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => onChange(sources.filter((_, idx) => idx !== i))}>
            ×
          </button>
        </div>
      ))}
      <button
        className="btn"
        style={{ minHeight: 36, fontSize: 13 }}
        onClick={() => onChange([...sources, { title: '' }])}
      >
        + Add source
      </button>
    </div>
  );
}

/** Downscale and re-encode — same approach as PhotoCapture, smaller budget. */
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, REF_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', REF_JPEG_QUALITY);
}

function ReferenceImage({ url, onChange }: { url?: string; onChange: (v: string | undefined) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onChange(await downscale(file));
    } catch {
      setError('Could not read that image.');
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void handle(e.target.files?.[0])}
      />
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Reference"
          style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)', marginBottom: 6, display: 'block' }}
        />
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn" style={{ minHeight: 36, fontSize: 13, flex: 1 }} onClick={() => inputRef.current?.click()}>
          {url ? 'Replace image' : '+ Upload reference image'}
        </button>
        {url && (
          <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => onChange(undefined)}>
            Remove
          </button>
        )}
      </div>
      {error && <p style={{ color: 'var(--bad)', fontSize: 12 }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function CheckpointForm(props: CheckpointFormProps) {
  const cp = props.checkpoint;
  const set = props.onChange;
  const hints = cp.hints ?? [];

  // `hint` is the always-present first tier (see the Checkpoint docs); keeping
  // it derived means the two can never disagree.
  const setHints = (next: Array<{ text: string; costXp: number }>) =>
    set({ hints: next, hint: next[0]?.text ?? '' });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 17, margin: 0, flex: 1, minWidth: 140 }}>
          {cp.name.trim() || 'Untitled checkpoint'}
        </h2>
        {props.isFinalDestination ? (
          <span className="badge mock">★ shared finish</span>
        ) : (
          <button className="btn" style={{ minHeight: 34, fontSize: 12 }} onClick={props.onMakeFinalDestination}>
            Make shared finish
          </button>
        )}
        <button
          className="btn"
          style={{ minHeight: 34, fontSize: 12, color: 'var(--bad)' }}
          onClick={props.onDelete}
        >
          Delete
        </button>
      </div>

      <Section title="Identity" caption="The name is shown only after completion — never in the clue.">
        <Field label="Name">
          <Text value={cp.name} onChange={(v) => set({ name: v })} placeholder="Smithfield Street Bridge" />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label="Latitude">
              <NumberField value={cp.latitude} step={0.0001} onChange={(v) => set({ latitude: v })} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Longitude">
              <NumberField value={cp.longitude} step={0.0001} onChange={(v) => set({ longitude: v })} />
            </Field>
          </div>
        </div>
        <Field label="Real-world location" hint="Plain language, for creators and support. Not shown to players.">
          <Text value={cp.realWorldLocation ?? ''} onChange={(v) => set({ realWorldLocation: v || undefined })} />
        </Field>
        <Field label="Accessibility" hint="Terrain, traffic, seasonality — shown before the player sets off.">
          <Text value={cp.accessibility ?? ''} onChange={(v) => set({ accessibility: v || undefined })} />
        </Field>
      </Section>

      <Section title="Layer 1 — the clue" caption="Find it. Never name the landmark outright.">
        <Field label="Clue">
          <Text rows={4} value={cp.clue} onChange={(v) => set({ clue: v })} />
        </Field>
        <Field label="Hint tiers" hint="Tier 1 nudges; tier 2 nearly gives it away. Costs are negative XP.">
          <HintRows hints={hints} onChange={setHints} />
        </Field>
      </Section>

      <Section title="Layer 2 — the challenge" caption="Prove you're there. Verified server-side against the photo.">
        <Field label="Challenge kind">
          <select value={cp.challengeKind} onChange={(e) => set({ challengeKind: e.target.value as Checkpoint['challengeKind'] })} style={inputStyle}>
            {CHALLENGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observation question">
          <Text rows={2} value={cp.observationQuestion} onChange={(v) => set({ observationQuestion: v })} />
        </Field>
        <Field label="Accepted answers" hint="Stored lowercase and trimmed. Add every reasonable phrasing.">
          <AnswerTags values={cp.acceptedAnswers} onChange={(v) => set({ acceptedAnswers: v })} />
        </Field>
        <Field label="Photo requirement">
          <Text rows={2} value={cp.photoRequirement} onChange={(v) => set({ photoRequirement: v })} />
        </Field>
        <Field label="Landmark description" hint="Grounding text handed to the verifier. Describe what it should see.">
          <Text rows={3} value={cp.landmarkDescription} onChange={(v) => set({ landmarkDescription: v })} />
        </Field>
        <Field
          label="Confidence concerns (optional)"
          hint="Known failure modes — bad angles, night, seasonal features. Lowers confidence instead of hard-failing an honest player."
        >
          <Text rows={2} value={cp.confidenceConcerns ?? ''} onChange={(v) => set({ confidenceConcerns: v || undefined })} />
        </Field>
        <Field label="Reference image" hint="Visual grounding for landmark matching. Downscaled to 800px on upload.">
          <ReferenceImage url={cp.referenceImageUrl} onChange={(v) => set({ referenceImageUrl: v })} />
        </Field>
      </Section>

      <Section title="Layer 3 — the reveal" caption="Earn the story. Cite a source; label uncertain claims as legend.">
        <Field label="Historical reveal">
          <Text rows={6} value={cp.historicalReveal} onChange={(v) => set({ historicalReveal: v })} />
        </Field>
        <Field label="Sources" hint="At least one. A reveal without a citation does not ship.">
          <SourceRows sources={cp.sources} onChange={(v) => set({ sources: v })} />
        </Field>
        <Field label="Hidden detail (optional)" hint="Worth bonus XP if the player notices it.">
          <Text rows={2} value={cp.hiddenDetail ?? ''} onChange={(v) => set({ hiddenDetail: v || undefined })} />
        </Field>
        <Field label="Audio narration script (optional)" hint="One sentence, for ElevenLabs narration.">
          <Text rows={2} value={cp.audioShort ?? ''} onChange={(v) => set({ audioShort: v || undefined })} />
        </Field>
      </Section>

      <Section title="Scoring + geofence" caption="Expected time drives the speed bonus — it must include the walk from the previous stop.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 90px' }}>
            <Field label="Radius (m)">
              <NumberField value={cp.radiusMeters} min={5} onChange={(v) => set({ radiusMeters: v })} />
            </Field>
          </div>
          <div style={{ flex: '1 1 90px' }}>
            <Field label="Base XP">
              <NumberField value={cp.baseXp} min={0} step={5} onChange={(v) => set({ baseXp: v })} />
            </Field>
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <Field label="Expected seconds" hint={`${Math.round(cp.expectedCompletionSeconds / 60)} min`}>
              <NumberField
                value={cp.expectedCompletionSeconds}
                min={30}
                step={30}
                onChange={(v) => set({ expectedCompletionSeconds: v })}
              />
            </Field>
          </div>
        </div>
      </Section>
    </div>
  );
}
