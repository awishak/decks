// A group's games, the way the host meets them. The one component a host app mounts.
//
//   <GamesHome supabase={sb} groupKey="comm118" context="COMM 118" roster={students}
//     onScreen={cast} places={deck => ["Tue, Sep 22"]} />
//
// Every game is always one click away: the list sits down the left of every
// screen here, the table, the setup and the running game alike, so getting
// back to a game or over to another one never means finding a back button.
//
// The table answers what Andrew asked of each game: how many questions, when it
// last ran, did everyone take it, what the average was, and where it sits in the
// day plan (`places`, from the host app, which reads the days whose rows hold
// the game). `top` is the height of a host bar pinned above this page.
//
// Where you are is kept in the address (#game=<id>, #game=<id>&edit), so a
// reload in the middle of class comes back to the game that is running.

import { useMemo, useState, useEffect, useCallback } from "react";
import { DEFAULT_THEME, SIZE } from "../tokens.js";
import { listGames, listGameStats, createGame } from "./host.js";
import { GamePanelLive } from "./GamePanel.jsx";
import GameSetup from "./GameSetup.jsx";

const HIT = 34;

const readHash = () => {
  if (typeof location === "undefined") return {};
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  return { game: p.get("game"), edit: p.has("edit") };
};
const writeHash = (game, edit) => {
  if (typeof history === "undefined") return;
  history.replaceState(null, "", game ? `#game=${game}${edit ? "&edit" : ""}` : location.pathname + location.search);
};

export const statusOf = (d) => (d.closed_at ? "Closed" : d.opened_at ? "Open" : "Draft");
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

export default function GamesHome({ supabase, groupKey, context, roster = [], theme, onScreen, onError, onGame, places, top = 0 }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [where, setWhere] = useState(readHash);
  const [games, setGames] = useState(null);
  const [stats, setStats] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const go = useCallback((game, edit = false) => { writeHash(game, edit); setWhere({ game, edit }); }, []);

  const refresh = useCallback(async () => {
    try { setGames(await listGames(supabase, { groupKey })); } catch (e) { onError?.(e); setGames([]); }
  }, [supabase, groupKey, onError]);

  const refreshStats = useCallback(async () => {
    try { setStats(await listGameStats(supabase, { groupKey })); } catch (e) { onError?.(e); setStats([]); }
  }, [supabase, groupKey, onError]);

  useEffect(() => { refresh(); }, [refresh, where.game, where.edit]);
  useEffect(() => { if (!where.game) refreshStats(); }, [refreshStats, where.game]);

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try { const d = await createGame(supabase, { groupKey, title }); setTitle(""); await refresh(); go(d.id, true); }
    catch (e) { onError?.(e); }
    finally { setBusy(false); }
  };

  const tone = { Open: [T.ok, T.okTint], Draft: [T.dim, T.panel2], Closed: [T.faint, T.panel2] };
  const Status = ({ d }) => {
    const st = statusOf(d);
    return <span style={{ fontSize: SIZE.micro, fontWeight: 600, padding: "3px 10px", borderRadius: 999, color: tone[st][0], background: tone[st][1], whiteSpace: "nowrap" }}>{st}</span>;
  };
  const rosterIds = new Set(roster.map(r => r.id));

  let main;
  if (where.game && where.edit) {
    main = <GameSetup key={where.game} supabase={supabase} deckId={where.game} roster={roster} context={context} theme={theme}
      onDone={() => go(where.game)} onBack={() => go(null)} onSaved={refresh} onError={onError} />;
  } else if (where.game) {
    main = <GamePanelLive key={where.game} supabase={supabase} deckId={where.game} context={context} roster={roster} theme={theme}
      onScreen={onScreen} onError={onError} onBack={() => go(null)} onEdit={() => go(where.game, true)} onChange={onGame} />;
  } else {
    const cols = "minmax(0, 1fr) 90px 130px 110px 90px minmax(180px, 280px) 80px";
    main = (
      <div>
        <div style={{ padding: "20px 32px", background: T.panel, boxShadow: `0 1px 0 ${T.line}`, display: "flex", flexDirection: "column", gap: 4 }}>
          {context ? <span style={{ fontSize: SIZE.micro, color: T.faint }}>{context}</span> : null}
          <span style={{ fontSize: SIZE.head, fontWeight: 600, letterSpacing: "-0.01em" }}>Games</span>
        </div>
        <div style={{ padding: "24px 32px" }}>
          <div style={{ background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "12px 20px", fontSize: SIZE.micro, color: T.faint, boxShadow: `0 1px 0 ${T.line}` }}>
              <span>Game</span><span style={{ textAlign: "right" }}>Questions</span><span>Last run</span>
              <span style={{ textAlign: "right" }}>Finished</span><span style={{ textAlign: "right" }}>Average</span><span>Day plan</span><span />
            </div>
            {(stats || games || []).map(d => {
              const team = d.teams && d.teams !== "none";
              const ours = (d.players || []).some(p => rosterIds.has(p));
              const of = team ? d.teamsCount : ours ? roster.length : null;
              const all = !!of && d.finished >= of;
              const spots = places ? places(d) : [];
              return (
                <div key={d.id} className="gh-row" role="button" tabIndex={0} onClick={() => go(d.id, !d.opened_at)}
                  onKeyDown={e => { if (e.key === "Enter") go(d.id, !d.opened_at); }}
                  style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 16, minHeight: 56, padding: "8px 20px", boxShadow: `0 1px 0 ${T.line}` }}>
                  <span style={{ fontSize: SIZE.body, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                  <span style={{ fontFamily: T.mono, textAlign: "right" }}>{d.questions}</span>
                  <span style={{ color: d.opened_at ? T.text : T.faint }}>{d.opened_at ? dayOf(d.opened_at) : "·"}</span>
                  <span style={{ fontFamily: T.mono, textAlign: "right", color: all ? T.ok : T.text }}>
                    {stats ? (d.opened_at ? (of ? `${d.finished} / ${of}` : d.finished) : "·") : ""}
                  </span>
                  <span style={{ fontFamily: T.mono, textAlign: "right" }}>{stats ? (d.average === null || d.average === undefined ? "·" : `${d.average}%`) : ""}</span>
                  <span style={{ color: spots.length ? T.text : T.faint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spots.length ? spots.join(", ") : "·"}</span>
                  <span style={{ justifySelf: "end" }}><Status d={d} /></span>
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
        <button type="button" onClick={() => go(null)}
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
            const st = statusOf(d);
            return (
              <button key={d.id} type="button" onClick={() => go(d.id, !d.opened_at)} aria-current={on ? "page" : undefined}
                style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr)", alignItems: "center", columnGap: 10, rowGap: 2, padding: "8px 16px", minHeight: 48, border: "none", textAlign: "left", cursor: "pointer", fontFamily: T.font,
                  background: on ? T.panel2 : "transparent", boxShadow: on ? `inset 3px 0 0 ${T.accent}` : "none", color: T.text }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: st === "Open" ? T.ok : st === "Draft" ? T.ghost : T.panel, boxShadow: st === "Closed" ? `inset 0 0 0 1.5px ${T.ghost}` : "none" }} />
                <span style={{ fontSize: SIZE.small, fontWeight: on ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                <span />
                <span style={{ fontSize: SIZE.micro, color: T.faint }}>{st}{d.opened_at ? ` · ${dayOf(d.opened_at)}` : ""}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <main style={{ minWidth: 0 }}>{main}</main>
    </div>
  );
}
