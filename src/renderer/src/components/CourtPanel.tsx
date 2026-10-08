import { useEffect, useMemo, useState } from 'react';
import { describeEvent, isGameEnded, previewShot } from '@shared/store';
import type { GameEvent, ShotEvent } from '@shared/types';
import { playerShooting, shotCounts, visibleShots } from '@shared/eventLog';
import { ShotToggles } from './ShotToggles';
import { Court, courtToPercent, type CourtPoint, type ShotMarker, type ShotPreview } from './Court';
import { gameStore, useGame } from '../store';
import { isModalOpen, useUi } from '../ui';
import { isTypingTarget } from '../typing';
import { attacksRight, periodLabel } from '@shared/stats';

interface Pending extends CourtPoint { points: 2 | 3; nearLine: boolean }

export function CourtPanel() {
  const game = useGame((s) => s.game);
  const selectedId = useGame((s) => s.selectedPlayerId);
  const viewPeriod = useGame((s) => s.viewPeriod);
  const addShot = useGame((s) => s.addShot);
  const updateEvent = useGame((s) => s.updateEvent);
  const deleteEvent = useGame((s) => s.deleteEvent);

  const ended = isGameEnded(game);
  const [hover, setHover] = useState<CourtPoint | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // player id -> who they are
  const people = useMemo(() => {
    const m = new Map<string, { teamIndex: 0 | 1; color: string; label: string }>();
    game.teams.forEach((t, ti) =>
      t.players.forEach((p) => m.set(p.id, { teamIndex: ti as 0 | 1, color: t.color, label: `#${p.number} ${p.name}` })));
    return m;
  }, [game.teams]);

  const selected = selectedId ? people.get(selectedId) : undefined;

  const showShots = useUi((s) => s.showShots);
  const teamIndexById = useMemo(() => new Map(game.teams.map((t, i) => [t.id, i as 0 | 1])), [game.teams]);

  const shotPlayerId = useUi((s) => s.shotPlayerId);

  // What the court draws: the viewed period (any period) x the teams switched on x one player, if chosen.
  const shotEvents = useMemo(
    () => visibleShots(game, { period: viewPeriod, teams: showShots, playerId: shotPlayerId }),
    [game, viewPeriod, showShots, shotPlayerId],
  );
  const counts = useMemo(
    () => shotCounts(game, viewPeriod === 'game' ? {} : { period: viewPeriod }),
    [game, viewPeriod],
  );
  const shotPlayerLine = useMemo(
    () => (shotPlayerId ? playerShooting(game, shotPlayerId, viewPeriod) : null),
    [game, shotPlayerId, viewPeriod],
  );

  const markers: ShotMarker[] = shotEvents.map((e) => {
    const who = people.get(e.playerId);
    return {
      id: e.id, x: e.x, y: e.y, made: e.made,
      color: game.teams.find((t) => t.id === e.teamId)?.color ?? '#000',
      title: `${who?.label ?? '?'}: ${e.points}PT ${e.made ? 'made' : 'missed'}`,
      selected: e.id === editingId,
    };
  });

  const toPreview = (p: Pending | null): ShotPreview | null =>
    p && selected ? { ...p, color: selected.color } : null;

  const hoverPreview: ShotPreview | null = useMemo(() => {
    if (!hover || !selectedId || pending) return null;
    const c = previewShot(game, selectedId, hover.x, hover.y);
    return { ...hover, points: c.points, nearLine: c.nearLine, color: people.get(selectedId)?.color ?? '#000' };
  }, [hover, selectedId, pending, game, people]);

  // Drop transient state when the selection or period changes, or a dialog opens.
  const modalOpen = useUi((s) => s.rosterOpen || s.newGameOpen || s.helpOpen || s.logOpen || s.endGameOpen);
  useEffect(() => { setPending(null); setEditingId(null); setHover(null); }, [selectedId, game.currentPeriod, modalOpen]);

  // Which team is shooting at which end right now (flips at halftime).
  const sidesPeriod = viewPeriod === 'game' ? game.currentPeriod : viewPeriod;
  const [leftTeam, rightTeam] = useMemo(() => {
    const [a, b] = game.teams;
    // Follow the period on screen: teams switch ends at halftime, so Q1 and Q3 differ.
    return attacksRight(a, sidesPeriod, game.regulationPeriods) ? [b, a] : [a, b];
  }, [game.teams, sidesPeriod, game.regulationPeriods]);

  const commit = (made: boolean) => {
    if (!pending || !selectedId) return;
    const shot = addShot({ playerId: selectedId, made, x: pending.x, y: pending.y, points: pending.points });
    useUi.getState().showToast(describeEvent(gameStore.getState().game, shot));
    // A shot for a hidden team would vanish the moment it's placed: show that team again.
    const ti = teamIndexById.get(shot.teamId);
    if (ti !== undefined && !useUi.getState().showShots[ti]) {
      useUi.getState().setShowShots(ti, true);
      useUi.getState().showToast(`${describeEvent(gameStore.getState().game, shot)} \u2014 showing ${gameStore.getState().game.teams[ti].name} shots again`);
    }
    // ...and the same for a view (another period / another player) that would hide it.
    const ui = useUi.getState();
    if (gameStore.getState().viewPeriod !== 'game' && gameStore.getState().viewPeriod !== shot.period) {
      gameStore.getState().setViewPeriod(shot.period);
    }
    if (ui.shotPlayerId && ui.shotPlayerId !== shot.playerId) {
      ui.setShotPlayer(null);
      ui.showToast(`${describeEvent(gameStore.getState().game, shot)} \u2014 showing everyone's shots again`);
    }
    setPending(null);
    setHover(null); // hide the ghost until the pointer moves again, so it doesn't sit on the new marker
  };

  const editingEvent: GameEvent | undefined = editingId ? game.events.find((e) => e.id === editingId) : undefined;
  // A popover for a marker that is not drawn would float over nothing: treat it as closed in the SAME render
  // (no one-frame flash), and forget the id so re-showing the team doesn't bring the popover back.
  const editingHidden = editingEvent ? !showShots[teamIndexById.get(editingEvent.teamId) ?? 0] : false;
  const editing: GameEvent | undefined = editingHidden ? undefined : editingEvent;
  useEffect(() => { if (editingHidden) setEditingId(null); }, [editingHidden]);

  // Keyboard shortcuts while a popover is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || isModalOpen()) return;
      const k = e.key.toLowerCase();
      if (pending) {
        if (k === 'm') commit(true);
        else if (k === 'x') commit(false);
        else if (k === '2' || k === '3') setPending({ ...pending, points: k === '2' ? 2 : 3 });
        else if (k === 'escape') setPending(null);
      } else if (editing && editing.type === 'shot') {
        if (k === 'f') updateEvent(editing.id, { made: !editing.made });
        else if (k === 'delete' || k === 'backspace') { deleteEvent(editing.id); setEditingId(null); }
        else if (k === 'escape') setEditingId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Tell the global shortcuts when this popover owns the keyboard.
  const popoverState = pending ? 'pending' : editing && editing.type === 'shot' ? 'editing' : 'none';
  useEffect(() => {
    useUi.getState().setCourtPopover(popoverState);
    return () => useUi.getState().setCourtPopover('none');
  }, [popoverState]);

  const anchor = pending ?? (editing && editing.type === 'shot' ? editing : null);
  const pos = anchor ? courtToPercent(game.courtType, anchor) : null;

  return (
    <section className="flex flex-col gap-2 min-w-0">
      <div className="h-8 flex items-center text-sm text-slate-300">
        {ended ? (
          <span className="text-slate-300">
            <b>Game ended.</b> Pick any quarter above, or a player below, to look at their shots.
          </span>
        ) : selected ? (
          <span>
            Logging shots for <b className="text-white">{selected.label}</b>{' '}
            <span className="text-slate-400">— click the court, then Made (M) or Missed (X), or press 2 / 3</span>
          </span>
        ) : (
          <span className="text-amber-300">Select a player in a sidebar, then click the court to log a shot.</span>
        )}
      </div>

      {!ended && viewPeriod !== 'game' && viewPeriod !== game.currentPeriod && (
        <div className="flex items-center justify-between rounded bg-sky-900/40 px-3 py-1.5 text-sm text-sky-100 ring-1 ring-sky-700" data-part="viewing-banner">
          <span>
            Viewing <b>{periodLabel(viewPeriod, game.regulationPeriods)}</b> only. New stats are still being recorded in{' '}
            <b>{periodLabel(game.currentPeriod, game.regulationPeriods)}</b>.
          </span>
          <button className="rounded bg-sky-700 px-2 py-0.5 text-xs hover:bg-sky-600" data-back-to-live
            onClick={() => gameStore.getState().setViewPeriod(game.currentPeriod)}>
            Back to {periodLabel(game.currentPeriod, game.regulationPeriods)}
          </button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-slate-300" data-part="sides" data-sides-period={sidesPeriod}>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: leftTeam.color }} />
          <b>{leftTeam.name}</b> attacks the <b>left</b> basket</span>
        <span><b>{rightTeam.name}</b> attacks the <b>right</b> basket
          <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: rightTeam.color }} /></span>
      </div>

      <div className="relative rounded-lg overflow-hidden shadow-lg ring-1 ring-slate-700">
        <Court
          courtType={game.courtType}
          shots={markers}
          preview={hoverPreview}
          pending={toPreview(pending)}
          interactive={!ended}
          onHover={setHover}
          onPlot={(p) => {
            setEditingId(null);
            if (!selectedId) return;
            const c = previewShot(game, selectedId, p.x, p.y);
            setPending({ ...p, points: c.points, nearLine: c.nearLine });
          }}
          onMarkerClick={ended ? undefined : (id) => { setPending(null); setEditingId(id); }}
        />

        {pos && (
          <div
            className="absolute z-10 w-56 rounded-md bg-slate-900/95 p-2 text-sm shadow-xl ring-1 ring-slate-600"
            style={{
              left: `${pos.left}%`, top: `${pos.top}%`,
              transform: `translate(${pos.left < 15 ? '0' : pos.left > 85 ? '-100%' : '-50%'}, ${pos.top > 60 ? 'calc(-100% - 18px)' : '18px'})`,
            }}
          >
            {pending && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">{pending.points}PT attempt</span>
                  <button className="rounded bg-slate-700 px-2 py-0.5 text-xs hover:bg-slate-600"
                    onClick={() => setPending({ ...pending, points: pending.points === 2 ? 3 : 2 })}>
                    switch to {pending.points === 2 ? '3PT' : '2PT'} ({pending.points === 2 ? '3' : '2'})
                  </button>
                </div>
                {pending.nearLine && <div className="mb-2 text-xs text-amber-300">Close to the line — check the 2/3 call.</div>}
                <div className="flex gap-2">
                  <button className="flex-1 rounded bg-emerald-600 py-1.5 font-semibold hover:bg-emerald-500" onClick={() => commit(true)}>Made (M)</button>
                  <button className="flex-1 rounded bg-rose-600 py-1.5 font-semibold hover:bg-rose-500" onClick={() => commit(false)}>Missed (X)</button>
                </div>
                <button className="mt-2 w-full text-xs text-slate-400 hover:text-slate-200" onClick={() => setPending(null)}>Cancel (Esc)</button>
              </>
            )}
            {!pending && editing?.type === 'shot' && (
              <>
                <div className="mb-2 font-semibold">{people.get(editing.playerId)?.label}: {editing.points}PT {editing.made ? 'made' : 'missed'}</div>
                <div className="flex gap-2">
                  <button className="flex-1 rounded bg-slate-700 py-1.5 hover:bg-slate-600"
                    onClick={() => updateEvent(editing.id, { made: !editing.made })}>
                    Flip to {editing.made ? 'missed' : 'made'} (F)
                  </button>
                  <button className="flex-1 rounded bg-rose-700 py-1.5 hover:bg-rose-600"
                    onClick={() => { deleteEvent(editing.id); setEditingId(null); }}>
                    Delete
                  </button>
                </div>
                <button className="mt-2 w-full text-xs text-slate-400 hover:text-slate-200" onClick={() => setEditingId(null)}>Close (Esc)</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-400">
        <ShotToggles
          teams={[
            { name: game.teams[0].name, color: game.teams[0].color, ...counts[0] },
            { name: game.teams[1].name, color: game.teams[1].color, ...counts[1] },
          ]}
          visible={showShots}
          onToggle={(t) => useUi.getState().toggleShots(t)}
        />
        <label className="flex items-center gap-1.5">
          Player:
          <select
            aria-label="Show shots for player"
            data-shot-player
            className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-200 ring-1 ring-slate-600"
            value={shotPlayerId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              useUi.getState().setShotPlayer(id);
              if (id) { // a player on a hidden team would show nothing: switch that team on
                const ti = teamIndexById.get(game.teams.find((t) => t.players.some((p) => p.id === id))?.id ?? '');
                if (ti !== undefined && !useUi.getState().showShots[ti]) useUi.getState().setShowShots(ti, true);
              }
              e.currentTarget.blur();
            }}
          >
            <option value="">All players</option>
            {game.teams.map((t) => (
              <optgroup key={t.id} label={t.name}>
                {t.players.map((p) => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {shotPlayerLine && (
          <span className="rounded bg-slate-800 px-2 py-1 tabular-nums text-slate-200" data-part="player-shot-line">
            {shotPlayerLine.pts} pts · FG {shotPlayerLine.fgm}-{shotPlayerLine.fga} · 3P {shotPlayerLine.fg3m}-{shotPlayerLine.fg3a}
          </span>
        )}
        <span className="flex items-center gap-4">
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-slate-300 align-middle" />made</span>
          <span><span className="mr-1 align-middle font-bold">✕</span>missed</span>
          <span data-part="shots-shown">{shotEvents.length} shot{shotEvents.length === 1 ? '' : 's'} shown ({viewPeriod === 'game' ? 'whole game' : periodLabel(viewPeriod, game.regulationPeriods)}{shotPlayerId ? ', one player' : ''})</span>
        </span>
      </div>
    </section>
  );
}
