import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import INITIAL_DATA from "./initialFlights.json";

const TODAY = new Date().toISOString().split("T")[0];
const STORAGE_KEY = "flight-tracker-v1";

function ts() { return new Date().toISOString(); }

// Load from localStorage, fallback to Excel seed data
function loadFlights() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed?.flights) && parsed.flights.length > 0) return parsed.flights;
    }
  } catch(e) { console.warn("localStorage load failed", e); }
  return INITIAL_DATA.flights;
}

function saveFlights(flights) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ flights, savedAt: new Date().toISOString() }));
  } catch(e) { console.warn("localStorage save failed", e); }
}

// ── Netlify Blobs via serverless function ─────────────────────────────────────
const STORE_FN = "/.netlify/functions/store";

async function storeLoad() {
  const res = await fetch(STORE_FN);
  if (res.status === 404) throw new Error("No saved data yet — click Save first.");
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
  const data = await res.json();
  if (!Array.isArray(data?.flights)) throw new Error("Unexpected data format");
  return data.flights;
}

async function storeSave(flights) {
  const body = JSON.stringify({ flights, version: 1, savedAt: new Date().toISOString() }, null, 2);
  const res = await fetch(STORE_FN, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || `HTTP ${res.status}`); }
  return res.json();
}

// ── Local JSON export/import (backup) ────────────────────────────────────────
function downloadJSON(flights) {
  const blob = new Blob([JSON.stringify({ flights, version: 1, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flight-tracker-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function uploadJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (Array.isArray(data?.flights)) resolve(data.flights);
        else reject(new Error("Invalid file format"));
      } catch(err) { reject(err); }
    };
    reader.readAsText(file);
  });
}

// Ordered cycle for tap-to-change
const STATUS_CYCLE = ["Waitlisted","Reserved","Issued","Purchased","Cancelled"];

const STATUS_CONFIG = {
  "Issued":    { color:"#6a7a4a", bg:"#f4f5ee",  label:"ISSUED",    icon:"✓" },
  "Purchased": { color:"#6a7a8a", bg:"#f0f2f4",  label:"PURCHASED", icon:"💳" },
  "Waitlisted":{ color:"#c4622a", bg:"#fdf2ec",  label:"WAITLISTED",icon:"⏳" },
  "Reserved":  { color:"#7a6a8a", bg:"#f4f0f5",  label:"RESERVED",  icon:"📌" },
  "Cancelled": { color:"#a84a3a", bg:"#fdf0ee",  label:"CANCELLED", icon:"✕" },
};

const EMPTY_FORM = {
  passenger:"", ref:"", airline:"SQ", flightNo:"", destination:"",
  depDate:"", depTime:"", arrDate:"", arrTime:"",
  status:"Waitlisted", ticketType:"Redemption", cabinClass:"",
  mileage:"", tax:"", kfAcct:"", tripPurpose:"", remarks:"",
  ticketingDeadline:"", lastChaserDate:"", preferred:false
};

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}
function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short" });
}
function daysBetween(d1, d2) {
  const a = new Date(d1), b = new Date(d2);
  return Math.round((b - a) / 86400000);
}
function daysUntilDep(depDate) {
  return daysBetween(TODAY, depDate);
}
function fmtDaysUntil(n) {
  if (n < 0)  return { label: `${Math.abs(n)}d ago`, color:"#a89880" };
  if (n === 0) return { label: "TODAY",               color:"#c4622a" };
  if (n === 1) return { label: "1 day",               color:"#c4622a" };
  if (n <= 7)  return { label: `${n} days`,           color:"#c4622a" };
  if (n <= 30) return { label: `${n} days`,           color:"#8a9a7a" };
  return               { label: `${n} days`,           color:"#a08870" };
}
function monthKey(depDate) {
  const d = new Date(depDate);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  return new Date(+y, +m-1, 1).toLocaleDateString("en-GB", { month:"long", year:"numeric" });
}

// Inline date editor component
function InlineDateEdit({ value, onSave, placeholder = "Set date" }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const inp = useRef(null);
  useEffect(() => { if (editing && inp.current) inp.current.focus(); }, [editing]);
  if (!editing) return (
    <span
      onClick={e => { e.stopPropagation(); setEditing(true); setVal(value || ""); }}
      style={{ cursor:"pointer", borderBottom:`1px dashed ${value?"#b8a080":"#ddd0c0"}`, color:value?"#7a6040":"#c4b090", fontSize:11, padding:"1px 3px", borderRadius:2, transition:"border-color .15s" }}
      title="Tap to edit"
    >
      {value ? formatDate(value) : placeholder}
    </span>
  );
  return (
    <span onClick={e=>e.stopPropagation()} style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
      <input
        ref={inp} type="date" value={val}
        onChange={e => setVal(e.target.value)}
        style={{ background:"#fff", border:"1px solid #d8b880", color:"#3a2c18", borderRadius:4, padding:"2px 6px", fontSize:11, fontFamily:"inherit", outline:"none" }}
      />
      <button onClick={() => { onSave(val); setEditing(false); }} style={{ background:"#c46030", border:"none", color:"#fff", borderRadius:4, padding:"2px 8px", cursor:"pointer", fontSize:11 }}>✓</button>
      <button onClick={() => setEditing(false)} style={{ background:"none", border:"1px solid #e0d0d8", color:"#a08898", borderRadius:4, padding:"2px 6px", cursor:"pointer", fontSize:11 }}>✕</button>
    </span>
  );
}

// Status cycle popup
function StatusBadge({ status, onChange }) {
  const [open, setOpen] = useState(false);
  const sc = STATUS_CONFIG[status] || STATUS_CONFIG["Cancelled"];
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <span
        className="badge status-badge-btn"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ background:sc.bg, color:sc.color, border:`1px solid ${sc.color}55`, cursor:"pointer", fontSize:10, userSelect:"none" }}
        title="Tap to change status"
      >
        {sc.label} ▾
      </span>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, background:"#fff", border:"1px solid #e8d8c0", borderRadius:10, padding:"6px", zIndex:999, display:"flex", flexDirection:"column", gap:3, minWidth:145, boxShadow:"0 8px 32px rgba(140,100,60,.12)" }}>
          {STATUS_CYCLE.map(s => {
            const c = STATUS_CONFIG[s];
            return (
              <button key={s} onClick={e => { e.stopPropagation(); onChange(s); setOpen(false); }} style={{ background:status===s?c.bg:"transparent", border:`1px solid ${status===s?c.color+"66":"transparent"}`, color:status===s?c.color:"#7a6848", borderRadius:6, padding:"6px 10px", cursor:"pointer", fontFamily:"inherit", fontSize:11, textAlign:"left", display:"flex", alignItems:"center", gap:7, transition:"all .1s" }}>
                <span>{c.icon}</span> {c.label} {status===s&&"✓"}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [flights, setFlights] = useState(() => loadFlights());
  const [view, setView]       = useState("list");
  const [editId, setEditId]   = useState(null);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [sort, setSort]       = useState({ key:"depDate", dir:"asc" });
  const [filter, setFilter]   = useState({ status:"all", passenger:"all", search:"" });
  const [toast, setToast]     = useState(null);
  const [expandedId, setExpandedId]       = useState(null);
  const [collapsedTrips, setCollapsedTrips] = useState(new Set());
  const [driveStatus, setDriveStatus]     = useState(null);
  const [driveMsg, setDriveMsg]           = useState("");

  // Auto-save to localStorage whenever flights change
  useEffect(() => { saveFlights(flights); }, [flights]);

  function toggleTrip(tripKey) {
    setCollapsedTrips(prev => {
      const next = new Set(prev);
      if (next.has(tripKey)) next.delete(tripKey);
      else next.add(tripKey);
      return next;
    });
  }

  const today = TODAY;
  const passengers = useMemo(() => [...new Set(flights.map(f=>f.passenger))].sort(), [flights]);

  // Patch a single field on a flight
  function patch(id, updates) {
    setFlights(fs => fs.map(f => f.id === id ? { ...f, ...updates } : f));
  }

  // Toggle preferred — only one preferred per passenger+tripPurpose group
  function togglePreferred(id) {
    setFlights(fs => {
      const target = fs.find(f => f.id === id);
      if (!target) return fs;
      const key = (target.passenger||"") + "||" + (target.tripPurpose||"");
      const isNowPreferred = !target.preferred;
      return fs.map(f => {
        if (f.id === id) return { ...f, preferred: isNowPreferred };
        const fKey = (f.passenger||"") + "||" + (f.tripPurpose||"");
        if (isNowPreferred && fKey === key && f.status === "Waitlisted" && f.id !== id) {
          return { ...f, preferred: false };
        }
        return f;
      });
    });
  }

  // Save to Netlify Blobs
  async function handleSaveToCloud() {
    setDriveStatus("saving"); setDriveMsg("");
    try {
      const result = await storeSave(flights);
      setDriveStatus("saved");
      setDriveMsg(`Saved ${result.count} flights`);
      showToast(`✓ Saved ${result.count} flights to cloud`, "success");
    } catch(err) {
      setDriveStatus("error");
      setDriveMsg(err.message);
      showToast("Save failed: " + err.message, "error");
    }
    setTimeout(() => setDriveStatus(null), 5000);
  }

  // Load from Netlify Blobs
  async function handleLoadFromCloud() {
    setDriveStatus("loading"); setDriveMsg("");
    try {
      const loaded = await storeLoad();
      setFlights(loaded);
      setDriveStatus("loaded");
      setDriveMsg(`Loaded ${loaded.length} flights`);
      showToast(`✓ Loaded ${loaded.length} flights from cloud`, "success");
    } catch(err) {
      setDriveStatus("error");
      setDriveMsg(err.message);
      showToast("Load failed: " + err.message, "error");
    }
    setTimeout(() => setDriveStatus(null), 5000);
  }

  // Local JSON export (backup)
  function handleExport() {
    downloadJSON(flights);
    showToast(`✓ Exported ${flights.length} flights as JSON`, "success");
  }

  // Local JSON import (restore)
  const fileInputRef = useRef(null);
  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDriveStatus("loading"); setDriveMsg("");
    try {
      const imported = await uploadJSON(file);
      setFlights(imported);
      setDriveStatus("loaded");
      setDriveMsg(`Imported ${imported.length} flights from file`);
      showToast(`✓ Imported ${imported.length} flights`, "success");
    } catch(err) {
      setDriveStatus("error");
      setDriveMsg("Import failed: " + err.message);
      showToast("Import failed: " + err.message, "error");
    }
    e.target.value = "";
    setTimeout(() => setDriveStatus(null), 4000);
  }

  function handleResetToExcel() {
    if (!window.confirm("Reset to original Excel data? This will discard all local changes.")) return;
    localStorage.removeItem(STORAGE_KEY);
    setFlights(INITIAL_DATA.flights);
    showToast("Reset to original Excel data.", "info");
  }
  const reserved   = useMemo(() => flights.filter(f=>f.status==="Reserved"), [flights]);
  const confirmed  = useMemo(() => flights.filter(f=>["Issued","Purchased"].includes(f.status)), [flights]);
  const overdueWL  = useMemo(() => waitlisted.filter(f=>f.ticketingDeadline&&f.ticketingDeadline<today), [waitlisted,today]);
  const overdueRes = useMemo(() => reserved.filter(f=>f.ticketingDeadline&&f.ticketingDeadline<today), [reserved,today]);

  const filtered = useMemo(() => {
    let res = flights.filter(f => {
      if (filter.status==="overdue") {
        if (!f.ticketingDeadline||f.ticketingDeadline>=today) return false;
        if (!["Waitlisted","Reserved"].includes(f.status)) return false;
      } else if (filter.status==="Issued") {
        if (!["Issued","Purchased"].includes(f.status)) return false;
      } else if (filter.status!=="all") {
        if (f.status!==filter.status) return false;
      }
      if (filter.passenger!=="all" && f.passenger!==filter.passenger) return false;
      if (filter.search) {
        const s = filter.search.toLowerCase();
        if (![f.passenger,f.ref,f.destination,f.flightNo,f.airline,f.tripPurpose||""].join(" ").toLowerCase().includes(s)) return false;
      }
      return true;
    });
    return [...res].sort((a,b) => {
      let va, vb;
      if (sort.key==="daysLeft") {
        va = daysUntilDep(a.depDate); vb = daysUntilDep(b.depDate);
      } else if (sort.key==="addedAt") {
        va = a.addedAt||""; vb = b.addedAt||"";
      } else {
        va = a[sort.key]||""; vb = b[sort.key]||"";
      }
      if (va<vb) return sort.dir==="asc"?-1:1;
      if (va>vb) return sort.dir==="asc"?1:-1;
      return 0;
    });
  }, [flights,filter,sort,today]);

  // Group filtered flights by tripPurpose — must come AFTER filtered
  const groupedFiltered = useMemo(() => {
    const groups = [];
    const seen = new Map();
    filtered.forEach(f => {
      const key = f.tripPurpose || "(No trip name)";
      if (!seen.has(key)) {
        seen.set(key, groups.length);
        groups.push({ key, flights: [] });
      }
      groups[seen.get(key)].flights.push(f);
    });
    return groups;
  }, [filtered]);
  const reservedByMonth = useMemo(() => {
    const sorted = [...reserved].sort((a,b)=>a.depDate>b.depDate?1:-1);
    const map = {};
    sorted.forEach(f => {
      const k = monthKey(f.depDate);
      if (!map[k]) map[k] = [];
      map[k].push(f);
    });
    return map;
  }, [reserved]);

  const statCounts = [
    ["TOTAL",     flights.length,                             "#38bdf8","all"],
    ["ISSUED",    confirmed.length,                           "#22c55e","Issued"],
    ["WAITLIST",  waitlisted.length,                          "#f59e0b","Waitlisted"],
    ["RESERVED",  reserved.length,                            "#a78bfa","Reserved"],
    ["CANCELLED", flights.filter(f=>f.status==="Cancelled").length, "#ef4444","Cancelled"],
    ["⚠ OVERDUE", overdueWL.length+overdueRes.length,        "#f43f5e","overdue"],
  ];

  function handleStatClick(fval) {
    setView("list");
    setFilter(f => ({ ...f, status: f.status===fval?"all":fval, search:"" }));
  }

  function showToast(msg, type="success") {
    setToast({ msg, type });
    setTimeout(()=>setToast(null), 2800);
  }
  function handleSort(key) {
    setSort(s => ({ key, dir:s.key===key&&s.dir==="asc"?"desc":"asc" }));
  }
  function openAdd()   { setForm(EMPTY_FORM); setEditId(null); setView("add"); }
  function openEdit(f) { setForm({...f}); setEditId(f.id); setView("add"); }
  function handleSave() {
    if (!form.passenger||!form.flightNo||!form.depDate) {
      showToast("Fill required: Passenger, Flight No, Departure Date","error"); return;
    }
    if (!form.tripPurpose||!form.tripPurpose.trim()) {
      showToast("Trip Name is required — it groups flights together","error"); return;
    }
    if (editId) {
      setFlights(fs=>fs.map(f=>f.id===editId?{...form,id:editId}:f));
      showToast("Flight updated.");
    } else {
      setFlights(fs=>[...fs,{...form,id:Date.now(),addedAt:ts()}]);
      showToast("Flight added.");
    }
    setView("list");
  }
  function handleDelete(id) {
    if (!window.confirm("Delete this flight?")) return;
    setFlights(fs=>fs.filter(f=>f.id!==id));
    showToast("Deleted.","info");
  }

  const SortBtn = ({k,label}) => (
    <button className="th-btn" onClick={()=>handleSort(k)} style={{ display:"flex",alignItems:"center",gap:3,whiteSpace:"nowrap" }}>
      {label}
      <span style={{ opacity:sort.key===k?1:.25,fontSize:9 }}>{sort.key===k?(sort.dir==="asc"?"▲":"▼"):"⇅"}</span>
    </button>
  );

  // ── SHARED mini card for overview ─────────────────────────────
  const MiniCard = ({ f, showDeadline=true }) => {
    const sc = STATUS_CONFIG[f.status]||STATUS_CONFIG["Cancelled"];
    const dLeft = daysUntilDep(f.depDate);
    const dl = fmtDaysUntil(dLeft);
    const deadlineOver = f.ticketingDeadline && f.ticketingDeadline < today;
    return (
      <div style={{ background: f.preferred?"#fdf8f0":"#fff", border:`1px solid ${deadlineOver?"#e8c0a0":f.preferred?"#e0d4b8":"#e8e0d0"}`, borderRadius:8, padding:"10px 13px", marginBottom:8, borderLeft:f.preferred?"3px solid #c46030":undefined }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, flexWrap:"wrap", marginBottom:6 }}>
          <div style={{ display:"flex",alignItems:"center",gap:7,flexWrap:"wrap" }}>
            <span style={{ fontWeight:500, color:"#2c2010", fontSize:13 }}>{f.passenger}</span>
            {f.tripPurpose&&<span style={{ fontSize:11, color:"#9a8860" }}>· {f.tripPurpose}</span>}
            {f.preferred&&<span style={{ fontSize:10,background:"#2d1a00",color:"#f59e0b",border:"1px solid #78350f",borderRadius:999,padding:"1px 7px",letterSpacing:".04em" }}>★ PREFERRED</span>}
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <span style={{ fontSize:11, color:dl.color, fontWeight:600, whiteSpace:"nowrap" }}>{dl.label}</span>
            <span className="badge" style={{ background:sc.bg, color:sc.color, border:`1px solid ${sc.color}33`, fontSize:10 }}>{sc.label}</span>
            {f.status==="Waitlisted"&&(
              <button
                className={`pref-star${f.preferred?" active":""}`}
                onClick={()=>togglePreferred(f.id)}
                title={f.preferred?"Remove preferred":"Mark as preferred"}
              >★</button>
            )}
          </div>
        </div>
        <div style={{ fontSize:12, color:"#9a8860", display:"flex", gap:12, flexWrap:"wrap" }}>
          <span style={{ color:"#2c2010", fontWeight:500 }}>{f.destination}</span>
          <span>{f.airline}{f.flightNo}</span>
          <span style={{ color:"#9a7850", fontFamily:"monospace" }}>{f.ref}</span>
          <span>{formatDate(f.depDate)}</span>
          {f.cabinClass&&<span style={{ color:"#475569" }}>{f.cabinClass}</span>}
        </div>
        {showDeadline && f.status==="Reserved" && (
          <div style={{ marginTop:7, display:"flex", alignItems:"center", gap:8, fontSize:11 }}>
            <span style={{ color:"#b0a880" }}>Issuance deadline:</span>
            <InlineDateEdit
              value={f.ticketingDeadline}
              placeholder="Set deadline"
              onSave={v=>patch(f.id,{ticketingDeadline:v})}
            />
            {f.ticketingDeadline && (
              <span style={{ color:deadlineOver?"#ef4444":daysBetween(today,f.ticketingDeadline)<=7?"#f59e0b":"#475569" }}>
                {deadlineOver ? "⚠ OVERDUE" : `${daysBetween(today,f.ticketingDeadline)}d left`}
              </span>
            )}
          </div>
        )}
        {f.status==="Waitlisted" && (
          <div style={{ marginTop:7, display:"flex", alignItems:"center", gap:8, fontSize:11 }}>
            <span style={{ color:"#b0a880" }}>Last chaser:</span>
            <InlineDateEdit
              value={f.lastChaserDate}
              placeholder="Not sent yet"
              onSave={v=>patch(f.id,{lastChaserDate:v})}
            />
            {f.lastChaserDate&&(
              <button onClick={()=>patch(f.id,{lastChaserDate:today})} style={{ background:"#fdf4e8",border:"1px solid #e0d0a8",color:"#b86830",borderRadius:20,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit",fontSize:10 }}>
                Chase today
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight:"100vh", background:"#fdfaf4", color:"#3a2830", fontFamily:"'Zen Kaku Gothic New','Hiragino Kaku Gothic ProN',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500&family=Zen+Kaku+Gothic+New:wght@300;400;500;700&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;background:#0d1117}
        ::-webkit-scrollbar-thumb{background:#d8c8a0;border-radius:4px}
        .th-btn{background:none;border:none;color:#94a3b8;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:0}
        .th-btn:hover{color:#38bdf8}
        .row-tr{transition:background .15s;cursor:pointer}
        .row-tr:hover{background:#fdf8f0!important}
        .action-btn{background:none;border:1px solid #e0d0b0;color:#b09098;cursor:pointer;font-family:inherit;font-size:11px;padding:3px 12px;border-radius:20px;transition:all .15s;white-space:nowrap;letter-spacing:.03em}
        .action-btn:hover{border-color:#c46030;color:#c46030}
        .del-btn:hover{border-color:#c4714a!important;color:#c4714a!important}
        .nav-tab{background:none;border:none;cursor:pointer;font-family:'Zen Kaku Gothic New',sans-serif;font-size:12px;font-weight:500;letter-spacing:.08em;padding:8px 18px;border-radius:20px;transition:all .2s;white-space:nowrap}
        .nav-tab.active{background:#f5f0e4;color:#b86030}
        .nav-tab:not(.active){color:#b0a880}
        .nav-tab:hover:not(.active){color:#9a8050;background:#fdf8f0}
        .input-field{background:#fff;border:1px solid #e0d0b0;color:"#3a2c18";border-radius:10px;padding:9px 14px;font-family:'Zen Kaku Gothic New',sans-serif;font-size:13px;width:100%;transition:border .2s,box-shadow .2s;outline:none}
        .input-field:focus{border-color:#c46030;box-shadow:0 0 0 3px rgba(160,80,20,.08)}
        .input-field::placeholder{color:#d0c8a8}
        .select-field{appearance:none;background:#fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' viewBox='0 0 24 24'><path stroke='%23c46030' stroke-width='2' d='M6 9l6 6 6-6'/></svg>") no-repeat right 12px center;background-size:12px;cursor:pointer;padding-right:34px}
        .badge{display:inline-flex;align-items:center;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:500;letter-spacing:.06em;white-space:nowrap}
        .status-badge-btn:hover{filter:brightness(.94)}
        .save-btn{background:linear-gradient(135deg,#c46030,#a84820);border:none;color:#fff;cursor:pointer;font-family:'Zen Kaku Gothic New',sans-serif;font-size:13px;font-weight:500;padding:11px 34px;border-radius:24px;transition:opacity .15s;letter-spacing:.08em;box-shadow:0 2px 12px rgba(196,104,152,.25)}
        .save-btn:hover{opacity:.88}
        .cancel-btn{background:none;border:1px solid #e0d0b0;color:#b09098;cursor:pointer;font-family:'Zen Kaku Gothic New',sans-serif;font-size:13px;padding:11px 26px;border-radius:24px;transition:all .15s;letter-spacing:.04em}
        .cancel-btn:hover{border-color:#c46030;color:#b86030}
        .add-btn{background:linear-gradient(135deg,#c46030,#a84820);border:none;color:#fff;cursor:pointer;font-family:'Zen Kaku Gothic New',sans-serif;font-size:12px;font-weight:500;padding:9px 20px;border-radius:20px;display:flex;align-items:center;gap:7px;letter-spacing:.06em;transition:opacity .15s;white-space:nowrap;box-shadow:0 2px 12px rgba(180,80,30,.15)}
        .add-btn:hover{opacity:.88}
        .stat-card{cursor:pointer;transition:transform .15s,box-shadow .2s;user-select:none;position:relative;overflow:hidden;border-radius:16px}
        .stat-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(180,120,140,.1)!important}
        .stat-card.active-card{box-shadow:0 0 0 2px var(--card-color)!important}
        .stat-card:active{transform:scale(.97)}
        .bar-fill{transition:width .5s cubic-bezier(.4,0,.2,1)}
        .section-title{font-family:'Noto Serif JP',serif;font-weight:400;font-size:14px;letter-spacing:.06em;margin:0 0 14px;display:flex;align-items:center;gap:10px;color:#7a5868}
        .month-header{font-family:'Noto Serif JP',serif;font-weight:400;font-size:16px;color:#8a7040;margin:24px 0 12px;padding-bottom:8px;border-bottom:1px solid #e0d4b0;letter-spacing:.06em}
        .pref-star{background:none;border:none;cursor:pointer;padding:2px 4px;font-size:15px;line-height:1;transition:transform .15s,opacity .15s;opacity:.2;color:#b86030}
        .pref-star:hover{opacity:1;transform:scale(1.2)}
        .pref-star.active{opacity:1;filter:drop-shadow(0 0 4px #e8a4b8)}
        .pref-row td{background:#fdf8fa!important}
        .trip-group-hdr{background:#f8f3ec;border-top:1px solid #e8e0d0;border-bottom:1px solid #e8e0d0;cursor:pointer;user-select:none;transition:background .15s}
        .trip-group-hdr:hover{background:#f5ede0!important}
        .trip-chevron{display:inline-block;transition:transform .2s;font-size:9px;color:#d4a4b8}
        .trip-chevron.open{transform:rotate(90deg)}
        @media(max-width:700px){
          .desktop-only{display:none!important}
          .mobile-card{display:flex!important}
          .stat-grid{grid-template-columns:repeat(3,1fr)!important}
          .form-grid{grid-template-columns:1fr 1fr!important}
          .hdr-sub{display:none!important}
          .nav-tab{font-size:11px;padding:7px 10px}
        }
        @media(max-width:480px){
          .stat-grid{grid-template-columns:repeat(2,1fr)!important}
          .form-grid{grid-template-columns:1fr!important}
          .add-btn-lbl{display:none}
          .nav-tab{font-size:10px;padding:6px 8px}
        }
        .mobile-card{display:none;flex-direction:column;gap:10px}
      `}</style>

      {/* Toast */}
      {toast&&(
        <div style={{ position:"fixed",top:20,right:16,zIndex:9999,background:toast.type==="error"?"#fdf0f0":toast.type==="info"?"#f0f2f9":"#f0f7f0",border:`1px solid ${toast.type==="error"?"#e8c0c0":toast.type==="info"?"#c0c8e8":"#b8d8b8"}`,color:toast.type==="error"?"#b85c5c":toast.type==="info"?"#6b7faa":"#5a8a5a",padding:"11px 20px",borderRadius:12,fontSize:12,boxShadow:"0 4px 20px rgba(180,120,140,.15)",maxWidth:320,fontFamily:"'Zen Kaku Gothic New',sans-serif" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ borderBottom:"1px solid #e8e0d0", padding:"0 20px", background:"#fff" }}>
        <div style={{ maxWidth:1400,margin:"0 auto",display:"flex",alignItems:"center",gap:8,paddingTop:16,flexWrap:"wrap" }}>
          <div style={{ flex:1,minWidth:120 }}>
            <div style={{ fontFamily:"'Noto Serif JP',serif",fontWeight:300,fontSize:22,letterSpacing:".04em",color:"#3a2830",lineHeight:1 }}>
              ✈ <span style={{ color:"#b86830" }}>旅</span> Travel Tracker
            </div>
            <div className="hdr-sub" style={{ fontSize:10,color:"#b0a080",letterSpacing:".2em",marginTop:4,textTransform:"uppercase" }}>Flight Management</div>
          </div>
          <div style={{ display:"flex",gap:3,flexWrap:"wrap" }}>
            {[["list","ALL FLIGHTS"],["overview","OVERVIEW"]].map(([v,l])=>(
              <button key={v} className={`nav-tab ${view===v||view==="add"&&v==="list"?"active":""}`} onClick={()=>setView(v)}>{l}</button>
            ))}
          </div>
          <button className="add-btn" onClick={openAdd}>
            <span style={{ fontSize:17,lineHeight:1 }}>+</span>
            <span className="add-btn-lbl">ADD FLIGHT</span>
          </button>
        </div>
        {/* Data toolbar */}
        <div style={{ maxWidth:1400, margin:"0 auto", display:"flex", alignItems:"center", gap:8, paddingBottom:12, paddingTop:4, flexWrap:"wrap" }}>
          {/* Drive buttons */}
          <button onClick={handleSaveToCloud}
            disabled={driveStatus==="saving"||driveStatus==="loading"}
            style={{ display:"flex", alignItems:"center", gap:5, background: driveStatus==="saved"?"#f4f5ee":"none", border:`1px solid ${driveStatus==="saved"?"#9aa87a":"#e0d0b0"}`, color: driveStatus==="saved"?"#6a7a4a":"#7a6848", cursor:"pointer", fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:11, padding:"5px 14px", borderRadius:20, transition:"all .2s", opacity:driveStatus==="saving"?0.6:1, letterSpacing:".04em", fontWeight:500 }}>
            ☁  {driveStatus==="saving" ? "Saving…" : "Save to cloud"}
          </button>
          <button onClick={handleLoadFromCloud}
            disabled={driveStatus==="saving"||driveStatus==="loading"}
            style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"1px solid #e0d0b0", color:"#7a6848", cursor:"pointer", fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:11, padding:"5px 14px", borderRadius:20, transition:"all .15s", opacity:driveStatus==="loading"?0.6:1, letterSpacing:".04em" }}>
            ↓ {driveStatus==="loading" ? "Loading…" : "Load from cloud"}
          </button>
          {/* Divider */}
          <span style={{ color:"#e0d0b0", fontSize:14, padding:"0 2px" }}>|</span>
          {/* Local backup */}
          <button onClick={handleExport}
            style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"1px solid #e8e0d0", color:"#9a8860", cursor:"pointer", fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:11, padding:"5px 12px", borderRadius:20, transition:"all .15s", letterSpacing:".04em" }}>
            ↑ Export
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"1px solid #e8e0d0", color:"#9a8860", cursor:"pointer", fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:11, padding:"5px 12px", borderRadius:20, transition:"all .15s", letterSpacing:".04em" }}>
            ↑ Import
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display:"none" }} />
          <button onClick={handleResetToExcel}
            style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"1px solid #e8e0d0", color:"#b09870", cursor:"pointer", fontFamily:"'Zen Kaku Gothic New',sans-serif", fontSize:11, padding:"5px 12px", borderRadius:20, transition:"all .15s", letterSpacing:".04em" }}>
            ↺ Reset
          </button>
          {/* Status message */}
          {driveMsg && (
            <span style={{ fontSize:11, color: driveStatus==="error"?"#c4622a":"#6a7a4a", display:"flex", alignItems:"center", gap:4, padding:"3px 10px", background: driveStatus==="error"?"#fdf5ee":"#f4f5ee", borderRadius:20, border:`1px solid ${driveStatus==="error"?"#e8c8a0":"#c8d4b0"}` }}>
              {driveStatus==="error" ? "⚠ " : "✓ "}{driveMsg}
            </span>
          )}
          <span style={{ marginLeft:"auto", fontSize:10, color:"#c8b890", letterSpacing:".06em" }}>
            {flights.length} flights · auto-saved locally
          </span>
        </div>
      </div>  {/* end header border */}

      <div style={{ maxWidth:1400,margin:"0 auto",padding:"24px 20px" }}>

        {/* ── STAT CARDS ─────────────────────────────────────── */}
        {view!=="add"&&(
          <div className="stat-grid" style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,marginBottom:24 }}>
            {statCounts.map(([label,val,color,fval])=>{
              const isActive = filter.status===fval;
              return (
                <div key={label} className={`stat-card${isActive?" active-card":""}`} onClick={()=>handleStatClick(fval)}
                  style={{ "--card-color":color, background:isActive?`${color}18`:"#fff", border:`1px solid ${isActive?color+"88":"#e0d4b0"}`, borderRadius:16, padding:"14px 16px", boxShadow:isActive?"none":"0 1px 8px rgba(140,100,50,.06)" }}>
                  {isActive&&<div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:color,borderRadius:"16px 16px 0 0" }}/>}
                  <div style={{ fontSize:9,color:isActive?color:"#c0a0b0",letterSpacing:".14em",marginBottom:7,textTransform:"uppercase" }}>{label}</div>
                  <div style={{ fontSize:26,fontFamily:"'Noto Serif JP',serif",fontWeight:300,color,lineHeight:1 }}>{val}</div>
                  {isActive&&<div style={{ position:"absolute",bottom:8,right:12,fontSize:9,color:`${color}99`,letterSpacing:".06em" }}>選択中</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ LIST VIEW ═══════════════════════════════════════ */}
        {view==="list"&&(
          <>
            {/* Sort + Filter bar */}
            <div style={{ display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center" }}>
              <input className="input-field" style={{ minWidth:0,flex:"1 1 180px",maxWidth:260 }} placeholder="Search…" value={filter.search} onChange={e=>setFilter(f=>({...f,search:e.target.value}))}/>
              <select className="input-field select-field" style={{ flex:"1 1 120px",maxWidth:170 }} value={filter.status} onChange={e=>setFilter(f=>({...f,status:e.target.value}))}>
                <option value="all">All Statuses</option>
                {Object.keys(STATUS_CONFIG).map(s=><option key={s} value={s}>{s}</option>)}
                <option value="overdue">⚠ Overdue only</option>
              </select>
              <select className="input-field select-field" style={{ flex:"1 1 130px",maxWidth:180 }} value={filter.passenger} onChange={e=>setFilter(f=>({...f,passenger:e.target.value}))}>
                <option value="all">All Passengers</option>
                {passengers.map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              {/* Sort pills */}
              <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
                {[["daysLeft","✈ Days left"],["depDate","Dep date"],["addedAt","Date added"],["passenger","Name"]].map(([k,l])=>(
                  <button key={k} onClick={()=>handleSort(k)} style={{ background:sort.key===k?"#f5f0e8":"transparent",border:`1px solid ${sort.key===k?"#c46030":"#e0d0b0"}`,color:sort.key===k?"#b86830":"#a09070",borderRadius:20,padding:"4px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:11,transition:"all .15s",whiteSpace:"nowrap" }}>
                    {l}{sort.key===k&&(sort.dir==="asc"?" ▲":" ▼")}
                  </button>
                ))}
              </div>
              {filter.status!=="all"&&(
                <button onClick={()=>setFilter(f=>({...f,status:"all"}))} style={{ background:"#fdf8f0",border:"1px solid #e0d0b0",color:"#b09098",cursor:"pointer",fontFamily:"inherit",fontSize:11,padding:"5px 14px",borderRadius:20,display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap" }}>✕ Clear</button>
              )}
              <div style={{ fontSize:11,color:"#b0a080",whiteSpace:"nowrap",marginLeft:"auto" }}>{filtered.length}/{flights.length}</div>
            </div>

            {/* ── DESKTOP TABLE ── */}
            <div className="desktop-only" style={{ overflowX:"auto",borderRadius:14,border:"1px solid #e8d8c0",boxShadow:"0 2px 16px rgba(180,120,140,.06)" }}>
              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                <thead>
                  <tr style={{ background:"#f8f4ec",borderBottom:"1px solid #e0d0b0" }}>
                    <th style={{ padding:"11px 8px",textAlign:"center",width:32 }}>
                      <span style={{ color:"#c8a870",fontSize:13 }} title="Preferred option">★</span>
                    </th>
                    {[["passenger","PASSENGER"],["depDate","DEP DATE"],["daysLeft","DAYS LEFT"],["destination","ROUTE"],["tripPurpose","PURPOSE"],["status","STATUS"],["cabinClass","CABIN"],["ticketingDeadline","DEADLINE"],["addedAt","ADDED"],["ref","REF"]].map(([k,l])=>(
                      <th key={k} style={{ padding:"11px 12px",textAlign:"left" }}>
                        <SortBtn k={k} label={l}/>
                      </th>
                    ))}
                    <th style={{ padding:"10px 12px",color:"#334155",fontSize:10,textTransform:"uppercase",letterSpacing:".08em",whiteSpace:"nowrap" }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedFiltered.length === 0 && (
                    <tr><td colSpan={12} style={{ padding:40,textAlign:"center",color:"#c0b898" }}>No flights match.</td></tr>
                  )}
                  {groupedFiltered.map(({ key, flights: gFlights }) => {
                    const isOpen = !collapsedTrips.has(key);
                    const hasWL  = gFlights.some(f => f.status === "Waitlisted");
                    const hasOverdue = gFlights.some(f => f.ticketingDeadline && f.ticketingDeadline < today && ["Waitlisted","Reserved"].includes(f.status));
                    const prefFlight = gFlights.find(f => f.preferred);
                    const earliestDep = gFlights.reduce((min, f) => (!min || f.depDate < min) ? f.depDate : min, null);
                    const dL = earliestDep ? daysUntilDep(earliestDep) : null;
                    const dl = dL !== null ? fmtDaysUntil(dL) : null;
                    // Status summary badges
                    const statusCounts = gFlights.reduce((acc, f) => { acc[f.status] = (acc[f.status]||0)+1; return acc; }, {});
                    return (
                      <>
                        {/* ── TRIP GROUP HEADER ROW ── */}
                        <tr key={key+"_hdr"} className="trip-group-hdr" onClick={() => toggleTrip(key)}>
                          <td colSpan={12} style={{ padding:"9px 14px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                              <span className={`trip-chevron${isOpen?" open":""}`}>▶</span>
                              <span style={{ fontFamily:"'Noto Serif JP',serif", fontWeight:400, fontSize:14, color:"#2c2010", letterSpacing:".01em" }}>{key}</span>
                              <span style={{ fontSize:11, color:"#a09870" }}>{gFlights.length} flight{gFlights.length>1?"s":""}</span>
                              {/* Status count pills */}
                              {Object.entries(statusCounts).map(([s,n]) => {
                                const sc = STATUS_CONFIG[s];
                                if (!sc) return null;
                                return <span key={s} className="badge" style={{ background:sc.bg, color:sc.color, border:`1px solid ${sc.color}33`, fontSize:9 }}>{n} {sc.label}</span>;
                              })}
                              {/* Preferred label */}
                              {hasWL && prefFlight && (
                                <span style={{ fontSize:10, color:"#b86830", background:"#fdf4e8", border:"1px solid #e0d0a8", borderRadius:999, padding:"1px 8px" }}>
                                  ★ {prefFlight.destination} {prefFlight.depTime}
                                </span>
                              )}
                              {/* Days to departure */}
                              {dl && (
                                <span style={{ fontSize:12, color:dl.color, fontWeight:500, marginLeft:"auto" }}>{dl.label}</span>
                              )}
                              {hasOverdue && <span style={{ fontSize:10, color:"#c4622a", fontWeight:500 }}> ⚠ OVERDUE</span>}
                            </div>
                          </td>
                        </tr>
                        {/* ── FLIGHT ROWS (collapsible) ── */}
                        {isOpen && gFlights.map((f, i) => {
                          const sc  = STATUS_CONFIG[f.status]||STATUS_CONFIG["Cancelled"];
                          const fdL = daysUntilDep(f.depDate);
                          const fdl = fmtDaysUntil(fdL);
                          const dlineOver = f.ticketingDeadline&&f.ticketingDeadline<today;
                          const dlineSoon = f.ticketingDeadline&&!dlineOver&&daysBetween(today,f.ticketingDeadline)<=7;
                          const expanded  = expandedId===f.id;
                          return (
                            <>
                              <tr key={f.id} className={`row-tr${f.preferred?" pref-row":""}`}
                                onClick={()=>setExpandedId(expanded?null:f.id)}
                                style={{ background:f.preferred?"#fdf8fa":i%2===0?"#fff":"#fdfaf8", borderBottom:"1px solid #0a1525", borderLeft:f.preferred?"2px solid #f59e0b":"2px solid transparent" }}>
                                <td style={{ padding:"9px 8px",textAlign:"center",paddingLeft:22 }} onClick={e=>e.stopPropagation()}>
                                  {f.status==="Waitlisted"&&(
                                    <button className={`pref-star${f.preferred?" active":""}`} onClick={()=>togglePreferred(f.id)} title={f.preferred?"Remove preferred":"Mark as preferred"}>★</button>
                                  )}
                                </td>
                                <td style={{ padding:"9px 12px",fontWeight:500,color:"#2c2010",whiteSpace:"nowrap" }}>{f.passenger}</td>
                                <td style={{ padding:"9px 12px",color:"#8a7a60",whiteSpace:"nowrap" }}>{formatDate(f.depDate)}<br/><span style={{ fontSize:10,color:"#b0a080" }}>{f.depTime}</span>
                                </td>
                                <td style={{ padding:"9px 12px" }}>
                                  <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:fdl.color }}>{fdl.label}</span>
                                </td>
                                <td style={{ padding:"9px 12px",color:"#2c2010",fontWeight:500,whiteSpace:"nowrap" }}>{f.destination}</td>
                                <td style={{ padding:"9px 12px",color:"#475569",fontSize:11,maxWidth:0 }}>
                                  {/* Purpose hidden inside group — saves space */}
                                </td>
                                <td style={{ padding:"9px 12px" }} onClick={e=>e.stopPropagation()}>
                                  <StatusBadge status={f.status} onChange={ns=>patch(f.id,{status:ns})}/>
                                </td>
                                <td style={{ padding:"9px 12px",color:"#9a8860",fontSize:11,whiteSpace:"nowrap" }}>{f.cabinClass||"—"}</td>
                                <td style={{ padding:"9px 12px" }} onClick={e=>e.stopPropagation()}>
                                  {f.status==="Reserved"?(
                                    <div>
                                      <InlineDateEdit value={f.ticketingDeadline} placeholder="Set deadline" onSave={v=>patch(f.id,{ticketingDeadline:v})}/>
                                      {f.ticketingDeadline&&<div style={{ fontSize:10,marginTop:2,color:dlineOver?"#c4622a":dlineSoon?"#b86830":"#b0a880" }}>{dlineOver?"⚠ overdue":dlineSoon?`${daysBetween(today,f.ticketingDeadline)}d`:""}</div>}
                                    </div>
                                  ):f.status==="Waitlisted"?(
                                    <div onClick={e=>e.stopPropagation()}>
                                      <InlineDateEdit value={f.lastChaserDate} placeholder="No chaser" onSave={v=>patch(f.id,{lastChaserDate:v})}/>
                                      {f.lastChaserDate&&<div style={{ fontSize:10,marginTop:2,color:"#475569" }}>chaser</div>}
                                    </div>
                                  ):f.ticketingDeadline?(
                                    <span style={{ fontSize:11,color:dlineOver?"#c4622a":dlineSoon?"#b86830":"#9a8860" }}>{formatDate(f.ticketingDeadline)}</span>
                                  ):<span style={{ color:"#d8d0b8" }}>—</span>}
                                </td>
                                <td style={{ padding:"9px 12px",color:"#b0a080",fontSize:10,whiteSpace:"nowrap" }}>{f.addedAt?new Date(f.addedAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short"}):"—"}</td>
                                <td style={{ padding:"9px 12px",color:"#9a7850",fontFamily:"monospace",fontSize:11 }}>{f.ref}</td>
                                <td style={{ padding:"9px 12px" }}>
                                  <div style={{ display:"flex",gap:5 }} onClick={e=>e.stopPropagation()}>
                                    <button className="action-btn" onClick={()=>openEdit(f)}>Edit</button>
                                    <button className="action-btn del-btn" onClick={()=>handleDelete(f.id)}>Del</button>
                                  </div>
                                </td>
                              </tr>
                              {expanded&&(
                                <tr key={f.id+"_x"} style={{ background:"#fdf8f0",borderBottom:"1px solid #e8e0d0" }}>
                                  <td colSpan={12} style={{ padding:"12px 24px" }}>
                                    <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10,fontSize:12 }}>
                                      {[["Ticket Type",f.ticketType],["Mileage",f.mileage||"—"],["Tax/Cost",f.tax||"—"],["KF Acct",f.kfAcct||"—"],["Arr Date",formatDate(f.arrDate)],["Arr Time",f.arrTime||"—"],["Remarks",f.remarks||"—"],
                                        f.status==="Waitlisted"?["Last Chaser",formatDate(f.lastChaserDate)]:["Deadline",formatDate(f.ticketingDeadline)],
                                      ].map(([k,v])=>(
                                        <div key={k}><div style={{ fontSize:9,color:"#b0a080",marginBottom:2,letterSpacing:".1em",textTransform:"uppercase" }}>{k}</div><div style={{ color:"#5a4a28" }}>{v}</div></div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── MOBILE CARDS ── */}
            <div className="mobile-card">
              {groupedFiltered.length===0&&<div style={{ color:"#c0b898",textAlign:"center",padding:32 }}>No flights match.</div>}
              {groupedFiltered.map(({ key, flights: gFlights }) => {
                const isOpen = !collapsedTrips.has(key);
                const hasWL  = gFlights.some(f=>f.status==="Waitlisted");
                const prefFlight = gFlights.find(f=>f.preferred);
                const statusCounts = gFlights.reduce((acc,f)=>{ acc[f.status]=(acc[f.status]||0)+1; return acc; },{});
                const earliestDep = gFlights.reduce((min,f)=>(!min||f.depDate<min)?f.depDate:min,null);
                const dL = earliestDep ? daysUntilDep(earliestDep) : null;
                const dl = dL !== null ? fmtDaysUntil(dL) : null;
                const hasOverdue = gFlights.some(f=>f.ticketingDeadline&&f.ticketingDeadline<today&&["Waitlisted","Reserved"].includes(f.status));
                return (
                  <div key={key} style={{ borderRadius:10, overflow:"hidden", border:"1px solid #1a2e45" }}>
                    {/* Trip header */}
                    <div onClick={()=>toggleTrip(key)} style={{ background:"#f8f3ec", padding:"13px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                      <span className={`trip-chevron${isOpen?" open":""}`}>▶</span>
                      <span style={{ fontFamily:"'Noto Serif JP',serif", fontWeight:400, fontSize:15, color:"#2c2010", flex:1 }}>{key}</span>
                      {dl && <span style={{ fontSize:12, color:dl.color, fontWeight:700 }}>{dl.label}</span>}
                      {hasOverdue && <span style={{ fontSize:10, color:"#ef4444" }}>⚠</span>}
                      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                        {Object.entries(statusCounts).map(([s,n])=>{
                          const sc=STATUS_CONFIG[s]; if(!sc) return null;
                          return <span key={s} className="badge" style={{ background:sc.bg,color:sc.color,border:`1px solid ${sc.color}33`,fontSize:9 }}>{n} {sc.label}</span>;
                        })}
                      </div>
                      {hasWL && prefFlight && (
                        <span style={{ fontSize:10,color:"#f59e0b",background:"#2d1a00",border:"1px solid #78350f33",borderRadius:999,padding:"1px 8px",width:"100%" }}>
                          ★ Preferred: {prefFlight.destination} {prefFlight.depTime}
                        </span>
                      )}
                    </div>
                    {/* Flights in group */}
                    {isOpen && (
                      <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
                        {gFlights.map(f => {
                          const dlineOver = f.ticketingDeadline&&f.ticketingDeadline<today;
                          const fdL = daysUntilDep(f.depDate);
                          const fdl = fmtDaysUntil(fdL);
                          return (
                            <div key={f.id} style={{ background:f.preferred?"#fdf8f0":"#fff", borderTop:"1px solid #e8e0d0", padding:"13px 15px", borderLeft:f.preferred?"3px solid #c46030":undefined }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:7, gap:8 }}>
                                <div style={{ flex:1 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                                    <span style={{ fontWeight:600, color:"#e2e8f0", fontSize:13 }}>{f.passenger}</span>
                                    {f.preferred&&<span style={{ fontSize:9,background:"#fdf4e8",color:"#b86830",border:"1px solid #e0d0a8",borderRadius:20,padding:"1px 8px" }}>★ PREFERRED</span>}
                                  </div>
                                </div>
                                <StatusBadge status={f.status} onChange={ns=>patch(f.id,{status:ns})}/>
                              </div>
                              <div style={{ display:"flex", gap:10, flexWrap:"wrap", fontSize:13, color:"#94a3b8", marginBottom:6 }}>
                                <span style={{ fontWeight:600, color:"#cbd5e1" }}>{f.destination}</span>
                                <span>{f.airline}{f.flightNo}</span>
                                <span style={{ color:"#9a7850", fontFamily:"monospace" }}>{f.ref}</span>
                              </div>
                              <div style={{ fontSize:12, color:"#475569", display:"flex", gap:10, flexWrap:"wrap", marginBottom:7 }}>
                                <span>🛫 {formatDate(f.depDate)} {f.depTime}</span>
                                <span style={{ fontWeight:700, color:fdl.color }}>{fdl.label}</span>
                                {f.cabinClass&&<span>{f.cabinClass}</span>}
                              </div>
                              {f.status==="Reserved"&&(
                                <div style={{ fontSize:11, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                                  <span style={{ color:"#b0a880" }}>Deadline:</span>
                                  <InlineDateEdit value={f.ticketingDeadline} placeholder="Set deadline" onSave={v=>patch(f.id,{ticketingDeadline:v})}/>
                                  {f.ticketingDeadline&&<span style={{ color:dlineOver?"#c4622a":"#9a8860" }}>{dlineOver?"⚠ OVERDUE":`${daysBetween(today,f.ticketingDeadline)}d left`}</span>}
                                </div>
                              )}
                              {f.status==="Waitlisted"&&(
                                <div style={{ fontSize:11, marginBottom:6, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                                  <span style={{ color:"#b0a880" }}>Last chaser:</span>
                                  <InlineDateEdit value={f.lastChaserDate} placeholder="Not sent" onSave={v=>patch(f.id,{lastChaserDate:v})}/>
                                  {!f.lastChaserDate&&<button onClick={()=>patch(f.id,{lastChaserDate:today})} style={{ background:"#fdf4e8",border:"1px solid #e0d0a8",color:"#b86830",borderRadius:20,padding:"2px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:10 }}>Chase today</button>}
                                </div>
                              )}
                              <div style={{ display:"flex", gap:7, marginTop:8 }}>
                                {f.status==="Waitlisted"&&(
                                  <button onClick={()=>togglePreferred(f.id)} style={{ flex:1,textAlign:"center",background:f.preferred?"#fdf4e8":"transparent",border:`1px solid ${f.preferred?"#c46030":"#e0d0b0"}`,color:f.preferred?"#b86830":"#a09070",cursor:"pointer",fontFamily:"inherit",fontSize:11,padding:"5px 8px",borderRadius:4,transition:"all .15s" }}>
                                    {f.preferred?"★ Preferred":"☆ Set preferred"}
                                  </button>
                                )}
                                <button className="action-btn" style={{ flex:1,textAlign:"center" }} onClick={()=>openEdit(f)}>Edit</button>
                                <button className="action-btn del-btn" style={{ flex:1,textAlign:"center" }} onClick={()=>handleDelete(f.id)}>Delete</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ═══ ADD / EDIT FORM ════════════════════════════════ */}
        {view==="add"&&(
          <div>
            <div style={{ marginBottom:20,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
              <button className="cancel-btn" onClick={()=>setView("list")}>← Back</button>
              <h2 style={{ fontFamily:"'Syne',sans-serif",fontWeight:400,fontSize:20,color:"#2c2010",margin:0,fontFamily:"'Noto Serif JP',serif" }}>{editId?"EDIT FLIGHT":"ADD FLIGHT"}</h2>
            </div>
            {/* Status pills */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10,color:"#475569",letterSpacing:".12em",marginBottom:9 }}>STATUS *</div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {STATUS_CYCLE.map(s=>{ const c=STATUS_CONFIG[s]; return (
                  <button key={s} onClick={()=>setForm(f=>({...f,status:s}))} style={{ background:form.status===s?c.bg:"transparent",border:`1px solid ${form.status===s?c.color:"#e0d0b0"}`,color:form.status===s?c.color:"#b09898",borderRadius:20,padding:"5px 14px",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,transition:"all .15s" }}>
                    {c.icon} {c.label}
                  </button>
                );})}
              </div>
            </div>
            <div className="form-grid" style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14 }}>
              {[["passenger","PASSENGER *","text"],["ref","BOOKING REF","text"],["airline","AIRLINE","text"],["flightNo","FLIGHT NO *","text"],["destination","ROUTE (e.g. SIN > LHR)","text"],["tripPurpose","TRIP NAME * (groups flights)","text"],["depDate","DEPARTURE DATE *","date"],["depTime","DEP TIME","time"],["arrDate","ARRIVAL DATE","date"],["arrTime","ARR TIME","time"],["mileage","MILEAGE","text"],["tax","TAX / COST","text"],["kfAcct","KF ACCOUNT","text"],["cabinClass","CABIN CLASS","text"],
                ...(form.status==="Reserved"?[["ticketingDeadline","ISSUANCE DEADLINE","date"]]:
                   form.status==="Waitlisted"?[["lastChaserDate","LAST CHASER DATE","date"],["ticketingDeadline","WL TICKETING DEADLINE","date"]]:
                   [["ticketingDeadline","TICKETING DEADLINE","date"]])
              ].map(([key,label,type])=>(
                <div key={key}>
                  <div style={{ fontSize:10,color:key==="tripPurpose"?"#7a6a4a":"#b0a880",letterSpacing:".12em",marginBottom:7 }}>{label}</div>
                  <input
                    type={type}
                    className="input-field"
                    value={form[key]||""}
                    onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                    style={key==="tripPurpose"&&!form.tripPurpose?{ borderColor:"#8a7040" }:undefined}
                    placeholder={key==="tripPurpose"?"e.g. Summer Holidays – Japan, Ross's Wedding…":undefined}
                  />
                </div>
              ))}
              <div>
                <div style={{ fontSize:10,color:"#475569",letterSpacing:".12em",marginBottom:7 }}>TICKET TYPE</div>
                <select className="input-field select-field" value={form.ticketType} onChange={e=>setForm(f=>({...f,ticketType:e.target.value}))}>
                  {["Redemption","Commercial - Issued","Commercial"].map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginTop:14 }}>
              <div style={{ fontSize:10,color:"#475569",letterSpacing:".12em",marginBottom:7 }}>REMARKS</div>
              <textarea className="input-field" rows={3} style={{ resize:"vertical" }} value={form.remarks||""} onChange={e=>setForm(f=>({...f,remarks:e.target.value}))}/>
            </div>
            <div style={{ display:"flex",gap:10,marginTop:22,flexWrap:"wrap" }}>
              <button className="save-btn" onClick={handleSave}>{editId?"SAVE CHANGES":"ADD FLIGHT"}</button>
              <button className="cancel-btn" onClick={()=>setView("list")}>CANCEL</button>
            </div>
          </div>
        )}

        {/* ═══ OVERVIEW ════════════════════════════════════════ */}
        {view==="overview"&&(
          <div>
            <div style={{ marginBottom:24 }}>
              <h2 style={{ fontFamily:"'Syne',sans-serif",fontWeight:300,fontSize:22,color:"#2c2010",margin:"0 0 4px",fontFamily:"'Noto Serif JP',serif" }}>TRAVEL OVERVIEW</h2>
              <div style={{ fontSize:12,color:"#475569" }}>Reserved tickets by departure month · Confirmed · Waitlist deadlines</div>
            </div>

            {/* ── OVERDUE ALERTS ── */}
            {(overdueWL.length+overdueRes.length>0)&&(
              <div style={{ background:"#fdf5ee",border:"1px solid #e8c8a0",borderRadius:14,padding:"16px 20px",marginBottom:20 }}>
                <div style={{ color:"#c4622a",fontFamily:"'Noto Serif JP',serif",fontWeight:400,marginBottom:10,fontSize:14 }}>⚠ {overdueWL.length+overdueRes.length} TICKET{overdueWL.length+overdueRes.length>1?"S":""} PAST DEADLINE</div>
                {[...overdueWL,...overdueRes].map(f=>{
                  const sc=STATUS_CONFIG[f.status];
                  return (
                    <div key={f.id} style={{ fontSize:12,color:"#fca5a5",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:6,paddingBottom:6,borderBottom:"1px solid #450a0a" }}>
                      <span className="badge" style={{ background:sc.bg,color:sc.color,border:`1px solid ${sc.color}33`,fontSize:10 }}>{sc.label}</span>
                      <span style={{ color:"#2c2010",fontWeight:500 }}>{f.passenger}</span>
                      <span>{f.destination}</span>
                      <span style={{ color:"#9a7850",fontFamily:"monospace" }}>{f.ref}</span>
                      <span style={{ color:"#c4622a" }}>Deadline: {formatDate(f.ticketingDeadline)}</span>
                      {f.tripPurpose&&<span style={{ color:"#c0a0b0" }}>{f.tripPurpose}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── RESERVED TICKETS — BY MONTH ── */}
            <div style={{ marginBottom:28 }}>
              <div className="section-title" style={{ color:"#a78bfa" }}>
                <span style={{ background:"#f4f0e8",borderRadius:20,padding:"2px 10px",fontSize:11 }}>📌</span>
                Reserved Tickets — By Departure Month
              </div>

              {Object.keys(reservedByMonth).length===0&&(
                <div style={{ fontSize:12,color:"#c0b898",padding:"14px 0" }}>No reserved tickets.</div>
              )}

              {Object.keys(reservedByMonth).sort().map(mk=>{
                const items = reservedByMonth[mk];
                const monthOverdue = items.filter(f=>f.ticketingDeadline&&f.ticketingDeadline<today).length;
                return (
                  <div key={mk}>
                    <div className="month-header" style={{ display:"flex",alignItems:"center",gap:12 }}>
                      {monthLabel(mk)}
                      <span style={{ fontSize:11,color:"#475569",fontFamily:"DM Mono,monospace",fontWeight:400 }}>{items.length} flight{items.length>1?"s":""}</span>
                      {monthOverdue>0&&<span style={{ fontSize:10,background:"#fdf5f2",color:"#c4622a",border:"1px solid #f0c8b8",borderRadius:20,padding:"1px 8px" }}>⚠ {monthOverdue} overdue</span>}
                    </div>
                    {items.map(f=>{
                      const dL  = daysUntilDep(f.depDate);
                      const dl  = fmtDaysUntil(dL);
                      const dlineOver = f.ticketingDeadline&&f.ticketingDeadline<today;
                      const dlineSoon = f.ticketingDeadline&&!dlineOver&&daysBetween(today,f.ticketingDeadline)<=7;
                      return (
                        <div key={f.id} style={{ background:"#fff",border:`1px solid ${dlineOver?"#e8c0a0":"#e0d4b0"}`,borderRadius:12,padding:"14px 18px",marginBottom:12,boxShadow:"0 1px 8px rgba(120,90,40,.05)" }}>
                          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:8 }}>
                            <div>
                              <span style={{ fontWeight:500,color:"#2c2010",fontSize:14 }}>{f.passenger}</span>
                              {f.tripPurpose&&<span style={{ marginLeft:10,fontSize:12,color:"#9a8860" }}>· {f.tripPurpose}</span>}
                            </div>
                            <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                              <span style={{ fontFamily:"'Noto Serif JP',serif",fontWeight:300,fontSize:17,color:dl.color }}>{dl.label}</span>
                              <span className="badge" style={{ background:"#f4f0e8",color:"#7a6a4a",border:"1px solid #d8d0b0",fontSize:10 }}>RESERVED</span>
                            </div>
                          </div>
                          <div style={{ fontSize:12,color:"#9a8860",display:"flex",gap:14,flexWrap:"wrap",marginBottom:10 }}>
                            <span style={{ color:"#2c2010",fontWeight:500 }}>{f.destination}</span>
                            <span>{f.airline}{f.flightNo}</span>
                            <span style={{ color:"#9a7850",fontFamily:"monospace" }}>{f.ref}</span>
                            <span>🛫 {formatDate(f.depDate)} {f.depTime}</span>
                            {f.cabinClass&&<span>{f.cabinClass}</span>}
                          </div>
                          {/* Deadline row with inline edit */}
                          <div style={{ display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"8px 12px",background:"#fdf8f0",borderRadius:8,border:`1px solid ${dlineOver?"#e8c0a0":dlineSoon?"#e0d0a0":"#e8e0d0"}` }}>
                            <span style={{ fontSize:11,color:"#b0a880" }}>Issuance deadline:</span>
                            <InlineDateEdit value={f.ticketingDeadline} placeholder="Tap to set deadline" onSave={v=>patch(f.id,{ticketingDeadline:v})}/>
                            {f.ticketingDeadline&&(
                              <span style={{ fontSize:11,fontWeight:700,color:dlineOver?"#c4622a":dlineSoon?"#b86830":"#9a8860" }}>
                                {dlineOver?"⚠ OVERDUE":dlineSoon?`⚡ ${daysBetween(today,f.ticketingDeadline)} day${daysBetween(today,f.ticketingDeadline)===1?"":"s"} left`:`${daysBetween(today,f.ticketingDeadline)} days left`}
                              </span>
                            )}
                          </div>
                          {f.remarks&&<div style={{ fontSize:11,color:"#b0a880",marginTop:8 }}>{f.remarks}</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* ── CONFIRMED TICKETS ── */}
            <div style={{ background:"#fff",border:"1px solid #dde0d0",borderRadius:14,padding:"18px 20px",marginBottom:20,boxShadow:"0 1px 8px rgba(100,120,60,.05)" }}>
              <div className="section-title" style={{ color:"#22c55e" }}>
                <span style={{ background:"#052e16",borderRadius:999,padding:"2px 10px",fontSize:11 }}>✓</span>
                CONFIRMED — {confirmed.length} ISSUED / PURCHASED
              </div>
              {confirmed.length===0&&<div style={{ fontSize:12,color:"#c0c8a8" }}>None.</div>}
              {[...confirmed].sort((a,b)=>a.depDate>b.depDate?1:-1).map(f=><MiniCard key={f.id} f={f} showDeadline={false}/>)}
            </div>

            {/* ── WAITLIST SUMMARY ── */}
            <div style={{ background:"#fff",border:"1px solid #e8d8c0",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 8px rgba(120,90,40,.05)" }}>
              <div className="section-title" style={{ color:"#f59e0b" }}>
                <span style={{ background:"#2d1a00",borderRadius:999,padding:"2px 10px",fontSize:11 }}>⏳</span>
                WAITLISTED — {waitlisted.length} TICKETS
              </div>
              {waitlisted.length===0&&<div style={{ fontSize:12,color:"#c0b898" }}>None.</div>}
              {[...waitlisted].sort((a,b)=>a.depDate>b.depDate?1:-1).map(f=><MiniCard key={f.id} f={f}/>)}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
