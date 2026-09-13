'use client';

/**
 * Route composition.
 *
 * The load-bearing rule here is the hunt-engine's: every route's
 * `checkpointIds` must END with the shared final destination, because
 * `assertSharedDestination()` infers the finish as the last id and throws at
 * route assignment when routes disagree. Rather than validating that after the
 * fact, the finish is rendered as a locked row that has no reorder controls and
 * cannot be unassigned — `normalize()` re-appends it after every edit.
 *
 * Reordering is up/down buttons on purpose. Drag-and-drop reordering is a
 * day of fiddly pointer-event work and buys nothing a creator cannot do here.
 */

import {
  HUNT_DURATIONS,
  HUNT_THEMES,
  routeCheckpointsOf,
  straightLineMeters,
  type CreatorDraft,
  type HuntMeta,
} from '@/lib/creatorDraft';

export interface RouteEditorProps {
  draft: CreatorDraft;
  activeRouteId: string | null;
  selectedCheckpointId: string | null;
  onSelectRoute: (routeId: string) => void;
  onSelectCheckpoint: (id: string) => void;
  onHuntChange: (patch: Partial<HuntMeta>) => void;
  onAddRoute: () => void;
  onRenameRoute: (routeId: string, label: string) => void;
  onRemoveRoute: (routeId: string) => void;
  onAssign: (routeId: string, checkpointId: string) => void;
  onUnassign: (routeId: string, checkpointId: string) => void;
  onReorder: (routeId: string, checkpointId: string, direction: -1 | 1) => void;
  onSetWalkingDistance: (routeId: string, meters: number | null) => void;
  onSetFinalDestination: (id: string | null) => void;
}

const small: React.CSSProperties = {
  width: '100%',
  minHeight: 36,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const iconBtn: React.CSSProperties = { minHeight: 28, padding: '0 8px', fontSize: 12, borderRadius: 8 };

function HuntMetaFields({ draft, onChange }: { draft: CreatorDraft; onChange: (p: Partial<HuntMeta>) => void }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <input
        value={draft.hunt.title}
        placeholder="Hunt title"
        onChange={(e) => onChange({ title: e.target.value })}
        style={{ ...small, fontSize: 16, fontWeight: 700, marginBottom: 8 }}
      />
      <textarea
        value={draft.hunt.description}
        rows={2}
        placeholder="One paragraph — what makes these routes different from each other?"
        onChange={(e) => onChange({ description: e.target.value })}
        style={{ ...small, marginBottom: 8, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          value={draft.hunt.city}
          placeholder="City"
          onChange={(e) => onChange({ city: e.target.value })}
          style={{ ...small, flex: '1 1 100px' }}
        />
        <select
          aria-label="Hunt theme"
          value={draft.hunt.theme}
          onChange={(e) => onChange({ theme: e.target.value as HuntMeta['theme'] })}
          style={{ ...small, flex: '1 1 120px' }}
        >
          {HUNT_THEMES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Hunt duration"
          value={draft.hunt.duration}
          onChange={(e) => onChange({ duration: e.target.value as HuntMeta['duration'] })}
          style={{ ...small, flex: '1 1 120px' }}
        >
          {HUNT_DURATIONS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function FinishPicker({ draft, onSet }: { draft: CreatorDraft; onSet: (id: string | null) => void }) {
  return (
    <div className="card" style={{ marginBottom: 12, borderColor: 'var(--warn)' }}>
      <p className="muted" style={{ margin: '0 0 6px', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        ★ Shared final destination
      </p>
      <select
        aria-label="Final destination — the stop every route ends at"
        value={draft.finalDestinationId ?? ''}
        onChange={(e) => onSet(e.target.value || null)}
        style={small}
      >
        <option value="">— none designated —</option>
        {draft.checkpoints.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name.trim() || 'Untitled checkpoint'}
          </option>
        ))}
      </select>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.45 }}>
        Appended to the end of every route automatically. The engine reads the last id as the
        finish, so it cannot be reordered out of last place.
      </p>
    </div>
  );
}

function CheckpointRow(props: {
  index: number;
  total: number;
  name: string;
  id: string;
  isFinish: boolean;
  selected: boolean;
  onSelect: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 6px',
        borderRadius: 8,
        marginBottom: 4,
        background: props.selected ? 'var(--surface-2)' : 'transparent',
        border: `1px solid ${props.selected ? 'var(--accent)' : 'transparent'}`,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: props.isFinish ? 6 : 999,
          background: props.isFinish ? 'var(--warn)' : 'var(--accent-2)',
          color: '#0b1020',
          fontSize: 11,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {props.isFinish ? '★' : props.index + 1}
      </span>
      <button
        onClick={props.onSelect}
        style={{
          flex: 1,
          textAlign: 'left',
          background: 'none',
          border: 0,
          color: 'var(--text)',
          fontSize: 13,
          cursor: 'pointer',
          padding: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {props.name}
      </button>
      {props.isFinish ? (
        <span className="muted" style={{ fontSize: 10 }}>locked last</span>
      ) : (
        <>
          <button className="btn" style={iconBtn} onClick={props.onUp} disabled={props.index === 0} title="Move up">↑</button>
          <button className="btn" style={iconBtn} onClick={props.onDown} disabled={props.index >= props.total - 1} title="Move down">↓</button>
          <button className="btn" style={iconBtn} onClick={props.onRemove} title="Remove from route">×</button>
        </>
      )}
    </li>
  );
}

export default function RouteEditor(props: RouteEditorProps) {
  const { draft } = props;
  const finishId = draft.finalDestinationId;
  const assigned = new Set(draft.routes.flatMap((r) => r.checkpointIds));

  return (
    <div>
      <HuntMetaFields draft={draft} onChange={props.onHuntChange} />
      <FinishPicker draft={draft} onSet={props.onSetFinalDestination} />

      {draft.routes.map((route) => {
        const checkpoints = routeCheckpointsOf(draft, route);
        const body = checkpoints.filter((c) => c.id !== finishId);
        const isActive = route.id === props.activeRouteId;
        const measuredMeters = draft.walkingOverrides?.[route.id];
        const available = draft.checkpoints.filter(
          (c) => c.id !== finishId && !assigned.has(c.id),
        );

        return (
          <div
            key={route.id}
            className="card"
            style={{ marginBottom: 12, borderColor: isActive ? 'var(--accent)' : 'var(--line)' }}
          >
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                aria-label="Route name"
                value={route.label}
                onChange={(e) => props.onRenameRoute(route.id, e.target.value)}
                style={{ ...small, fontWeight: 700 }}
              />
              <button
                className="btn"
                style={{ ...iconBtn, minHeight: 36, whiteSpace: 'nowrap' }}
                onClick={() => props.onSelectRoute(route.id)}
                disabled={isActive}
                title="New map clicks add to this route"
              >
                {isActive ? '● editing' : 'edit'}
              </button>
              <button
                className="btn"
                style={{ ...iconBtn, minHeight: 36 }}
                onClick={() => props.onRemoveRoute(route.id)}
                title="Delete route"
              >
                ×
              </button>
            </div>

            <p className="muted" style={{ margin: '0 0 8px', fontSize: 11 }}>
              {checkpoints.length} stops · {checkpoints.reduce((s, c) => s + c.baseXp, 0)} base XP ·{' '}
              {Math.round(route.approxDurationSeconds / 60)} min
            </p>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input
                type="number"
                min={0}
                step={50}
                value={measuredMeters ?? ''}
                placeholder={`${straightLineMeters(checkpoints)} (straight-line)`}
                onChange={(e) =>
                  props.onSetWalkingDistance(route.id, e.target.value ? Number(e.target.value) : null)
                }
                style={{ ...small, width: 120 }}
                title="Measured walking distance in metres"
              />
              <span className="muted" style={{ fontSize: 10, lineHeight: 1.35 }}>
                measured walking metres. Blank falls back to {straightLineMeters(checkpoints)} m
                straight-line — advisory only, and the real walk is what fairness depends on.
              </span>
            </div>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {body.map((c, i) => (
                <CheckpointRow
                  key={c.id}
                  index={i}
                  total={body.length}
                  id={c.id}
                  name={c.name.trim() || 'Untitled checkpoint'}
                  isFinish={false}
                  selected={c.id === props.selectedCheckpointId}
                  onSelect={() => props.onSelectCheckpoint(c.id)}
                  onUp={() => props.onReorder(route.id, c.id, -1)}
                  onDown={() => props.onReorder(route.id, c.id, 1)}
                  onRemove={() => props.onUnassign(route.id, c.id)}
                />
              ))}
              {checkpoints
                .filter((c) => c.id === finishId)
                .map((c) => (
                  <CheckpointRow
                    key={c.id}
                    index={body.length}
                    total={checkpoints.length}
                    id={c.id}
                    name={c.name.trim() || 'Untitled checkpoint'}
                    isFinish
                    selected={c.id === props.selectedCheckpointId}
                    onSelect={() => props.onSelectCheckpoint(c.id)}
                    onUp={() => undefined}
                    onDown={() => undefined}
                    onRemove={() => undefined}
                  />
                ))}
            </ul>

            {body.length === 0 && (
              <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
                No stops yet — click the map while this route is being edited.
              </p>
            )}

            {available.length > 0 && (
              <select
                aria-label={`Add a checkpoint to ${route.label}`}
                value=""
                onChange={(e) => e.target.value && props.onAssign(route.id, e.target.value)}
                style={{ ...small, marginTop: 6 }}
              >
                <option value="">+ Add an unassigned checkpoint…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.trim() || 'Untitled checkpoint'}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}

      <button className="btn" style={{ width: '100%', minHeight: 40 }} onClick={props.onAddRoute}>
        + Add route
      </button>
    </div>
  );
}
