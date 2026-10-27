"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, BatteryMedium, BookOpen, Check, CircleHelp, CloudRain, Copy, Eye, Flower2, Heart, Leaf, Lock, MapPin, Orbit, Pause, Play, Radio, RotateCcw, SkipForward, Sparkles, Sprout, Sun, Zap, ZapOff } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { createWorld } from "@/lib/habitat/engine";
import { ConstructionBoard } from "@/components/construction-board";
import { WorldMap } from "@/components/world-map";
import { OwnerAccess } from "@/components/owner-access";
import { parseVisit, summarizeVisit, visitMarker, VISIT_KEY, type LastVisit } from "@/lib/habitat/return-visit";
import { EVENT_LABELS, PLACES, PROFILES, RESIDENT_IDS, moodLabel, worldTime } from "@/lib/habitat/residents";
import type { ChronicleEntry, Intervention, OfflineSummary, Resident, ResidentId, WorldAction, WorldResponse } from "@/lib/habitat/types";

function Glyph({ id, size = 20 }: { id: ResidentId; size?: number }) {
  const Icon = id === "moss" ? Sprout : id === "lux" ? Sun : Sparkles;
  return <Icon size={size} strokeWidth={1.4} aria-hidden="true" />;
}
function Avatar({ id, large = false }: { id: ResidentId; large?: boolean }) {
  return <span className={`avatar ${large ? "avatar-large" : ""}`} style={{ "--resident": PROFILES[id].color } as CSSProperties}><Glyph id={id} size={large ? 29 : 20} /></span>;
}
function Entry({ entry, compact = false }: { entry: ChronicleEntry; compact?: boolean }) {
  const time = worldTime(entry.tick);
  const profile = entry.actor === "world" ? null : PROFILES[entry.actor];
  return <article className={`log-entry ${compact ? "compact" : ""}`}>
    <span className="log-symbol" style={{ color: profile?.color ?? "#b7c4b6" }}>{entry.actor === "world" ? <Orbit size={17} /> : <Glyph id={entry.actor} size={17} />}</span>
    <div className="log-copy"><div className="log-meta"><span>{profile?.name ?? "Habitat"}</span><time>Day {time.day} · {time.time}</time></div><h3>{entry.title}</h3>{!compact && <p>{entry.text}</p>}</div>
  </article>;
}

function ConversationCard({ entry, loaded, onSelect }: {
  entry: ChronicleEntry | null;
  loaded: boolean;
  onSelect: (id: ResidentId) => void;
}) {
  const time = entry ? worldTime(entry.tick) : null;
  const speakers = entry
    ? RESIDENT_IDS.filter(id => entry.text.includes(`${PROFILES[id].name}: “`))
    : [];
  return <section className="world-panel" aria-labelledby="conversation-heading">
    <div style={{ padding: "18px 20px" }}>
      <div className="section-label" style={{ flexWrap: "wrap" }}>
        <h2 id="conversation-heading">Around the habitat</h2>
        {time && <time style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Day {time.day} · {time.time}</time>}
      </div>
      {entry && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {speakers.map(id => <button
          key={id}
          type="button"
          className="read-only-chip"
          style={{ color: PROFILES[id].color, minHeight: 44 }}
          onClick={() => onSelect(id)}
          aria-label={`View ${PROFILES[id].name}'s profile`}
        ><Glyph id={id} size={16}/>{PROFILES[id].name}<ArrowUpRight size={14}/></button>)}
      </div>}
      <div aria-live="polite" aria-atomic="true" style={{ overflowWrap: "anywhere" }}>
        {entry ? entry.text.split(" — ").map((line, index) =>
          <p key={index} style={{ margin: "8px 0", lineHeight: 1.7 }}>{line}</p>
        ) : <p className="retention-note" style={{ marginBottom: 0 }}>
          {loaded ? "A quiet moment for now. Their next conversation will appear here." : "Listening for life in the habitat…"}
        </p>}
      </div>
      {entry && <p className="retention-note" style={{ marginBottom: 0 }}>Their latest conversation · Select a name to look closer.</p>}
    </div>
  </section>;
}

function ResidentCard({ resident, selected, onSelect }: { resident: Resident; selected: boolean; onSelect: () => void }) {
  const profile = PROFILES[resident.id];
  return <button className={`resident-card ${selected ? "selected" : ""}`} onClick={onSelect} aria-pressed={selected} style={{ "--resident": profile.color } as CSSProperties}>
    <div className="resident-card-top"><Avatar id={resident.id} /><div><strong>{profile.name}</strong><span>{profile.role}</span></div><ArrowUpRight size={16} /></div>
    <p>{resident.activity}</p>
    <div className="resident-card-bottom"><span><span className="mood-dot" />{moodLabel(resident.mood)}</span><span><BookOpen size={13} />{resident.memories.length}</span></div>
  </button>;
}
function formatAway(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown | Promise<unknown> };
type ModelContext = { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> };

export default function Habitat({ visitorMode: forceVisitor = false }: { visitorMode?: boolean }) {
  const [data, setData] = useState<WorldResponse>(() => ({ world: createWorld(), revision: 0 }));
  const [selected, setSelected] = useState<ResidentId>("moss");
  const [conversation, setConversation] = useState<{ epoch: number; entry: ChronicleEntry | null } | null>(null);
  const focusPanel = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineSummary, setOfflineSummary] = useState<OfflineSummary | null>(null);
  const [copied, setCopied] = useState(false), [shareUrl, setShareUrl] = useState("");
  const dataRef = useRef(data), loadedRef = useRef(false), lock = useRef(false), reading = useRef(false);
  const previousVisit = useRef<LastVisit | null>(null), active = useRef(false);
  const visitorMode = forceVisitor || data.mode !== "owner";
  const playing = data.world.clock.running, speed = data.world.clock.speed;
  const catchingUp = (data.pendingSteps ?? 0) > 0;

  const saveVisit = useCallback(() => {
    if (!loadedRef.current) return;
    try { localStorage.setItem(VISIT_KEY, JSON.stringify(visitMarker(dataRef.current.world, Date.now()))); } catch { /* Storage is optional. */ }
  }, []);
  const restoreVisit = useCallback(() => {
    try { previousVisit.current = parseVisit(localStorage.getItem(VISIT_KEY)); } catch { previousVisit.current = null; }
  }, []);
  const accept = useCallback((next: WorldResponse) => {
    if (!active.current || (loadedRef.current && next.revision < dataRef.current.revision)) return;
    dataRef.current = next; setData(next); setLoaded(true); loadedRef.current = true;
    const latest = next.world.chronicle.find(entry =>
      entry.kind === "encounter" && entry.title.endsWith(", a small conversation")
    ) ?? null;
    setConversation(previous => {
      // A new world must not retain conversations from the previous one.
      if (!previous || previous.epoch !== next.world.epoch) {
        return { epoch: next.world.epoch, entry: latest };
      }
      if (latest && (!previous.entry || latest.tick >= previous.entry.tick)) {
        return previous.entry?.id === latest.id ? previous : { epoch: next.world.epoch, entry: latest };
      }
      // Keep the conversation readable while newer events fill the chronicle.
      return previous;
    });
    if (previousVisit.current) {
      const summary = summarizeVisit(previousVisit.current, next.world, Date.now());
      if (summary) setOfflineSummary(summary);
      if (!next.pendingSteps) previousVisit.current = null;
    }
    if (!document.hidden && !next.pendingSteps) saveVisit();
  }, [saveVisit]);

  const load = useCallback(async (quiet = false) => {
    if (reading.current || lock.current) return;
    reading.current = true;
    if (!quiet) setBusy(true);
    try {
      const res = await fetch("/api/habitat" + (forceVisitor ? "?mode=visitor" : ""), { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const body = await res.json() as WorldResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The habitat could not be loaded.");
      if (!body.world?.clock || !Number.isInteger(body.revision)) throw new Error("The habitat returned an incomplete state. Please reconnect.");
      accept(body);
      if (active.current) setError(null);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Connection interrupted. Reconnecting automatically…");
    } finally {
      reading.current = false;
      if (active.current && !quiet) setBusy(false);
    }
  }, [accept, forceVisitor]);

  const act = useCallback(async (action: WorldAction): Promise<WorldResponse> => {
    if (forceVisitor || dataRef.current.mode !== "owner") throw new Error("Only the owner can change the habitat.");
    if (!loadedRef.current) throw new Error("Wait for the habitat to load.");
    if (lock.current) throw new Error("A habitat action is already in progress.");
    lock.current = true; setBusy(true); setError(null);
    try {
      const res = await fetch("/api/habitat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ actionRevision: dataRef.current.world.actionRevision, action }) });
      const body = await res.json() as WorldResponse & { error?: string };
      if (res.status === 409 && body.world) {
        accept(body);
        throw new Error("Another owner action was saved first. The latest world is loaded; you can try again.");
      }
      if (res.status === 403) accept({ ...dataRef.current, mode: "visitor" });
      if (!res.ok) throw new Error(body.error ?? "Your change could not be confirmed.");
      if (!body.world?.clock || !Number.isInteger(body.revision)) throw new Error("Reconnect to confirm your change.");
      if (action.type === "reset") { previousVisit.current = null; setOfflineSummary(null); }
      accept(body);
      return body;
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Your change could not be confirmed. Reconnect before trying again.");
      throw cause;
    } finally { lock.current = false; setBusy(false); }
  }, [accept, forceVisitor]);
  const invoke = (action: WorldAction) => { void act(action).catch(() => {}); };

  useEffect(() => {
    active.current = true; restoreVisit();
    let stopped = false, generation = 0, timer: ReturnType<typeof setTimeout>;
    async function poll(run: number) {
      if (!document.hidden && !lock.current) await load(loadedRef.current);
      if (!stopped && run === generation) timer = setTimeout(() => { void poll(run); }, dataRef.current.pendingSteps ? 300 : Math.max(1800, 6500 / dataRef.current.world.clock.speed));
    }
    const visibility = () => {
      generation += 1; clearTimeout(timer);
      if (document.hidden) saveVisit();
      else { restoreVisit(); void poll(generation); }
    };
    void poll(generation);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", saveVisit);
    return () => { stopped = true; active.current = false; clearTimeout(timer); saveVisit(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", saveVisit); };
  }, [load, restoreVisit, saveVisit]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Tool) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional capability. */ } };
    register({ name: "read_habitat", title: "Read the habitat", description: "Read the saved world, residents, memories, decisions and relationships.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
      execute(input) { if (!input || typeof input !== "object" || Object.keys(input).length) throw new Error("Expected an empty object."); if (!loadedRef.current) throw new Error("Habitat is still loading."); return dataRef.current; } });
    if (!visitorMode) register({ name: "introduce_habitat_event", title: "Introduce a habitat event", description: "Owner only. Introduce rain, a relic or a blackout, advance one turn and save. Fails while another event is active.",
      inputSchema: { type: "object", properties: { event: { type: "string", enum: ["rain", "relic", "blackout"] } }, required: ["event"], additionalProperties: false }, annotations: { readOnlyHint: false },
      async execute(input) {
        if (!input || typeof input !== "object" || Object.keys(input).length !== 1 || !["rain", "relic", "blackout"].includes(String((input as { event: string }).event))) throw new Error("Choose rain, relic or blackout.");
        const next = await act({ type: "event", event: (input as { event: Intervention }).event });
        return { tick: next.world.tick, intervention: next.world.intervention, memories: next.world.totalMemories };
      } });
    return () => lifecycle.abort();
  }, [act, visitorMode]);

  const copyVisitorLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "visitor");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url.toString()); setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setShareUrl(url.toString()); }
  };

  const world = data.world, clock = worldTime(world.tick);
  const resident = world.residents.find(item => item.id === selected)!;
  const profile = PROFILES[selected];
  const remaining = world.intervention?.remaining ?? 0;
  const status = !loaded ? "Connecting" : busy ? "Saving" : visitorMode ? "Read-only visitor" : "All changes saved";

  return <Tabs defaultValue="observe" className="habitat-app">
    <header className="topbar">
      <a className="brand" href={visitorMode ? "?mode=visitor" : "/"} aria-label="Echo Habitat home"><img src="/favicon.svg" width="37" height="37" alt="" /><span>ECHO<span className="brand-light">HABITAT</span></span><span className="version">04</span></a>
      <TabsList variant="line" className="main-nav" aria-label="Main navigation"><TabsTrigger value="observe"><Eye size={16} />Observe</TabsTrigger><TabsTrigger value="chronicle"><BookOpen size={16} />Chronicle<span className="nav-count">{world.chronicle.length}</span></TabsTrigger></TabsList>
      <div className="header-right">
        {visitorMode ? <span className="visitor-mode-label"><Lock size={13}/>Visitor mode</span> : <button className="visitor-link-button" onClick={() => void copyVisitorLink()}><Copy size={13}/>{copied ? "Copied" : "Visitor link"}</button>}
        {loaded && <OwnerAccess data={data} refresh={() => load()} visitorMode={forceVisitor}/>}
        <span className="simulation-label">Life simulation</span>
        <Dialog><DialogTrigger asChild><button className="icon-button" aria-label="About this habitat"><CircleHelp size={19} /></button></DialogTrigger><DialogContent className="about-dialog"><DialogHeader><DialogTitle>A small world, unfolding.</DialogTitle><DialogDescription>ECHO HABITAT is an interactive life simulation. Three residents move, decide, remember and build together.</DialogDescription></DialogHeader><div className="about-body"><p>Select a resident to see their thoughts and memories. They travel between home, shared meetings and the district they are building. Their choices follow authored rules, individual needs and shared resources; this simulation does not use a language model.</p><p>Moss, Lux and Echo gather shared resources and hold a visible council before a new project begins. Building sites pass through foundation, frame and finishing stages, while completed bridges reveal new island fragments.</p><p>The shared clock keeps elapsed time even when nobody is here. The server catches up when the world is visited or its scheduled job runs. Pausing the clock stops progress for everyone. No elapsed cycles are discarded.</p><p>{visitorMode ? "You are viewing a read-only visitor link. You can inspect residents, memories and construction, but owner controls are disabled." : "Use Visitor link to copy a read-only URL for someone who only needs to watch the habitat."}</p></div></DialogContent></Dialog>
      </div>
    </header>

    <main className="main-shell">
      <div className="page-heading"><div><div className="eyebrow"><span className="tiny-line" />EXPERIMENT 001 · WORLD BUILDING</div><h1>A world of their own<span>.</span></h1><p>Three lives. Shared decisions. A world growing beyond its edges.</p></div><div className="world-clock"><span className="eyebrow">HABITAT TIME</span><div>Day {clock.day}<span>/</span><strong>{clock.time}</strong></div></div></div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button disabled={busy} onClick={() => void load()}>Reconnect</button></div>}
      {offlineSummary && <div className="offline-banner" role="status"><div><Orbit size={18}/><span><strong>Since your last visit</strong><small>{formatAway(offlineSummary.elapsedMs)} passed · {offlineSummary.steps} cycles · {offlineSummary.structuresBuilt} structures completed · {offlineSummary.decisionsMade} shared decisions</small></span></div><button onClick={() => setOfflineSummary(null)}>Dismiss</button></div>}
      {offlineSummary && offlineSummary.highlights.length > 0 && <details className="return-highlights"><summary>A few things that happened</summary>{offlineSummary.highlights.map(entry => <Entry key={entry.id} entry={entry}/>)}</details>}
      {catchingUp && <div className="visitor-banner" role="status"><Orbit size={16}/>{data.pendingSteps?.toLocaleString()} cycles to catch up. Their history is being restored…</div>}
      {shareUrl && <div className="visitor-banner"><label className="share-fallback">Copy this visitor link<input readOnly value={shareUrl} onFocus={event => event.target.select()}/></label><button onClick={() => setShareUrl("")}>Close</button></div>}
      {visitorMode && loaded && <div className="visitor-banner"><Lock size={16}/><span><strong>Visitor mode</strong> — watch, inspect and read. Controls that change the shared habitat are disabled. Project owner? Use the owner button at the top to sign in or view setup instructions.</span></div>}

      <TabsContent value="observe" className="observe-view">
        <section className="world-column" aria-label="Habitat observation">
          <div className="world-panel">
            <div className="world-toolbar"><div className="world-status"><span className={loaded && playing ? "status-dot running" : "status-dot"} />{!loaded ? "Connecting to habitat" : playing ? "Life is unfolding" : "A moment of stillness"}</div>{visitorMode ? <span className="read-only-chip"><Lock size={12}/>Read only</span> : <div className="playback"><button disabled={!loaded || busy || catchingUp} onClick={() => invoke({ type: "playback", running: playing, speed: speed === 1 ? 2 : speed === 2 ? 4 : 1 })} className="speed-button" aria-label={`Simulation speed ${speed} times. Click to change.`}>{speed}×</button><span className="control-divider"/><button className="icon-button" disabled={!loaded || busy || catchingUp} onClick={() => invoke({ type: "playback", running: !playing, speed })} aria-label={playing ? "Pause simulation" : "Play simulation"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button className="icon-button" disabled={!loaded || busy || catchingUp} onClick={() => invoke({ type: "step" })} aria-label="Advance one step"><SkipForward size={17}/></button></div>}</div>
            <WorldMap key={world.epoch} world={world} selected={selected} onSelect={setSelected}/>
            <div className="world-metrics"><div><Leaf size={16}/><span>Growth</span><strong>{world.growth}<small>%</small></strong></div><div><Zap size={16}/><span>Power</span><strong>{world.power}<small>%</small></strong></div><div><Sparkles size={16}/><span>Discoveries</span><strong>{String(world.discoveries).padStart(2,"0")}</strong></div><div className="metrics-cycle">CYCLE <strong>{String(world.tick).padStart(3,"0")}</strong></div></div>
          </div>

          <ConversationCard
            entry={conversation?.epoch === world.epoch ? conversation.entry : null}
            loaded={loaded}
            onSelect={id => {
              setSelected(id);
              focusPanel.current?.scrollIntoView({ block: "start" });
              focusPanel.current?.focus({ preventScroll: true });
            }}
          />
          <ConstructionBoard world={world}/>
          <section className="residents-section" aria-labelledby="resident-heading"><div className="section-label"><h2 id="resident-heading">The residents <span>03</span></h2><span>Every one a little different</span></div><div className="resident-grid">{world.residents.map(item => <ResidentCard key={item.id} resident={item} selected={item.id === selected} onSelect={() => setSelected(item.id)}/>)}</div></section>

          {visitorMode ? <section className="visitor-observe-card"><Lock size={19}/><div><strong>Owner controls are hidden here.</strong><p>The visitor link can follow movement, councils, construction, memories and new districts without sending simulation actions.</p></div></section> : <section className="interventions" aria-labelledby="event-heading"><div className="section-label"><h2 id="event-heading">A gentle nudge</h2><span>{remaining ? `${remaining} steps until this event settles` : "Change something. See what follows."}</span></div><div className="event-grid">{([{ id:"rain", icon:CloudRain, text:"Let something grow" },{ id:"relic", icon:Sparkles, text:"Give curiosity a reason" },{ id:"blackout", icon:ZapOff, text:"See who comes together" }] as const).map(event => <button key={event.id} className={`event-button ${world.intervention?.kind === event.id ? "event-active" : ""}`} onClick={() => invoke({ type:"event", event:event.id })} disabled={!loaded || busy || catchingUp || !!world.intervention}><event.icon size={21} strokeWidth={1.4}/><span><strong>{EVENT_LABELS[event.id]}</strong><small>{world.intervention?.kind === event.id ? "The habitat is responding…" : event.text}</small></span><ArrowUpRight size={14}/></button>)}</div></section>}
        </section>

        <aside ref={focusPanel} tabIndex={-1} className="focus-panel" style={{ "--resident": profile.color } as CSSProperties} aria-label={`${profile.name}'s profile`}>
          <div className="focus-top"><span className="eyebrow">IN FOCUS</span><span className="profile-number">0{RESIDENT_IDS.indexOf(selected)+1} / 03</span></div>
          <div className="profile-identity"><Avatar id={selected} large/><div><h2>{profile.name}</h2><span>{profile.role}</span></div><span className="profile-mood">{moodLabel(resident.mood)}</span></div>
          <p className="profile-description">{profile.description}</p>
          <div className="traits">{profile.traits.map(trait => <span key={trait}>{trait}</span>)}</div>
          <div className="thought"><span className="eyebrow"><Radio size={12}/> A PASSING THOUGHT</span><p>“{resident.thought}”</p><span className="thought-location"><MapPin size={13}/>{PLACES[resident.location].name}</span></div>
          <div className="needs"><div><span><BatteryMedium size={14}/>Energy</span><strong>{resident.energy}%</strong><Progress value={resident.energy} aria-label={`${profile.name}'s energy`}/></div><div><span><Heart size={14}/>Wellbeing</span><strong>{resident.mood}%</strong><Progress value={resident.mood} aria-label={`${profile.name}'s wellbeing`}/></div></div>
          <div className="purpose"><span className="eyebrow">A LITTLE PURPOSE</span><p><Flower2 size={17}/>{profile.goal}</p><span>{resident.progress} small steps toward it</span></div>
          <Tabs defaultValue="memories" className="profile-tabs"><TabsList variant="line" aria-label="Resident details"><TabsTrigger value="memories">Memories <span>{resident.memories.length}</span></TabsTrigger><TabsTrigger value="bonds">Connections</TabsTrigger></TabsList>
            <TabsContent value="memories"><div className="memory-list">{resident.memories.map(memory => <article className="memory" key={memory.id}><span className="memory-dot"/><div><span className="memory-meta">{memory.kind} <span>Day {worldTime(memory.tick).day} · {worldTime(memory.tick).time}</span></span><p>{memory.text}</p></div></article>)}</div>{resident.memories.length > 4 && <p className="retention-note">Showing {resident.memories.length} retained memories.</p>}</TabsContent>
            <TabsContent value="bonds"><div className="bond-list">{RESIDENT_IDS.filter(id=>id!==selected).map(id=><div className="bond" key={id}><Avatar id={id}/><div><strong>{PROFILES[id].name}<span>{resident.bonds[id]>=80?"A familiar presence":resident.bonds[id]>=65?"Growing closer":"Getting acquainted"}</span></strong><Progress value={resident.bonds[id]} aria-label={`Connection with ${PROFILES[id].name}`}/></div><span>{resident.bonds[id]}%</span></div>)}</div><p className="retention-note">Shared moments and facing the unexpected together bring residents closer.</p></TabsContent>
          </Tabs>
          <div className="recent-heading"><span className="eyebrow">JUST HAPPENED</span><span className="timeline-line"/></div><div className="recent-log">{world.chronicle.slice(0,2).map(entry=><Entry entry={entry} key={entry.id} compact/>)}</div>
        </aside>
      </TabsContent>

      <TabsContent value="chronicle"><section className="chronicle-panel"><div className="chronicle-heading"><div><span className="eyebrow">THE THINGS THAT STAY</span><h2>A life, in small moments.</h2><p>The habitat&apos;s encounters, discoveries, decisions and turning points, newest first.</p></div><span className="chronicle-total"><BookOpen size={24}/><strong>{world.totalMemories}</strong>memories made</span></div><div className="chronicle-list">{world.chronicle.map(entry=><Entry entry={entry} key={entry.id}/>)}</div><p className="retention-note">The latest {world.chronicle.length} of up to 240 chronicle entries are kept.</p></section></TabsContent>

      <footer className="footer"><span><Orbit size={15}/>A small world, still becoming.</span><div><span className="save-status" role="status">{loaded && !busy && !error ? <Check size={13}/> : <span className="status-dot"/>}{error ? "Connection needs attention" : status}</span>{!visitorMode && <AlertDialog><AlertDialogTrigger asChild><button className="reset-button" disabled={!loaded || busy}><RotateCcw size={13}/>New beginning</button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Begin a new habitat?</AlertDialogTitle><AlertDialogDescription>This clears all buildings, resources, districts, decisions, memories, relationships and the chronicle for this habitat. Moss, Lux and Echo will start again from their first morning. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep this world</AlertDialogCancel><AlertDialogAction onClick={()=>invoke({type:"reset"})}>Begin again</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div></footer>
    </main>
  </Tabs>;
}
