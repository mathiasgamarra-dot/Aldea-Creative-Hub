import { useState, useRef, useEffect, useCallback } from "react";
import {
  collection, doc, setDoc, getDoc, getDocs,
  addDoc, query, orderBy, limit, onSnapshot, serverTimestamp
} from "firebase/firestore";
import { db } from "./firebase";

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:      #09090b;
      --surface: #101013;
      --card:    #16161a;
      --border:  #1f1f26;
      --border2: #2a2a34;
      --accent:  #b8ff57;
      --text:    #ededf0;
      --muted:   #62626e;
      --muted2:  #909099;
      --red:     #ff5f5f;
      --blue:    #5fa8ff;
      --amber:   #ffbe4d;
      --green:   #4dffc3;
      --purple:  #b87cff;
      --pink:    #ff7cc8;
    }
    body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; }
    ::-webkit-scrollbar { width: 3px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
    @keyframes fadeUp  { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
    @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
    @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0.2} }
    @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }
    @keyframes spin    { to { transform:rotate(360deg); } }
    .fade-up { animation: fadeUp  0.3s ease both; }
    .fade-in { animation: fadeIn  0.25s ease both; }
    textarea, input, button, select { font-family: 'DM Sans', sans-serif; }
    textarea { resize: vertical; }
    button { cursor: pointer; }
  `}</style>
);

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function callClaude(apiKey, system, userMsg, history = []) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1600,
      system,
      messages: [...history, { role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.content[0]?.text || "";
}

// ─── FIREBASE HELPERS ─────────────────────────────────────────────────────────
const saveUser = async (user) => {
  const { pass, ...safeUser } = user; // no guardamos la contraseña en texto plano en Firestore
  await setDoc(doc(db, "users", user.id), { ...safeUser, updatedAt: serverTimestamp() });
};

const getUser = async (id) => {
  const snap = await getDoc(doc(db, "users", id));
  return snap.exists() ? snap.data() : null;
};

const getAllUsers = async () => {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => d.data());
};

const logActivity = async (entry) => {
  await addDoc(collection(db, "activity"), { ...entry, ts: serverTimestamp() });
};

const saveConversation = async (userId, moduleId, messages, meta = {}) => {
  const id = `${userId}_${moduleId}_${Date.now()}`;
  await setDoc(doc(db, "conversations", id), {
    userId, moduleId, messages,
    ...meta,
    savedAt: serverTimestamp(),
  });
};

const getUserConversations = async (userId, moduleId) => {
  const snap = await getDocs(query(
    collection(db, "conversations"),
    orderBy("savedAt", "desc"),
    limit(50)
  ));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.userId === userId && (!moduleId || d.moduleId === moduleId));
};

const getAllConversations = async () => {
  const snap = await getDocs(query(collection(db, "conversations"), orderBy("savedAt", "desc"), limit(200)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// Guardar usuarios con pass en localStorage (solo localmente, no en Firestore)
const LOCAL_USERS_KEY = "aldea_users_local";
const getLocalUsers = () => { try { return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "{}"); } catch { return {}; } };
const saveLocalUser = (user) => { const u = getLocalUsers(); u[user.id] = user; localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(u)); };
const findLocalUser = (name, pass) => Object.values(getLocalUsers()).find(u => u.name.toLowerCase() === name.toLowerCase() && u.pass === pass);

// ─── ROLES ────────────────────────────────────────────────────────────────────
const ROLES = {
  director:   { label:"Director / Dueño",      color:"var(--accent)", icon:"◆", tabs:["email","asana","estrategia","campanas","historial","equipo"], desc:"Acceso completo + panel del equipo" },
  creativo:   { label:"Director Creativo",      color:"var(--purple)", icon:"✦", tabs:["estrategia","campanas","email","historial"],                  desc:"Estrategia, campañas y email" },
  cuentas:    { label:"Ejecutivo de Cuentas",   color:"var(--blue)",   icon:"◉", tabs:["email","asana","campanas","historial"],                       desc:"Email, proyectos y campañas" },
  produccion: { label:"Producción / Social",    color:"var(--pink)",   icon:"◈", tabs:["asana","campanas","historial"],                              desc:"Proyectos y campañas" },
};

const ALL_TABS = [
  { id:"email",     icon:"✉️",  label:"Email" },
  { id:"asana",     icon:"📋",  label:"Proyectos" },
  { id:"estrategia",icon:"💡",  label:"Estrategia" },
  { id:"campanas",  icon:"🎨",  label:"Campañas" },
  { id:"historial", icon:"🗂",  label:"Historial" },
  { id:"equipo",    icon:"👥",  label:"Equipo" },
];

// ─── SYSTEM PROMPTS ───────────────────────────────────────────────────────────
const BASE = (role, name) =>
  `Sos el agente de Aldea Creative Hub, una agencia de publicidad 360 argentina.
Hablás en español rioplatense con ${name} (${ROLES[role]?.label}).
Sos estratégico, creativo y directo. Con clientes externos: tono profesional y cálido.`;

const SYS_EMAIL = (r,n) => `${BASE(r,n)}
MÓDULO EMAIL — respondé SIEMPRE con este formato exacto:

---CLASIFICACIÓN---
Tipo: [Cliente / Proveedor / Prospecto / Interno / Spam]
Urgencia: [Alta / Media / Baja]
Resumen: [1 oración]

---BORRADOR---
[email completo listo para enviar]

---ASUNTO SUGERIDO---
[asunto]

---ACCIÓN ASANA---
[tarea concreta o "No aplica"]`;

const SYS_ASANA = (r,n) => `${BASE(r,n)}
MÓDULO PROYECTOS: Dado un proyecto, generá:
1. Tareas con responsable y deadline relativo. Prioridad: 🔴 urgente / 🟡 esta semana / 🟢 próxima semana
2. Dependencias o riesgos
3. Cómo arrancar mañana mismo`;

const SYS_ESTRATEGIA = (r,n) => `${BASE(r,n)}
MÓDULO ESTRATEGIA: Dado un desafío, proponé:
1. Insight estratégico central (1 párrafo)
2. Tres territorios creativos distintos (nombre + concepto + ejemplo de ejecución)
3. Pregunta estratégica clave antes de avanzar`;

const SYS_CAMPANAS = (r,n) => `${BASE(r,n)}
MÓDULO CAMPAÑAS — campaña 360 completa:

**CONCEPTO CREATIVO**
Nombre / Idea central / Tagline

**PIEZAS CLAVE** (mínimo 4 formatos)
Formato · copy principal · copy secundario · dirección de arte

**PLAN DE MEDIOS**
Canales con justificación + distribución %

**KPIs**
3 métricas con benchmarks`;

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const inp = { width:"100%", background:"var(--card)", border:"1px solid var(--border2)", borderRadius:8, padding:"10px 14px", color:"var(--text)", fontSize:14, outline:"none" };
const btnP = (color="var(--accent)") => ({ background:color, color:color==="var(--accent)"?"#09090b":"#fff", border:"none", borderRadius:8, padding:"10px 20px", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13.5, cursor:"pointer" });
const btnS = { background:"var(--card)", color:"var(--text)", border:"1px solid var(--border2)", borderRadius:8, padding:"9px 14px", fontSize:13, cursor:"pointer" };

function Lbl({ children }) {
  return <label style={{ fontSize:11, color:"var(--muted2)", display:"block", marginBottom:5, textTransform:"uppercase", letterSpacing:"0.08em" }}>{children}</label>;
}
function Tag({ color, children }) {
  return <span style={{ background:color+"20", color, border:`1px solid ${color}44`, borderRadius:4, padding:"2px 8px", fontSize:11, fontWeight:600 }}>{children}</span>;
}
function Typing() {
  return (
    <div style={{ display:"flex", gap:5, padding:"10px 4px" }}>
      {[0,1,2].map(i=>(
        <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"var(--accent)", animation:`blink 1.2s ${i*0.2}s infinite` }} />
      ))}
    </div>
  );
}
function Bubble({ role:r, text }) {
  const isA = r==="assistant";
  return (
    <div className="fade-up" style={{ display:"flex", justifyContent:isA?"flex-start":"flex-end", marginBottom:10 }}>
      <div style={{ maxWidth:"83%", background:isA?"var(--card)":"var(--accent)", color:isA?"var(--text)":"#09090b", border:isA?"1px solid var(--border)":"none", borderRadius:isA?"4px 14px 14px 14px":"14px 4px 14px 14px", padding:"11px 15px", fontSize:13.5, lineHeight:1.68, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>{text}</div>
    </div>
  );
}
function ModuleHeader({ icon, title, sub }) {
  return (
    <div style={{ marginBottom:20, paddingBottom:16, borderBottom:"1px solid var(--border)" }}>
      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:19, fontWeight:800, marginBottom:4 }}>{icon} {title}</div>
      <div style={{ fontSize:12.5, color:"var(--muted2)" }}>{sub}</div>
    </div>
  );
}
function Spinner() {
  return <div style={{ width:16, height:16, border:"2px solid var(--border2)", borderTop:"2px solid var(--accent)", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />;
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({ onEnter }) {
  const [mode, setMode] = useState("login");
  const [apiKey, setApiKey] = useState("");
  const [name, setName]     = useState("");
  const [role, setRole]     = useState("director");
  const [userId, setUserId] = useState("");
  const [pass, setPass]     = useState("");
  const [err, setErr]       = useState("");
  const [loading, setLoading] = useState(false);

  const register = async () => {
    if (!name.trim())  { setErr("Ingresá tu nombre"); return; }
    if (!apiKey.trim().startsWith("sk-ant-")) { setErr("API key inválida (debe empezar con sk-ant-)"); return; }
    if (!pass.trim())  { setErr("Ingresá una contraseña"); return; }
    setLoading(true); setErr("");
    try {
      await callClaude(apiKey.trim(), "Respondé solo: OK", "OK");
      const id = name.trim().toLowerCase().replace(/\s+/g,"-") + "-" + Date.now().toString(36);
      const user = { id, name:name.trim(), role, apiKey:apiKey.trim(), pass:pass.trim(), createdAt:Date.now() };
      await saveUser(user);
      saveLocalUser(user);
      await logActivity({ userId:id, userName:name.trim(), userRole:role, module:"sistema", action:"Se registró en Aldea" });
      onEnter(user);
    } catch(e) { setErr("Error: " + e.message); }
    setLoading(false);
  };

  const login = async () => {
    if (!userId.trim() || !pass.trim()) { setErr("Completá todos los campos"); return; }
    setLoading(true); setErr("");
    const found = findLocalUser(userId.trim(), pass.trim());
    if (!found) { setErr("Usuario o contraseña incorrectos"); setLoading(false); return; }
    await logActivity({ userId:found.id, userName:found.name, userRole:found.role, module:"sistema", action:"Inició sesión" });
    setLoading(false);
    onEnter(found);
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"var(--bg)", padding:24 }}>
      <div className="fade-up" style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:18, padding:48, maxWidth:440, width:"100%" }}>
        <div style={{ marginBottom:32, textAlign:"center" }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:26, fontWeight:800, letterSpacing:"-0.03em", marginBottom:6 }}>
            <span style={{ color:"var(--accent)" }}>Aldea</span>{" "}<span style={{ color:"var(--muted2)", fontWeight:400 }}>Creative</span>{" "}Hub
          </div>
          <div style={{ fontSize:12, color:"var(--muted)", letterSpacing:"0.12em", textTransform:"uppercase" }}>Agente cerebro · agencia 360</div>
        </div>

        <div style={{ display:"flex", background:"var(--card)", borderRadius:8, padding:3, marginBottom:24, border:"1px solid var(--border)" }}>
          {["login","register"].map(m=>(
            <button key={m} onClick={()=>{ setMode(m); setErr(""); }}
              style={{ flex:1, padding:"8px 0", border:"none", borderRadius:6, fontSize:13, fontWeight:500, background:mode===m?"var(--border2)":"transparent", color:mode===m?"var(--text)":"var(--muted)", transition:"all 0.2s" }}>
              {m==="login"?"Ingresar":"Registrarse"}
            </button>
          ))}
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {mode==="register" ? (
            <>
              <div><Lbl>Tu nombre</Lbl><input value={name} onChange={e=>setName(e.target.value)} placeholder="Ej: Sofía Torres" style={inp} /></div>
              <div>
                <Lbl>Tu rol</Lbl>
                <select value={role} onChange={e=>setRole(e.target.value)} style={{ ...inp, appearance:"none" }}>
                  {Object.entries(ROLES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
                <p style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>{ROLES[role]?.desc}</p>
              </div>
              <div><Lbl>Anthropic API Key</Lbl><input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-api03-..." style={inp} /><p style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>Conseguila en <span style={{ color:"var(--accent)" }}>console.anthropic.com</span></p></div>
              <div><Lbl>Contraseña</Lbl><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Elegí una contraseña" style={inp} onKeyDown={e=>e.key==="Enter"&&register()} /></div>
            </>
          ) : (
            <>
              <div><Lbl>Nombre de usuario</Lbl><input value={userId} onChange={e=>setUserId(e.target.value)} placeholder="Tu nombre" style={inp} /></div>
              <div><Lbl>Contraseña</Lbl><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Tu contraseña" style={inp} onKeyDown={e=>e.key==="Enter"&&login()} /></div>
            </>
          )}

          {err && <div style={{ background:"#ff5f5f12", border:"1px solid #ff5f5f30", borderRadius:8, padding:"9px 13px", fontSize:13, color:"var(--red)" }}>{err}</div>}

          <button onClick={mode==="register"?register:login} disabled={loading}
            style={{ ...btnP(), width:"100%", marginTop:4, opacity:loading?0.6:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            {loading ? <><Spinner /> Verificando...</> : mode==="register" ? "Crear cuenta →" : "Entrar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CHAT MODULE ──────────────────────────────────────────────────────────────
function ChatModule({ icon, title, sub, systemFn, user, moduleId, templates }) {
  const [input, setInput] = useState("");
  const [msgs, setMsgs]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);
  const [approved, setApproved] = useState(false);
  const [copied, setCopied]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const bottom = useRef();

  useEffect(() => { bottom.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, loading]);

  const send = async (txt) => {
    const msg = (txt||input).trim();
    if (!msg||loading) return;
    setInput(""); setDraft(null); setApproved(false); setCopied(false); setSaved(false);
    setMsgs(p=>[...p,{role:"user",text:msg}]);
    setLoading(true);
    try {
      const history = msgs.map(m=>({role:m.role,content:m.text}));
      const reply = await callClaude(user.apiKey, systemFn(user.role,user.name), msg, history);
      const newMsgs = [...msgs,{role:"user",text:msg},{role:"assistant",text:reply}];
      setMsgs(p=>[...p,{role:"assistant",text:reply}]);
      await logActivity({ userId:user.id, userName:user.name, userRole:user.role, module:moduleId, action:msg.slice(0,80)+(msg.length>80?"…":"") });

      if (moduleId==="email") {
        const bm = reply.match(/---BORRADOR---([\s\S]*?)---ASUNTO SUGERIDO---/);
        const sm = reply.match(/---ASUNTO SUGERIDO---([\s\S]*?)---ACCIÓN ASANA---/);
        if (bm) setDraft({ body:bm[1].trim(), subject:sm?sm[1].trim():"" });
      }
    } catch(e) { setMsgs(p=>[...p,{role:"assistant",text:"❌ Error: "+e.message}]); }
    setLoading(false);
  };

  const copyDraft = () => {
    navigator.clipboard.writeText(`Asunto: ${draft.subject}\n\n${draft.body}`);
    setCopied(true); setApproved(true);
    setTimeout(()=>setCopied(false),2500);
  };

  const saveHistory = async () => {
    if (msgs.length===0) return;
    setSaving(true);
    try {
      const lastUser = msgs.filter(m=>m.role==="user").pop()?.text || "";
      await saveConversation(user.id, moduleId, msgs, { title: lastUser.slice(0,60), userName: user.name });
      setSaved(true);
      setTimeout(()=>setSaved(false),2500);
    } catch(e) { console.error(e); }
    setSaving(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20, paddingBottom:16, borderBottom:"1px solid var(--border)" }}>
        <div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:19, fontWeight:800, marginBottom:4 }}>{icon} {title}</div>
          <div style={{ fontSize:12.5, color:"var(--muted2)" }}>{sub}</div>
        </div>
        {msgs.length>0 && (
          <button onClick={saveHistory} disabled={saving||saved}
            style={{ ...btnS, fontSize:12, padding:"6px 12px", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
            {saving?<Spinner/>:saved?"✓ Guardado":"💾 Guardar"}
          </button>
        )}
      </div>

      {msgs.length===0 && templates && (
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:"var(--muted)", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.08em" }}>Ejemplos</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
            {templates.map((t,i)=><button key={i} onClick={()=>send(t)} style={{ ...btnS, fontSize:12, padding:"6px 12px", textAlign:"left", maxWidth:320 }}>{t}</button>)}
          </div>
        </div>
      )}

      <div style={{ flex:1, overflowY:"auto", minHeight:260, maxHeight:380, paddingBottom:8 }}>
        {msgs.length===0&&!templates&&(
          <div style={{ textAlign:"center", padding:"60px 20px", color:"var(--muted)" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>{icon}</div>
            <div style={{ fontSize:14 }}>Escribí tu consulta para empezar</div>
          </div>
        )}
        {msgs.map((m,i)=><Bubble key={i} {...m} />)}
        {loading&&<Typing/>}
        <div ref={bottom}/>
      </div>

      {draft&&!approved&&(
        <div className="fade-up" style={{ background:"#b8ff5712",border:"1px solid #b8ff5730",borderRadius:10,padding:14,margin:"10px 0" }}>
          <div style={{ fontSize:11,color:"var(--accent)",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em" }}>¿Aprobás el borrador?</div>
          <div style={{ fontSize:12.5,color:"var(--muted2)",marginBottom:12 }}>Asunto: <strong style={{ color:"var(--text)" }}>{draft.subject}</strong></div>
          <div style={{ display:"flex",gap:8 }}>
            <button onClick={copyDraft} style={{ ...btnP(),padding:"8px 18px",fontSize:13 }}>✓ Aprobar y copiar</button>
            <button onClick={()=>{setDraft(null);setInput("Reescribí con tono más formal");}} style={{ ...btnS,fontSize:13 }}>↺ Reescribir</button>
          </div>
        </div>
      )}
      {approved&&<div className="fade-up" style={{ background:"#4dffc310",border:"1px solid #4dffc330",borderRadius:8,padding:"9px 14px",margin:"10px 0",fontSize:13,color:"var(--green)" }}>{copied?"✓ Copiado — pegalo en Gmail":"✓ Borrador aprobado"}</div>}

      <div style={{ display:"flex",gap:8,paddingTop:12,borderTop:"1px solid var(--border)",alignItems:"flex-end" }}>
        {moduleId==="email"
          ? <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Pegá el email que recibiste..." rows={3} style={{ ...inp,flex:1 }} onKeyDown={e=>{if(e.key==="Enter"&&e.metaKey)send();}}/>
          : <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Escribí tu consulta..." style={{ ...inp,flex:1 }} onKeyDown={e=>e.key==="Enter"&&send()}/>
        }
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{ ...btnP(),padding:"11px 20px",opacity:(!input.trim()||loading)?0.35:1 }}>
          {loading?"...":"→"}
        </button>
      </div>
    </div>
  );
}

// ─── CAMPAÑAS MODULE ──────────────────────────────────────────────────────────
function CampanasModule({ user }) {
  const FIELDS = [
    { key:"marca",    label:"¿Para qué marca o cliente?",       placeholder:"Ej: Café Oculto" },
    { key:"producto", label:"¿Qué se comunica?",                placeholder:"Ej: Lanzamiento de línea de especialidad" },
    { key:"objetivo", label:"¿Cuál es el objetivo?",            placeholder:"Ej: Awareness + ventas ecommerce" },
    { key:"target",   label:"¿Quién es el público objetivo?",   placeholder:"Ej: Adultos 28-45, urbanos, foodies" },
    { key:"budget",   label:"¿Presupuesto aproximado?",         placeholder:"Ej: USD 5.000/mes" },
    { key:"canales",  label:"¿Qué canales tienen disponibles?", placeholder:"Ej: Instagram, TikTok, Google, OOH" },
  ];
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState({});
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved]   = useState(false);

  const next = async () => {
    if (step < FIELDS.length-1) { setStep(s=>s+1); return; }
    setLoading(true);
    const txt = FIELDS.map(f=>`${f.key.toUpperCase()}: ${brief[f.key]||"No especificado"}`).join("\n");
    try {
      const reply = await callClaude(user.apiKey, SYS_CAMPANAS(user.role,user.name), `Brief:\n\n${txt}`);
      setResult(reply);
      await logActivity({ userId:user.id, userName:user.name, userRole:user.role, module:"campanas", action:`Campaña para: ${brief.marca||"sin nombre"}` });
    } catch(e) { setResult("❌ Error: "+e.message); }
    setLoading(false);
  };

  const saveResult = async () => {
    await saveConversation(user.id, "campanas",
      [{ role:"user", text: FIELDS.map(f=>`${f.key}: ${brief[f.key]||""}`).join("\n") }, { role:"assistant", text:result }],
      { title:`Campaña: ${brief.marca||"Sin nombre"}`, userName:user.name, marca:brief.marca }
    );
    setSaved(true); setTimeout(()=>setSaved(false),2500);
  };

  const reset = () => { setStep(0); setBrief({}); setResult(""); setSaved(false); };
  const f = FIELDS[step];

  if (loading) return (
    <div style={{ display:"flex",flexDirection:"column",flex:1,alignItems:"center",justifyContent:"center",gap:14 }}>
      <div style={{ fontSize:34,animation:"spin 2s linear infinite" }}>✦</div>
      <div style={{ color:"var(--muted2)",fontSize:14 }}>Generando campaña 360...</div>
    </div>
  );

  if (result) return (
    <div style={{ display:"flex",flexDirection:"column",flex:1 }} className="fade-up">
      <ModuleHeader icon="🎨" title="Campañas 360" sub={`Campaña para ${brief.marca||"tu cliente"}`} />
      <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:12,gap:8 }}>
        <button onClick={saveResult} disabled={saved} style={{ ...btnS,fontSize:12,padding:"6px 14px",display:"flex",alignItems:"center",gap:6 }}>
          {saved?"✓ Guardada":"💾 Guardar campaña"}
        </button>
        <button onClick={reset} style={{ ...btnS,fontSize:12,padding:"6px 14px" }}>+ Nueva</button>
      </div>
      <div style={{ flex:1,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:20,fontSize:13.5,lineHeight:1.78,whiteSpace:"pre-wrap",overflowY:"auto",maxHeight:480 }}>{result}</div>
    </div>
  );

  return (
    <div style={{ display:"flex",flexDirection:"column",flex:1 }}>
      <ModuleHeader icon="🎨" title="Generador de Campañas" sub="6 preguntas → campaña 360 completa con piezas, copies y plan de medios" />
      <div style={{ display:"flex",gap:4,marginBottom:28 }}>
        {FIELDS.map((_,i)=><div key={i} style={{ height:3,flex:1,borderRadius:2,background:i<=step?"var(--accent)":"var(--border2)",transition:"background 0.3s" }}/>)}
      </div>
      <div className="fade-up" key={step}>
        <div style={{ fontSize:11,color:"var(--muted)",marginBottom:7,textTransform:"uppercase",letterSpacing:"0.08em" }}>Paso {step+1} / {FIELDS.length}</div>
        <div style={{ fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:700,marginBottom:20 }}>{f.label}</div>
        <input key={step} value={brief[f.key]||""} onChange={e=>setBrief(p=>({...p,[f.key]:e.target.value}))}
          placeholder={f.placeholder} style={{ ...inp,marginBottom:20,fontSize:15 }}
          onKeyDown={e=>e.key==="Enter"&&next()} autoFocus />
        <div style={{ display:"flex",gap:8 }}>
          {step>0&&<button onClick={()=>setStep(s=>s-1)} style={btnS}>← Atrás</button>}
          <button onClick={next} style={{ ...btnP(),padding:"11px 24px" }}>{step===FIELDS.length-1?"Generar campaña ✦":"Siguiente →"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── HISTORIAL MODULE ─────────────────────────────────────────────────────────
function HistorialModule({ user }) {
  const [convs, setConvs]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter]   = useState("todos");

  const isDirector = user.role === "director";

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = isDirector ? await getAllConversations() : await getUserConversations(user.id);
      setConvs(all);
      setLoading(false);
    })();
  }, [user.id, isDirector]);

  const MODULE_LABELS = { email:"✉️ Email", asana:"📋 Proyectos", estrategia:"💡 Estrategia", campanas:"🎨 Campañas" };
  const MODULE_COLORS = { email:"var(--blue)", asana:"var(--amber)", estrategia:"var(--purple)", campanas:"var(--pink)" };

  const filtered = filter==="todos" ? convs : convs.filter(c=>c.moduleId===filter);

  const fmtDate = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("es-AR",{ day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  };

  if (selected) return (
    <div style={{ display:"flex",flexDirection:"column",flex:1 }} className="fade-in">
      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20,paddingBottom:16,borderBottom:"1px solid var(--border)" }}>
        <button onClick={()=>setSelected(null)} style={{ ...btnS,padding:"6px 12px",fontSize:12 }}>← Volver</button>
        <div>
          <div style={{ fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:700 }}>{selected.title||"Conversación"}</div>
          <div style={{ fontSize:11,color:"var(--muted2)",marginTop:2 }}>
            <span style={{ color:MODULE_COLORS[selected.moduleId] }}>{MODULE_LABELS[selected.moduleId]}</span>
            {isDirector&&selected.userName && <span> · {selected.userName}</span>}
            {selected.savedAt && <span> · {fmtDate(selected.savedAt)}</span>}
          </div>
        </div>
      </div>
      <div style={{ flex:1,overflowY:"auto",maxHeight:500 }}>
        {(selected.messages||[]).map((m,i)=><Bubble key={i} {...m}/>)}
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex",flexDirection:"column",flex:1 }}>
      <ModuleHeader icon="🗂" title="Historial" sub={isDirector?"Todo el historial del equipo guardado en Firebase":"Tus conversaciones guardadas"} />

      <div style={{ display:"flex",gap:6,marginBottom:16,flexWrap:"wrap" }}>
        {["todos","email","asana","estrategia","campanas"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{ ...btnS,fontSize:12,padding:"5px 12px",background:filter===f?"var(--border2)":"var(--card)",color:filter===f?"var(--text)":"var(--muted)" }}>
            {f==="todos"?"Todos":MODULE_LABELS[f]}
          </button>
        ))}
        <button onClick={async()=>{ setLoading(true); const all=isDirector?await getAllConversations():await getUserConversations(user.id); setConvs(all); setLoading(false); }}
          style={{ ...btnS,fontSize:12,padding:"5px 12px",marginLeft:"auto",display:"flex",alignItems:"center",gap:6 }}>
          {loading?<Spinner/>:"↻"} Actualizar
        </button>
      </div>

      {loading ? (
        <div style={{ display:"flex",alignItems:"center",justifyContent:"center",flex:1,gap:10,color:"var(--muted)" }}>
          <Spinner/> Cargando historial...
        </div>
      ) : filtered.length===0 ? (
        <div style={{ textAlign:"center",padding:"60px 20px",color:"var(--muted)",fontSize:14 }}>
          No hay conversaciones guardadas todavía.<br/>
          <span style={{ fontSize:12 }}>Usá el botón "💾 Guardar" en cualquier módulo.</span>
        </div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:8,overflowY:"auto",maxHeight:460 }}>
          {filtered.map(c=>(
            <div key={c.id} onClick={()=>setSelected(c)}
              style={{ background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"13px 16px",cursor:"pointer",transition:"border 0.2s" }}
              onMouseEnter={e=>e.currentTarget.style.border="1px solid var(--border2)"}
              onMouseLeave={e=>e.currentTarget.style.border="1px solid var(--border)"}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12 }}>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:13.5,fontWeight:500,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                    {c.title||"Sin título"}
                  </div>
                  <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
                    <Tag color={MODULE_COLORS[c.moduleId]||"var(--muted)"}>{MODULE_LABELS[c.moduleId]||c.moduleId}</Tag>
                    {isDirector&&c.userName&&<span style={{ fontSize:11,color:"var(--muted2)" }}>{c.userName}</span>}
                  </div>
                </div>
                <div style={{ fontSize:11,color:"var(--muted)",flexShrink:0,textAlign:"right" }}>
                  {fmtDate(c.savedAt)}<br/>
                  <span style={{ color:"var(--muted)" }}>{(c.messages||[]).length} mensajes</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── EQUIPO MODULE ────────────────────────────────────────────────────────────
function EquipoModule({ user }) {
  const [users, setUsers]     = useState([]);
  const [activity, setActivity] = useState([]);
  const [tab, setTab]         = useState("actividad");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [u, a] = await Promise.all([getAllUsers(), getDocs(query(collection(db,"activity"),orderBy("ts","desc"),limit(60)))]);
      setUsers(u);
      setActivity(a.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    })();
  }, []);

  const MODULE_COLORS = { email:"var(--blue)",asana:"var(--amber)",estrategia:"var(--purple)",campanas:"var(--pink)",sistema:"var(--muted2)" };
  const MODULE_LABELS = { email:"Email",asana:"Proyectos",estrategia:"Estrategia",campanas:"Campañas",sistema:"Sistema" };

  const fmtTs = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const s = Math.floor((Date.now()-d.getTime())/1000);
    if (s<60) return "ahora";
    if (s<3600) return `hace ${Math.floor(s/60)}m`;
    if (s<86400) return `hace ${Math.floor(s/3600)}h`;
    return `hace ${Math.floor(s/86400)}d`;
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",flex:1 }}>
      <ModuleHeader icon="👥" title="Panel del Equipo" sub="Miembros y actividad en tiempo real · datos desde Firebase" />

      <div style={{ display:"flex",gap:6,marginBottom:20 }}>
        {["actividad","miembros"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{ ...btnS,fontSize:13,background:tab===t?"var(--border2)":"var(--card)",color:tab===t?"var(--text)":"var(--muted)" }}>
            {t==="actividad"?"📊 Actividad":"👤 Miembros"}
          </button>
        ))}
        <div style={{ marginLeft:"auto",fontSize:12,color:"var(--muted)",display:"flex",alignItems:"center",gap:6 }}>
          <div style={{ width:6,height:6,borderRadius:"50%",background:"var(--green)",animation:"pulse 2s infinite" }}/>
          {users.length} miembro{users.length!==1?"s":""}
        </div>
      </div>

      {loading ? (
        <div style={{ display:"flex",alignItems:"center",justifyContent:"center",flex:1,gap:10,color:"var(--muted)" }}>
          <Spinner/> Cargando...
        </div>
      ) : tab==="miembros" ? (
        <div className="fade-in" style={{ display:"flex",flexDirection:"column",gap:10,overflowY:"auto",maxHeight:440 }}>
          {users.length===0 ? (
            <div style={{ textAlign:"center",padding:"40px 20px",color:"var(--muted)",fontSize:14 }}>No hay miembros registrados todavía.</div>
          ) : users.map(u=>{
            const r=ROLES[u.role];
            const lastAct=activity.find(a=>a.userId===u.id);
            return (
              <div key={u.id} style={{ background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px",display:"flex",alignItems:"center",gap:14 }}>
                <div style={{ width:40,height:40,borderRadius:"50%",background:r?.color+"22",border:`1px solid ${r?.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0 }}>{r?.icon}</div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontWeight:600,fontSize:14,marginBottom:3 }}>
                    {u.name} {u.id===user.id&&<span style={{ fontSize:11,color:"var(--muted)" }}>(vos)</span>}
                  </div>
                  <Tag color={r?.color}>{r?.label}</Tag>
                </div>
                <div style={{ textAlign:"right",fontSize:11,color:"var(--muted)" }}>
                  {lastAct?<><div>{fmtTs(lastAct.ts)}</div><div style={{ color:MODULE_COLORS[lastAct.module] }}>{MODULE_LABELS[lastAct.module]}</div></>:<div>Sin actividad</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="fade-in" style={{ display:"flex",flexDirection:"column",gap:8,overflowY:"auto",maxHeight:440 }}>
          {activity.length===0 ? (
            <div style={{ textAlign:"center",padding:"40px 20px",color:"var(--muted)",fontSize:14 }}>No hay actividad registrada todavía.</div>
          ) : activity.map((a,i)=>{
            const r=ROLES[a.userRole];
            return (
              <div key={i} style={{ display:"flex",alignItems:"flex-start",gap:12,padding:"10px 14px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:9 }}>
                <div style={{ width:28,height:28,borderRadius:"50%",background:r?.color+"22",flexShrink:0,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12 }}>{r?.icon}</div>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:13,marginBottom:2 }}>
                    <strong style={{ color:r?.color }}>{a.userName}</strong>
                    <span style={{ color:"var(--muted2)" }}> en </span>
                    <span style={{ color:MODULE_COLORS[a.module] }}>{MODULE_LABELS[a.module]||a.module}</span>
                  </div>
                  <div style={{ fontSize:12,color:"var(--muted2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{a.action}</div>
                </div>
                <div style={{ fontSize:11,color:"var(--muted)",flexShrink:0 }}>{fmtTs(a.ts)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab]   = useState(null);

  const handleEnter = (u) => {
    setUser(u);
    setTab(ROLES[u.role]?.tabs[0] || "email");
  };

  if (!user) return <><GlobalStyles/><SetupScreen onEnter={handleEnter}/></>;

  const role = ROLES[user.role];
  const allowedTabs = ALL_TABS.filter(t=>role?.tabs.includes(t.id));

  return (
    <>
      <GlobalStyles/>
      <div style={{ minHeight:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)" }}>
        <header style={{ height:52,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 22px",background:"var(--surface)",position:"sticky",top:0,zIndex:50 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <div style={{ width:7,height:7,borderRadius:"50%",background:"var(--accent)",boxShadow:"0 0 8px var(--accent)",animation:"pulse 2s infinite" }}/>
            <span style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,letterSpacing:"-0.025em" }}>
              <span style={{ color:"var(--accent)" }}>Aldea</span>{" "}<span style={{ color:"var(--muted2)",fontWeight:400 }}>Creative</span>{" "}Hub
            </span>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <Tag color={role?.color}>{role?.icon} {role?.label}</Tag>
            <span style={{ fontSize:13,color:"var(--muted2)" }}>{user.name}</span>
            <button onClick={()=>setUser(null)} style={{ ...btnS,padding:"5px 12px",fontSize:12 }}>Salir</button>
          </div>
        </header>

        <nav style={{ display:"flex",borderBottom:"1px solid var(--border)",background:"var(--surface)",padding:"0 18px",gap:2 }}>
          {allowedTabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ display:"flex",alignItems:"center",gap:6,padding:"13px 15px",background:"none",border:"none",borderBottom:tab===t.id?"2px solid var(--accent)":"2px solid transparent",color:tab===t.id?"var(--text)":"var(--muted)",fontSize:13.5,fontWeight:500,cursor:"pointer",transition:"color 0.2s" }}>
              <span>{t.icon}</span><span>{t.label}</span>
            </button>
          ))}
        </nav>

        <main key={tab} className="fade-up" style={{ flex:1,padding:24,maxWidth:860,width:"100%",margin:"0 auto",display:"flex",flexDirection:"column" }}>
          {tab==="email" && <ChatModule icon="✉️" title="Email inteligente" sub="Pegá un email → clasifica, resume y redacta la respuesta para tu aprobación" systemFn={SYS_EMAIL} user={user} moduleId="email"/>}
          {tab==="asana" && <ChatModule icon="📋" title="Proyectos & Asana" sub="Describí un proyecto → tareas, responsables y prioridades listos para Asana" systemFn={SYS_ASANA} user={user} moduleId="asana"
            templates={["Lanzamiento de campaña para cliente nuevo, arranca en 3 semanas","Entrega de identidad de marca: logo, paleta, tipografía","Producción de 20 posts mensuales para redes","Pitch para prospecto: presentación + propuesta económica"]}/>}
          {tab==="estrategia" && <ChatModule icon="💡" title="Estrategia & Brainstorming" sub="Describí el desafío → insight estratégico + territorios creativos" systemFn={SYS_ESTRATEGIA} user={user} moduleId="estrategia"
            templates={["Marca de ropa sustentable quiere crecer en Instagram. Target: mujeres 25-35","Restaurante nuevo en Palermo busca diferenciarse","App de delivery quiere competir con PedidosYa y Rappi","ONG medioambiental: campaña de awareness para jóvenes"]}/>}
          {tab==="campanas"  && <CampanasModule user={user}/>}
          {tab==="historial" && <HistorialModule user={user}/>}
          {tab==="equipo"    && <EquipoModule user={user}/>}
        </main>
      </div>
    </>
  );
}
