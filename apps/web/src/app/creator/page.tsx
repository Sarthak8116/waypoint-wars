'use client';

/**
 * Creator dashboard — the internal authoring tool (PLAN.md P10).
 *
 * No Phaser here. Phaser owns feelings; there are no feelings in a form.
 * MapLibre still owns geography (ARCHITECTURE.md), React owns the draft, and
 * `creatorDraft.ts` owns the invariant that makes the draft loadable by the
 * engine — every route ends at the shared final destination.
 *
 * Internal tool, so: no auth, no marketplace, no multi-user. Desktop-first,
 * but it collapses to a single column rather than breaking at narrow widths.
 *
 * NO AI generation in this phase — every field here is human-authored.
 * Querit/Gemini drafting is P11 and requires human review before publish.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Checkpoint, LatLng } from '@ww/shared';
import {
  addCheckpoint,
  addRoute,
  assignCheckpoint,
  clearDraft,
  downloadBundle,
  emptyDraft,
  importCuratedSeed,
  loadDraft,
  placementOf,
  removeCheckpoint,
  removeRoute,
  renameRoute,
  reorderCheckpoint,
  saveDraft,
  setFinalDestination,
  setWalkingDistance,
  toBundle,
  unassignCheckpoint,
  updateCheckpoint,
  type CreatorDraft,
  type HuntMeta,
} from '@/lib/creatorDraft';
import { validateDraft } from '@/lib/creatorValidation';
import { CREATOR_PREVIEW_KEY, clearCreatorPreview } from '@/lib/huntData';
import CheckpointForm from '@/components/creator/CheckpointForm';
import RouteEditor from '@/components/creator/RouteEditor';
import ValidationPanel from '@/components/creator/ValidationPanel';
import type { CreatorMapMarker } from '@/components/creator/CreatorMap';

// MapLibre touches `window` at module scope — same pattern as /play.
const CreatorMap = dynamic(() => import('@/components/creator/CreatorMap'), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';
const AUTOSAVE_DEBOUNCE_MS = 600;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const LAYOUT_CSS = `
.creator-shell { display: flex; flex-direction: column; min-height: 100dvh; }
.creator-grid {
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr) 400px;
  gap: 12px;
  padding: 0 12px 12px;
  flex: 1;
  min-height: 0;
}
.creator-col { overflow-y: auto; min-height: 0; max-height: calc(100dvh - 72px); }
.creator-map { position: relative; border-radius: 14px; overflow: hidden; border: 1px solid var(--line); min-height: 420px; }
@media (max-width: 1180px) {
  .creator-grid { grid-template-columns: 1fr; }
  .creator-col { max-height: none; overflow: visible; }
  .creator-map { height: 60vh; }
}
`;

export default function CreatorPage() {
  const [draft, setDraft] = useState<CreatorDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [addOnClick, setAddOnClick] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishDetails, setPublishDetails] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);

  // --- Boot: restored draft, else the curated seed, else blank -------------
  useEffect(() => {
    const restored = loadDraft();
    if (restored) {
      adopt(restored, 'Restored your saved draft.');
      return;
    }
    void importCuratedSeed()
      .then((seed) => adopt(seed, 'Loaded the curated Pittsburgh content as a starting point.'))
      .catch(() => adopt(emptyDraft(), 'Started a blank hunt — curated content was not available.'));

    function adopt(next: CreatorDraft, message: string) {
      setDraft(next);
      setActiveRouteId(next.routes[0]?.id ?? null);
      setNotice(message);
    }
  }, []);

  // A preview key left behind by an earlier session silently overrides /play,
  // so the indicator has to reflect reality at boot, not just what we wrote.
  useEffect(() => {
    try {
      setPreviewing(window.localStorage.getItem(CREATOR_PREVIEW_KEY) !== null);
    } catch {
      setPreviewing(false);
    }
  }, []);

  // --- Autosave ------------------------------------------------------------
  const firstSave = useRef(true);
  useEffect(() => {
    if (!draft) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaveState('saving');
    const id = setTimeout(() => {
      const result = saveDraft(draft);
      setSaveState(result.ok ? 'saved' : 'error');
      setSaveError(result.ok ? null : result.reason);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [draft]);

  const report = useMemo(() => (draft ? validateDraft(draft) : null), [draft]);

  const selected: Checkpoint | null = useMemo(
    () => draft?.checkpoints.find((c) => c.id === selectedId) ?? null,
    [draft, selectedId],
  );

  // --- Map data ------------------------------------------------------------
  const markers: CreatorMapMarker[] = useMemo(() => {
    if (!draft) return [];
    return draft.checkpoints.map((cp) => {
      const placement = placementOf(draft, cp.id);
      const isFinish = cp.id === draft.finalDestinationId;
      return {
        id: cp.id,
        latitude: cp.latitude,
        longitude: cp.longitude,
        radiusMeters: cp.radiusMeters,
        name: cp.name,
        label: isFinish ? '★' : placement ? String(placement.position) : '•',
        kind: isFinish ? 'finish' : placement ? 'assigned' : 'unassigned',
        selected: cp.id === selectedId,
      };
    });
  }, [draft, selectedId]);

  const routeLine: LatLng[] = useMemo(() => {
    if (!draft) return [];
    const route = draft.routes.find((r) => r.id === activeRouteId);
    if (!route) return [];
    const byId = new Map(draft.checkpoints.map((c) => [c.id, c]));
    return route.checkpointIds
      .map((id) => byId.get(id))
      .filter((c): c is Checkpoint => Boolean(c))
      .map((c) => ({ latitude: c.latitude, longitude: c.longitude }));
  }, [draft, activeRouteId]);

  // --- Edits ---------------------------------------------------------------
  const edit = useCallback((fn: (d: CreatorDraft) => CreatorDraft) => {
    setDraft((current) => (current ? fn(current) : current));
  }, []);

  const handleAdd = useCallback(
    (latitude: number, longitude: number) => {
      setDraft((current) => {
        if (!current) return current;
        const { draft: next, checkpoint } = addCheckpoint(current, latitude, longitude, activeRouteId);
        setSelectedId(checkpoint.id);
        return next;
      });
    },
    [activeRouteId],
  );

  const handleMove = useCallback(
    (id: string, latitude: number, longitude: number) => {
      edit((d) => updateCheckpoint(d, id, { latitude, longitude }));
    },
    [edit],
  );

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    edit((d) => removeCheckpoint(d, selectedId));
    setSelectedId(null);
  }, [edit, selectedId]);

  // --- Toolbar actions -----------------------------------------------------
  const handleExport = useCallback(() => {
    if (!draft) return;
    const bundle = toBundle(draft);
    if (!bundle) {
      setNotice('Designate a shared final destination before exporting.');
      return;
    }
    downloadBundle(bundle, `${draft.hunt.id}.json`);
    setNotice('Exported. Drop it in as data/pittsburgh-hunts.json to play it.');
  }, [draft]);

  const handleImportSeed = useCallback(() => {
    if (!window.confirm('Replace the current draft with the curated Pittsburgh content?')) return;
    void importCuratedSeed()
      .then((seed) => {
        setDraft(seed);
        setActiveRouteId(seed.routes[0]?.id ?? null);
        setSelectedId(null);
        setNotice('Curated Pittsburgh content loaded.');
      })
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : 'Import failed.'));
  }, []);

  const handleNew = useCallback(() => {
    if (!window.confirm('Discard the current draft and start a blank hunt?')) return;
    clearDraft();
    const blank = emptyDraft();
    setDraft(blank);
    setActiveRouteId(blank.routes[0]?.id ?? null);
    setSelectedId(null);
    setNotice('Started a blank hunt.');
  }, []);

  /**
   * Preview: park the draft where `/play` reads it, THEN navigate.
   *
   * The order is load-bearing. Navigating first would walk whatever was in
   * the key before — and stale content that looks plausible is far worse than
   * a visible error, because nothing about it says "this is not your draft".
   */
  const handlePreview = useCallback(() => {
    if (!draft || !report?.publishable) return;
    const bundle = toBundle(draft);
    if (!bundle) {
      setNotice('Designate a shared final destination before previewing.');
      return;
    }
    try {
      window.localStorage.setItem(CREATOR_PREVIEW_KEY, JSON.stringify(bundle));
    } catch {
      // Almost always the quota: reference images are data URLs and the budget
      // is ~5MB. Do NOT open /play — it would show stale or published content.
      setNotice(
        'Preview needs less data than this draft carries — remove reference images, or use Export JSON and drop the file in as data/pittsburgh-hunts.json.',
      );
      return;
    }
    setPreviewing(true);
    setNotice(null);
    window.open('/play', '_blank', 'noopener');
  }, [draft, report]);

  const handleClearPreview = useCallback(() => {
    clearCreatorPreview();
    setPreviewing(false);
    setNotice('Preview cleared — /play is back on published content.');
  }, []);

  /**
   * Publish. The endpoint may not exist yet, and that must not look like a
   * crash: a 404 or a dead socket is reported as "use Export instead", which
   * is a complete workflow on its own.
   */
  const handlePublish = useCallback(async () => {
    if (!draft) return;
    const bundle = toBundle(draft);
    if (!bundle) {
      setPublishMessage({ tone: 'bad', text: 'No shared final destination designated.' });
      return;
    }
    setPublishing(true);
    setPublishMessage(null);
    setPublishDetails([]);
    try {
      const res = await fetch(`${API_URL}/api/hunts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      if (res.status === 422) {
        // The server validates route-length equality and shared-finish
        // agreement independently of our panel. Its wording is the actionable
        // one, so it is rendered verbatim rather than re-summarized.
        const body = (await res.json().catch(() => null)) as
          | { error?: string; details?: string[] }
          | null;
        setPublishDetails(Array.isArray(body?.details) ? body.details : []);
        setPublishMessage({
          tone: 'bad',
          text: body?.error ?? 'The server rejected this hunt (422).',
        });
      } else if (res.status === 404) {
        setPublishMessage({
          tone: 'bad',
          text: 'The publish endpoint is not available on the server yet. Use Export JSON and drop the file in as data/pittsburgh-hunts.json.',
        });
      } else if (!res.ok) {
        setPublishMessage({ tone: 'bad', text: `Publish failed (HTTP ${res.status}). Export JSON instead.` });
      } else {
        const body = (await res.json().catch(() => null)) as
          | { huntId?: string; routes?: number; checkpoints?: number; storage?: string }
          | null;
        const where = body?.storage ? ` (${body.storage})` : '';
        setPublishMessage({
          tone: 'ok',
          text: `Published ${body?.routes ?? draft.routes.length} routes and ${body?.checkpoints ?? draft.checkpoints.length} checkpoints${where}. Clear the preview to walk the published version.`,
        });
      }
    } catch {
      setPublishMessage({
        tone: 'bad',
        text: `Could not reach ${API_URL}. Use Export JSON and drop the file in as data/pittsburgh-hunts.json.`,
      });
    } finally {
      setPublishing(false);
    }
  }, [draft]);

  if (!draft || !report) {
    return (
      <main className="wrap">
        <p className="muted">Loading creator…</p>
      </main>
    );
  }

  return (
    <div className="creator-shell">
      <style>{LAYOUT_CSS}</style>

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '10px 12px',
        }}
      >
        <h1 style={{ fontSize: 18, margin: 0, marginRight: 4 }}>
          Creator <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· internal tool</span>
        </h1>

        <label
          className="badge"
          style={{ cursor: 'pointer', borderColor: addOnClick ? 'var(--accent)' : 'var(--line)' }}
        >
          <input type="checkbox" checked={addOnClick} onChange={(e) => setAddOnClick(e.target.checked)} />
          Click map to add
        </label>

        <span style={{ flex: 1 }} />

        <span className={`badge ${saveState === 'error' ? 'mock' : 'off'}`} title={saveError ?? undefined}>
          {saveState === 'saved' && 'draft saved'}
          {saveState === 'saving' && 'saving…'}
          {saveState === 'error' && 'not saved'}
          {saveState === 'idle' && 'draft loaded'}
        </span>

        <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={handleImportSeed}>
          Import curated
        </button>
        <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={handleExport}>
          Export JSON
        </button>
        <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={handleNew}>
          New
        </button>
        <button
          className="btn"
          style={{ minHeight: 36, fontSize: 13 }}
          onClick={handlePreview}
          disabled={!report.publishable}
          title={
            report.publishable
              ? 'Park this draft where /play reads it, then open it'
              : 'Previewing a draft that fails a hard rule throws inside route assignment'
          }
        >
          Preview ↗
        </button>
        <a className="btn" style={{ minHeight: 36, fontSize: 13 }} href="/">
          Home
        </a>
      </header>

      {previewing && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            margin: '0 12px 8px',
            padding: '6px 12px',
            borderRadius: 10,
            border: '1px solid var(--warn)',
            background: 'rgba(251,191,36,0.14)',
            color: 'var(--warn)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span>▶ Previewing draft — /play is walking this draft, not published content.</span>
          <button className="btn" style={{ minHeight: 30, fontSize: 12 }} onClick={handleClearPreview}>
            Clear preview
          </button>
        </div>
      )}

      {(notice || saveError) && (
        <p className="muted" style={{ fontSize: 12, margin: '0 12px 8px' }}>
          {saveError ? `⚠ ${saveError}` : notice}
        </p>
      )}

      <div className="creator-grid">
        <div className="creator-col">
          <RouteEditor
            draft={draft}
            activeRouteId={activeRouteId}
            selectedCheckpointId={selectedId}
            onSelectRoute={setActiveRouteId}
            onSelectCheckpoint={setSelectedId}
            onHuntChange={(patch: Partial<HuntMeta>) =>
              edit((d) => ({ ...d, hunt: { ...d.hunt, ...patch } }))
            }
            onAddRoute={() => edit(addRoute)}
            onRenameRoute={(id, label) => edit((d) => renameRoute(d, id, label))}
            onRemoveRoute={(id) => {
              edit((d) => removeRoute(d, id));
              if (activeRouteId === id) setActiveRouteId(null);
            }}
            onAssign={(routeId, cpId) => edit((d) => assignCheckpoint(d, routeId, cpId))}
            onUnassign={(routeId, cpId) => edit((d) => unassignCheckpoint(d, routeId, cpId))}
            onReorder={(routeId, cpId, dir) => edit((d) => reorderCheckpoint(d, routeId, cpId, dir))}
            onSetWalkingDistance={(routeId, meters) => edit((d) => setWalkingDistance(d, routeId, meters))}
            onSetFinalDestination={(id) => edit((d) => setFinalDestination(d, id))}
          />
        </div>

        <div className="creator-map">
          <CreatorMap
            markers={markers}
            routeLine={routeLine}
            addOnClick={addOnClick}
            onAdd={handleAdd}
            onMove={handleMove}
            onSelect={setSelectedId}
          />
        </div>

        <div className="creator-col">
          <div className="card" style={{ marginBottom: 12 }}>
            {selected ? (
              <CheckpointForm
                checkpoint={selected}
                isFinalDestination={selected.id === draft.finalDestinationId}
                onChange={(patch) => edit((d) => updateCheckpoint(d, selected.id, patch))}
                onDelete={handleDelete}
                onMakeFinalDestination={() => edit((d) => setFinalDestination(d, selected.id))}
              />
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                Click a marker to edit it, or click the map to add a checkpoint to the route you are
                editing. Drag a marker to move it.
              </p>
            )}
          </div>

          <ValidationPanel
            report={report}
            publishing={publishing}
            publishMessage={publishMessage}
            publishDetails={publishDetails}
            onPublish={() => void handlePublish()}
            onSelectCheckpoint={setSelectedId}
          />
        </div>
      </div>
    </div>
  );
}
