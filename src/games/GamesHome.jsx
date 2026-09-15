// A group's games, the way the host meets them: the list, adding one, setting
// one up, and running it. The one component a host app mounts.
//
//   <GamesHome supabase={sb} groupKey="comm118" context="COMM 118" roster={students} onScreen={cast} />
//
// Where you are is kept in the address (#game=<id>, #game=<id>&edit), so a
// reload in the middle of class comes back to the game that is running.

import { useMemo, useState, useEffect, useCallback } from "react";
import { DEFAULT_THEME, SIZE } from "../tokens.js";
import { listGames, createGame } from "./host.js";
import { GamePanelLive } from "./GamePanel.jsx";
import GameSetup from "./GameSetup.jsx";

const HIT = 34;

const readHash = () => {
  if (typeof location === "undefined") return {};
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  return { game: p.get("game"), edit: p.has("edit") };
};
const writeHash = (game, edit) => {
  const h = game ? `#game=${game}${edit ? "&edit" : ""}` : " ";
  history.replaceState(null, "", h === " " ? location.pathname + location.search : h);
};

const statusOf = (d) => (d.closed_at ? "Closed" : d.opened_at ? "Open" : "Draft");

export default function GamesHome({ supabase, groupKey, context, roster = [], theme, onScreen, onError, onGame }) {
  const T = useMemo(() => ({ ...DEFAULT_THEME, ...theme }), [theme]);
  const [where, setWhere] = useState(readHash);
  const [games, setGames] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const go = useCallback((game, edit = false) => { writeHash(game, edit); setWhere({ game, edit }); }, []);

  const refresh = useCallback(async () => {
    try { setGames(await listGames(supabase, { groupKey })); } catch (e) { onError?.(e); setGames([]); }
  }, [supabase, groupKey, onError]);

  useEffect(() => { if (!where.game) refresh(); }, [where.game, refresh]);

  if (where.game && where.edit) {
    return <GameSetup supabase={supabase} deckId={where.game} roster={roster} context={context} theme={theme}
      onDone={() => go(where.game)} onBack={() => go(null)} onError={onError} />;
  }
  if (where.game) {
    return <GamePanelLive supabase={supabase} deckId={where.game} context={context} roster={roster} theme={theme}
      onScreen={onScreen} onError={onError} onBack={() => go(null)} onEdit={() => go(where.game, true)} onChange={onGame} />;
  }

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try { const d = await createGame(supabase, { groupKey, title }); setTitle(""); go(d.id, true); }
    catch (e) { onError?.(e); }
    finally { setBusy(false); }
  };

  const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: HIT, padding: "0 14px", borderRadius: T.radius, fontFamily: T.font, fontSize: SIZE.small, fontWeight: 600, cursor: "pointer", border: "none", background: T.accent, color: "#ffffff" };
  const tone = { Open: [T.ok, T.okTint], Draft: [T.dim, T.panel2], Closed: [T.faint, T.panel2] };

  return (
    <div className="gh" style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.font, fontSize: SIZE.small }}>
      <style>{`.gh *{box-sizing:border-box}.gh-row{cursor:pointer}.gh-row:hover{background:${T.panel2}}.gh button:focus-visible,.gh input:focus-visible,.gh-row:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}`}</style>
      <div style={{ padding: "20px 32px", background: T.panel, boxShadow: `0 1px 0 ${T.line}`, display: "flex", flexDirection: "column", gap: 4 }}>
        {context ? <span style={{ fontSize: SIZE.micro, color: T.faint }}>{context}</span> : null}
        <span style={{ fontSize: SIZE.head, fontWeight: 600, letterSpacing: "-0.01em" }}>Games</span>
      </div>
      <div style={{ maxWidth: 880, padding: "24px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} aria-label="Title"
            style={{ flex: 1, minHeight: HIT + 6, padding: "6px 12px", borderRadius: 8, border: "none", boxShadow: `inset 0 0 0 1px ${T.line}`, background: T.panel, color: T.text, fontFamily: T.font, fontSize: 16 }} />
          <button type="button" style={{ ...btn, ...(title.trim() ? {} : { background: T.line, color: T.dim, cursor: "default" }) }} disabled={!title.trim() || busy} onClick={add}>Add game</button>
        </div>
        <div style={{ background: T.panel, borderRadius: T.radiusLarge, boxShadow: `0 0 0 1px ${T.line}`, overflow: "hidden" }}>
          {(games || []).map(d => {
            const st = statusOf(d);
            return (
              <div key={d.id} className="gh-row" role="button" tabIndex={0} onClick={() => go(d.id)}
                onKeyDown={e => { if (e.key === "Enter") go(d.id); }}
                style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 90px 80px", alignItems: "center", gap: 16, minHeight: 56, padding: "0 20px", boxShadow: `0 1px 0 ${T.line}` }}>
                <span style={{ fontSize: SIZE.body, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span>
                <span style={{ fontFamily: T.mono, color: T.faint, textAlign: "right" }}>{d.questions}</span>
                <span style={{ justifySelf: "end", fontSize: SIZE.micro, fontWeight: 600, padding: "3px 10px", borderRadius: 999, color: tone[st][0], background: tone[st][1] }}>{st}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
