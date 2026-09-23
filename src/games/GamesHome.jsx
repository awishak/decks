// A group's games, the way the host meets them. The one component a host app mounts.
//
//   <GamesHome supabase={sb} groupKey="comm118" context="COMM 118" roster={students}
//     groups={[{ groupKey: "comm118", section: null, label: "COMM 118 · Fall 2026" }]}
//     onScreen={cast} places={deck => ["Sep 23"]} top={barHeight} />
//
// A game is built once and run for each class or section that plays it (see
// RunPicker and runGame). So this page has three depths, each one click from
// the list of games down the left:
//   Games      every game: its day plan days, questions, last run, how it went
//   a game     its runs, newest first, with Edit and Run
//   a run      the game panel for that sitting: answers, the approval stream,
//              Close, Release, and Run again
//
// Where you are is kept in the address (#game=<id>, &run=<id>, &edit), so a
// reload in the middle of class comes back to the run that is going.

import { useMemo, useState, useEffect, useCallback } from "react";
import { DEFAULT_THEME, SIZE } from "../tokens.js";
import { listGames, listGameStats, listRuns, statsForRuns, createGame, runGame, moveGame, duplicateGame } from "./host.js";
import { GamePanelLive } from "./GamePanel.jsx";
import GameSetup from "./GameSetup.jsx";
import RunPicker from "./RunPicker.jsx";

const HIT = 34;

const readHash = () => {
  if (typeof location === "undefined") return {};
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  return { game: p.get("game"), run: p.get("run"), edit: p.has("edit") };
};
const writeHash = ({ game, run, edit }) => {
  if (typeof history === "undefined") return;
  const h = game ? `#game=${game}${run ? `&run=${run}` : ""}${edit ? "&edit" : ""}` : "";
  history.replaceState(null, "", h || location.pathname + location.search);
};

export const statusOf = (d) => (d.closed_at ? "Closed" : d.opened_at ? "Open" : "Draft");
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

export default function GamesHome({ supabase, groupKey, context, roster = [], groups = [], theme, onScreen, onError, onGame, places, top = 0 }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [where, setWhere] = useState(readHash);
  const [games, setGames] = useState(null);
  const [stats, setStats] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runStats, setRunStats] = useState({});
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const go = useCallback((next) => { const w = { game: null, run: null, edit: false, ...next }; writeHash(w); setWhere(w); setNote(""); }, []);

  const refresh = useCallback(async () => {
    try { setGames(await listGames(supabase, { groupKey })); } catch (e) { onError?.(e); setGames([]); }
  }, [supabase, groupKey, onError]);
  const refreshStats = useCallback(async () => {
    try { setStats(await listGameStats(supabase, { groupKey })); } catch (e) { onError?.(e); setStats([]); }
  }, [supabase, groupKey, onError]);
  const refreshRuns = useCallback(async (gameId) => {
    if (!gameId) { setRuns([]); return; }
    try {
      const list = await listRuns(supabase, { deckId: gameId });
      setRuns(list);
      setRunStats(await statsForRuns(supabase, { runIds: list.map(r => r.id) }));
    } catch (e) { onError?.(e); }
  }, [supabase, onError]);

  useEffect(() => { refresh(); }, [refresh, where.game, where.run, where.edit]);
  useEffect(() => { if (!where.game) refreshStats(); }, [refreshStats, where.game]);
  useEffect(() => { refreshRuns(where.game); }, [refreshRuns, where.game, where.run]);

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try { const d = await createGame(supabase, { groupKey, title }); setTitle(""); await refresh(); go({ game: d.id, edit: true }); }
    catch (e) { onError?.(e); }
    finally { setBusy(false); }
  };

  const labelOf = (r) => groups.find(g => g.groupKey === r.group_key && (g.section || null) === (r.section || null))?.label
    || [r.group_key, r.section].filter(Boolean).join(" · ");
  const openFor = runs.filter(r => r.opened_at && !r.closed_at).map(r => ({ groupKey: r.group_key, section: r.section }));
  const run = async (gameId, target) => {
    try {
      const r = await runGame(supabase, { deckId: gameId, groupKey: target.groupKey, section: target.section || null });
      await refreshRuns(gameId);
      go({ game: gameId, run: r.id });
    } catch (e) { onError?.(e); }
  };

  // The other shelves a game can move to: one entry per class, whatever the
  // sections the host listed for running. A class's label is its section
  // label with the section taken off the end.
  const shelves = [];
  groups.forEach(g => {
    if (g.groupKey === groupKey || shelves.some(s => s.groupKey === g.groupKey)) return;
    const tail = g.section ? ` · ${g.section}` : "";
    const label = tail && g.label.endsWith(tail) ? g.label.slice(0, -tail.length) : g.label;
    shelves.push({ groupKey: g.groupKey, section: null, label });
  });
  const move = async (gameId, target) => {
    try {
      await moveGame(supabase, { deckId: gameId, groupKey: target.groupKey });
      await refresh();
      go({});
      setNote(`Moved to ${target.label}`);
    } catch (e) { onError?.(e); }
  };
  const duplicate = async (gameId) => {
    if (busy) return;
    setBusy(true);
    try { const d = await duplicateGame(supabase, { deckId: gameId }); await refresh(); go({ game: d.id, edit: true }); }
    catch (e) { onError?.(e); }
    finally { setBusy(false); }
  };

  const tone = { Open: [T.ok, T.okTint], Draft: [T.dim, T.panel2], Closed: [T.faint, T.panel2] };
  const Status = ({ label }) => <span style={{ fontSize: SIZE.micro, fontWeight: 600, padding: "3px 10px", borderRadius: 999, color: tone[label][0], background: tone[label][1], whiteSpace: "nowrap" }}>{label}</span>;
  const rosterIds = new Set(roster.map(r => r.id));
  const finishedText = (d, s) => {
    if (!s) return "·";
    const team = d.teams && d.teams !== "none";
    const ours = (s.players || []).some(p => rosterIds.has(p));
    const of = team ? s.teamsCount : ours ? roster.length : null;
    return { text: of ? `${s.finished} / ${of}` : String(s.finished), all: !!of && s.finished >= of };
  };
  const game = (games || []).find(g => g.id === where.game) || null;
  const header = (titleText, sub, right) => (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 32px", background: T.panel, boxShadow: `0 1px 0 ${T.line}` }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
        {sub ? <span style={{ fontSize: SIZE.micro, color: T.faint }}>{sub}</span> : null}
        <span style={{ fontSize: SIZE.head, fontWeight: 600, letterSpacing: "-0.01em" }}>{titleText}</span>
      </div>
      {right}
    </div>
  );
  const ghost = { display: "inline-flex", alignItems: "center", minHeight: HIT, padding: "0 14px", borderRadius: T.radius, border: "none", fontFamily: T.font, fontSize: SIZE.small, fontWeight: 600, cursor: "pointer", background: T.panel, color: T.accent, boxShadow: `inset 0 0 0 1px ${T.line}` };

  let main;
  if (where.game && where.edit) {
    main = <GameSetup key={where.game} supabase={supabase} deckId={where.game} roster={roster} context={context} theme={theme}
      groups={groups} onRun={(target) => run(where.game, target)}
      onDone={() => go({ game: where.game })} onBack={() => go({})} onSaved={refresh} onError={onError} />;
  } else if (where.game && where.run) {
    const r = runs.find(x => x.id === where.run);
    main = <GamePanelLive key={where.run} supabase={supabase} deckId={where.run} roster={roster} theme={theme}
      context={[context, game?.title, r ? `${labelOf(r)} · ${dayOf(r.opened_at)}` : ""].filter(Boolean).join(" · ")}
      runControl={{ groups, openFor, onRun: (target) => run(where.game, target) }}
      onScreen={onScreen} onError={onError} onChange={onGame} />;
  } else if (where.game) {
    const cols = "140px minmax(0, 1fr) 110px 90px 80px";
    main = (
      <div>
        {header(game?.title || "", [context, game ? `${game.questions} ${game.questions === 1 ? "question" : "questions"}` : ""].filter(Boolean).join(" · "),
          <span style={{ display: "flex", gap: 8 }}>
            {!game?.opened_at ? <button type="button" style={ghost} onClick={() => go({ game: where.game, edit: true })}>Edit</button> : null}
            <button type="button" style={ghost} disabled={busy} onClick={() => duplicate(where.game)}>Duplicate</button>
            {shelves.length ? <RunPicker T={T} groups={shelves} onRun={(target) => move(where.game, target)} label="Move" solid={false} /> : null}
            {groups.length ? <RunPicker T={T} groups={groups} openFor={openFor} onRun={(target) => run(where.game, target)} /> : null}
          </span>)}
        <div style={{ padding: "24px 32px" }}>
          <div style={{ background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "12px 20px", fontSize: SIZE.micro, color: T.faint, boxShadow: `0 1px 0 ${T.line}` }}>
              <span>Run</span><span>Class</span><span style={{ textAlign: "right" }}>Finished</span><span style={{ textAlign: "right" }}>Average</span><span />
            </div>
            {runs.map(r => {
              const s = runStats[r.id];
              const f = finishedText(r, s);
              return (
                <div key={r.id} className="gh-row" role="button" tabIndex={0} onClick={() => go({ game: where.game, run: r.id })}
                  onKeyDown={e => { if (e.key === "Enter") go({ game: where.game, run: r.id }); }}
                  style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 16, minHeight: 52, padding: "8px 20px", boxShadow: `0 1px 0 ${T.line}` }}>
                  <span>{dayOf(r.opened_at)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(r)}</span>
                  <span style={{ fontFamily: T.mono, textAlign: "right", color: f.all ? T.ok : T.text }}>{f.text || f}</span>
                  <span style={{ fontFamily: T.mono, textAlign: "right" }}>{s && s.average !== null ? `${s.average}%` : "·"}</span>
                  <span style={{ justifySelf: "end" }}><Status label={statusOf(r)} /></span>
                </div>
              );
            })}
            {!runs.length ? <div style={{ padding: "16px 20px", color: T.faint }}>·</div> : null}
          </div>
        </div>
      </div>
    );
  } else {
    const cols = "minmax(0, 1fr) minmax(90px, 160px) 90px minmax(150px, 220px) 100px 80px 80px";
    main = (
      <div>
        {header("Games", [context, note].filter(Boolean).join(" · "))}
        <div style={{ padding: "24px 32px" }}>
          <div style={{ background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "12px 20px", fontSize: SIZE.micro, color: T.faint, boxShadow: `0 1px 0 ${T.line}` }}>
              <span>Game</span><span>Day plan</span><span style={{ textAlign: "right" }}>Questions</span><span>Last run</span>
              <span style={{ textAlign: "right" }}>Finished</span><span style={{ textAlign: "right" }}>Average</span><span />
            </div>
            {(stats || games || []).map(d => {
              const spots = places ? places(d) : [];
              const last = d.lastRun || null;
              const f = last ? finishedText(last, d) : { text: "·" };
              return (
                <div key={d.id} className="gh-row" role="button" tabIndex={0} onClick={() => go({ game: d.id })}
                  onKeyDown={e => { if (e.key === "Enter") go({ game: d.id }); }}
                  style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 16, minHeight: 56, padding: "8px 20px", boxShadow: `0 1px 0 ${T.line}` }}>
                  <span style={{ fontSize: SIZE.body, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                  <span style={{ color: spots.length ? T.text : T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spots.length ? spots.join(", ") : "·"}</span>
                  <span style={{ fontFamily: T.mono, textAlign: "right" }}>{d.questions}</span>
                  <span style={{ color: last ? T.text : T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{last ? `${dayOf(last.opened_at)} · ${labelOf(last)}` : "·"}</span>
                  <span style={{ fontFamily: T.mono, textAlign: "right", color: f.all ? T.ok : T.text }}>{stats ? f.text : ""}</span>
                  <span style={{ fontFamily: T.mono, textAlign: "right" }}>{stats ? (d.average === null || d.average === undefined ? "·" : `${d.average}%`) : ""}</span>
                  <span style={{ justifySelf: "end" }}>{last && !last.closed_at ? <Status label="Open" /> : null}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gh" style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", minHeight: `calc(100vh - ${top}px)`, background: T.bg, color: T.text, fontFamily: T.font, fontSize: SIZE.small }}>
      <style>{`.gh *{box-sizing:border-box}.gh-row{cursor:pointer}.gh-row:hover{background:${T.panel2}}.gh button:focus-visible,.gh input:focus-visible,.gh-row:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}`}</style>
      <nav aria-label="Games" style={{ position: "sticky", top, height: `calc(100vh - ${top}px)`, overflowY: "auto", background: T.panel, boxShadow: `1px 0 0 ${T.line}`, display: "flex", flexDirection: "column" }}>
        <button type="button" onClick={() => go({})}
          style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "20px 16px 16px", border: "none", textAlign: "left", cursor: "pointer", fontFamily: T.font,
            background: !where.game ? T.panel2 : "transparent", color: T.text }}>
          {context ? <span style={{ fontSize: SIZE.micro, color: T.faint }}>{context}</span> : null}
          <span style={{ fontSize: SIZE.lead, fontWeight: 600 }}>Games</span>
        </button>
        <div style={{ display: "flex", gap: 6, padding: "8px 12px 12px", boxShadow: `0 1px 0 ${T.line}` }}>
          <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} aria-label="Title"
            style={{ flex: 1, minWidth: 0, minHeight: HIT + 4, padding: "4px 10px", borderRadius: 8, border: "none", boxShadow: `inset 0 0 0 1px ${T.line}`, background: T.panel, color: T.text, fontFamily: T.font, fontSize: 16 }} />
          <button type="button" disabled={!title.trim() || busy} onClick={add}
            style={{ minHeight: HIT + 4, padding: "0 12px", borderRadius: T.radius, border: "none", fontFamily: T.font, fontSize: SIZE.small, fontWeight: 600, whiteSpace: "nowrap",
              background: title.trim() ? T.accent : T.line, color: title.trim() ? "#ffffff" : T.dim, cursor: title.trim() ? "pointer" : "default" }}>
            Add game
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "6px 0 24px" }}>
          {(games || []).map(d => {
            const on = d.id === where.game;
            return (
              <div key={d.id}>
                <button type="button" onClick={() => go({ game: d.id })} aria-current={on && !where.run ? "page" : undefined}
                  style={{ display: "block", width: "100%", padding: "10px 16px", minHeight: 44, border: "none", textAlign: "left", cursor: "pointer", fontFamily: T.font,
                    background: on && !where.run ? T.panel2 : "transparent", boxShadow: on ? `inset 3px 0 0 ${T.accent}` : "none", color: T.text,
                    fontSize: SIZE.small, fontWeight: on ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.title}
                </button>
                {on ? runs.map(r => (
                  <button key={r.id} type="button" onClick={() => go({ game: d.id, run: r.id })} aria-current={where.run === r.id ? "page" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 16px 6px 28px", minHeight: 36, border: "none", textAlign: "left", cursor: "pointer", fontFamily: T.font,
                      background: where.run === r.id ? T.panel2 : "transparent", boxShadow: on ? `inset 3px 0 0 ${T.accent}` : "none", color: T.dim, fontSize: SIZE.micro }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, flex: "none", background: r.closed_at ? T.ghost : T.ok }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dayOf(r.opened_at)} · {labelOf(r)}</span>
                  </button>
                )) : null}
              </div>
            );
          })}
        </div>
      </nav>
      <main style={{ minWidth: 0 }}>{main}</main>
    </div>
  );
}
