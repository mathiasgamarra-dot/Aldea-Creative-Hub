import { useState, useRef, useEffect, useCallback } from "react";
import { collection, doc, setDoc, getDocs, addDoc, deleteDoc, query, orderBy, limit, serverTimestamp, getDoc } from "firebase/firestore";
import { db } from "./firebase";

// ── STYLES ────────────────────────────────────────────────────────────────────
const G = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#08080a;--surface:#0f0f12;--card:#151518;--card2:#1a1a1e;
      --border:#1e1e24;--border2:#27272e;--border3:#32323a;
      --accent:#b8ff57;--accent2:#8fcc38;
      --text:#eeeaf0;--muted:#5a5a66;--muted2:#8a8a99;
      --red:#ff5f5f;--blue:#5fa8ff;--amber:#ffbe4d;--green:#4dffc3;--purple:#b87cff;--pink:#ff7cc8;--teal:#4dd9ff;
    }
    body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;overflow:hidden;height:100vh}
    ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
    .fu{animation:fadeUp .25s ease both}
    .fi{animation:fadeIn .2s ease both}
    textarea,input,button,select{font-family:'DM Sans',sans-serif}
    textarea{resize:vertical}button{cursor:pointer}
    input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent)!important}
  `}</style>
);

// ── CLAUDE ────────────────────────────────────────────────────────────────────
async function claude(apiKey, system, msg, history = []) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:1500,system,messages:[...history,{role:"user",content:msg}]}),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message||`HTTP ${res.status}`); }
  return (await res.json()).content[0]?.text || "";
}

// ── ASANA ─────────────────────────────────────────────────────────────────────
const AT = "2/1202717930325832/1214725226176340:4ac298ed4057b87be9f5573869cc53fc";
const AB = "https://app.asana.com/api/1.0";
const aGet = async p => { const r = await fetch(`${AB}${p}`,{headers:{Authorization:`Bearer ${AT}`,Accept:"application/json"}}); if(!r.ok) throw new Error(`Asana ${r.status}`); return (await r.json()).data; };
const aPost = async (p,b) => { const r = await fetch(`${AB}${p}`,{method:"POST",headers:{Authorization:`Bearer ${AT}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({data:b})}); if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e?.errors?.[0]?.message||`Asana ${r.status}`);} return (await r.json()).data; };
const getWS = () => aGet("/workspaces");
const getProjs = ws => aGet(`/projects?workspace=${ws}&opt_fields=gid,name,created_at`);
const getTasks = p => aGet(`/projects/${p}/tasks?opt_fields=gid,name,completed,assignee,due_on,created_at,notes`);
const getMembers = ws => aGet(`/workspaces/${ws}/users?opt_fields=gid,name,email`);
const createProj = (ws,name) => aPost("/projects",{name,workspace:ws,color:"light-green"});
const createTask = (p,t) => aPost("/tasks",{name:t.name,notes:t.notes||"",projects:[p],assignee:t.assigneeGid||null,due_on:t.due_on||null});

// ── FIREBASE ──────────────────────────────────────────────────────────────────
const fb = {
  saveUser: async u => { const {pass,...s}=u; await setDoc(doc(db,"users",u.id),{...s,updatedAt:serverTimestamp()}); },
  getUsers: async () => { try{const s=await getDocs(collection(db,"users"));return s.docs.map(d=>d.data());}catch{return[];} },
  saveClient: async c => { await setDoc(doc(db,"clients",c.id),{...c,updatedAt:serverTimestamp()}); },
  getClients: async () => { try{const s=await getDocs(query(collection(db,"clients"),orderBy("updatedAt","desc")));return s.docs.map(d=>({id:d.id,...d.data()}));}catch{return[];} },
  saveProject: async p => { await setDoc(doc(db,"projects",p.id),{...p,updatedAt:serverTimestamp()}); },
  getProjects: async clientId => { try{const s=await getDocs(collection(db,"projects"));return s.docs.map(d=>({id:d.id,...d.data()})).filter(p=>p.clientId===clientId);}catch{return[];} },
  saveNote: async n => { await addDoc(collection(db,"notes"),{...n,ts:serverTimestamp()}); },
  getNotes: async projId => { try{const s=await getDocs(query(collection(db,"notes"),orderBy("ts","desc"),limit(50)));return s.docs.map(d=>({id:d.id,...d.data()})).filter(n=>n.projectId===projId);}catch{return[];} },
  logAct: async e => { try{await addDoc(collection(db,"activity"),{...e,ts:serverTimestamp()});}catch{} },
};

// ── LOCAL AUTH ────────────────────────────────────────────────────────────────
const getLocal = () => { try{return JSON.parse(localStorage.getItem("aldea_users")||"{}");}catch{return{};} };
const saveLocal = u => { const d=getLocal(); d[u.id]=u; localStorage.setItem("aldea_users",JSON.stringify(d)); };
const findLocal = (n,p) => Object.values(getLocal()).find(u=>u.name.toLowerCase()===n.toLowerCase()&&u.pass===p);

// ── CONFIG ────────────────────────────────────────────────────────────────────
const ROLES = {
  director:  {label:"Director",    color:"var(--accent)", icon:"◆"},
  creativo:  {label:"Creativo",    color:"var(--purple)", icon:"✦"},
  cuentas:   {label:"Cuentas",     color:"var(--blue)",   icon:"◉"},
  produccion:{label:"Producción",  color:"var(--pink)",   icon:"◈"},
};
const AREAS = ["Diseño","Estrategia","Producción","Cuentas","Dirección"];
const PROJECT_MODULES = ["Brief","Estrategia","Concepto","Medios","Tareas","Email","Archivos"];
const MODULE_COLORS = {Brief:"var(--amber)",Estrategia:"var(--purple)",Concepto:"var(--pink)",Medios:"var(--blue)",Tareas:"var(--green)",Email:"var(--teal)",Archivos:"var(--muted2)"};

// ── UI ATOMS ──────────────────────────────────────────────────────────────────
const S = {
  inp: {width:"100%",background:"var(--card2)",border:"1px solid var(--border2)",borderRadius:8,padding:"9px 13px",color:"var(--text)",fontSize:13.5},
  btnP: (c="var(--accent)") => ({background:c,color:c==="var(--accent)"?"#08080a":"#fff",border:"none",borderRadius:8,padding:"9px 18px",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer"}),
  btnS: {background:"var(--card2)",color:"var(--text)",border:"1px solid var(--border2)",borderRadius:8,padding:"8px 13px",fontSize:12.5,cursor:"pointer"},
  card: {background:"var(--card)",border:"1px solid var(--border)",borderRadius:12},
};
const Tag = ({color,children,small}) => <span style={{background:color+"20",color,border:`1px solid ${color}44`,borderRadius:4,padding:small?"1px 6px":"2px 8px",fontSize:small?10:11,fontWeight:600,whiteSpace:"nowrap"}}>{children}</span>;
const Lbl = ({children}) => <label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:4,textTransform:"uppercase",letterSpacing:".08em"}}>{children}</label>;
const Spin = ({size=14}) => <div style={{width:size,height:size,border:"2px solid var(--border2)",borderTop:"2px solid var(--accent)",borderRadius:"50%",animation:"spin .7s linear infinite",flexShrink:0}}/>;
const Typing = () => <div style={{display:"flex",gap:4,padding:"8px 2px"}}>{[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:"var(--accent)",animation:`blink 1.2s ${i*.2}s infinite`}}/>)}</div>;
const Bubble = ({role:r,text}) => { const a=r==="assistant"; return <div className="fu" style={{display:"flex",justifyContent:a?"flex-start":"flex-end",marginBottom:8}}><div style={{maxWidth:"85%",background:a?"var(--card2)":"var(--accent)",color:a?"var(--text)":"#08080a",border:a?"1px solid var(--border2)":"none",borderRadius:a?"4px 12px 12px 12px":"12px 4px 12px 12px",padding:"9px 13px",fontSize:13,lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{text}</div></div>; };

function Avatar({name,color,size=32}){
  return <div style={{width:size,height:size,borderRadius:"50%",background:(color||"var(--muted)")+"22",border:`1.5px solid ${color||"var(--muted)"}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.38,fontWeight:700,color:color||"var(--muted2)",flexShrink:0}}>{name?name[0].toUpperCase():"?"}</div>;
}

// ── LOGIN / REGISTER ──────────────────────────────────────────────────────────
function Auth({onEnter}) {
  const [mode,setMode] = useState("login");
  const [f,setF] = useState({name:"",role:"director",area:"Dirección",apiKey:"",pass:"",uid:"",lp:""});
  const [err,setErr] = useState(""); const [loading,setLoading] = useState(false);
  const up = (k,v) => setF(p=>({...p,[k]:v}));

  const register = async () => {
    if(!f.name.trim()){setErr("Ingresá tu nombre");return;}
    if(!f.apiKey.trim().startsWith("sk-ant-")){setErr("API key inválida (debe empezar con sk-ant-)");return;}
    if(!f.pass.trim()){setErr("Ingresá una contraseña");return;}
    setLoading(true);setErr("");
    try {
      await claude(f.apiKey.trim(),"Respondé solo: OK","OK");
      const id = f.name.trim().toLowerCase().replace(/\s+/g,"-")+"-"+Date.now().toString(36);
      const user = {id,name:f.name.trim(),role:f.role,area:f.area,apiKey:f.apiKey.trim(),pass:f.pass.trim(),createdAt:Date.now()};
      await fb.saveUser(user); saveLocal(user);
      await fb.logAct({userId:id,userName:user.name,module:"sistema",action:"Registrado"});
      onEnter(user);
    } catch(e) { setErr("Error: "+e.message); }
    setLoading(false);
  };

  const login = async () => {
    if(!f.uid.trim()||!f.lp.trim()){setErr("Completá los campos");return;}
    setLoading(true);setErr("");
    const found = findLocal(f.uid.trim(),f.lp.trim());
    if(!found){setErr("Usuario o contraseña incorrectos");setLoading(false);return;}
    await fb.logAct({userId:found.id,userName:found.name,module:"sistema",action:"Login"});
    setLoading(false); onEnter(found);
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",padding:20}}>
      <div className="fu" style={{...S.card,padding:44,maxWidth:420,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:24,fontWeight:800,letterSpacing:"-.03em",marginBottom:5}}>
            <span style={{color:"var(--accent)"}}>Aldea</span> <span style={{color:"var(--muted2)",fontWeight:400}}>Creative</span> Hub
          </div>
          <div style={{fontSize:11,color:"var(--muted)",letterSpacing:".1em",textTransform:"uppercase"}}>Sistema operativo de tu agencia</div>
        </div>

        <div style={{display:"flex",background:"var(--card2)",borderRadius:8,padding:3,marginBottom:20,border:"1px solid var(--border)"}}>
          {["login","register"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("");}} style={{flex:1,padding:"7px 0",border:"none",borderRadius:6,fontSize:12.5,fontWeight:500,background:mode===m?"var(--border2)":"transparent",color:mode===m?"var(--text)":"var(--muted)"}}>{m==="login"?"Ingresar":"Registrarse"}</button>)}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:11}}>
          {mode==="register" ? (<>
            <div><Lbl>Nombre</Lbl><input value={f.name} onChange={e=>up("name",e.target.value)} placeholder="Tu nombre completo" style={S.inp}/></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><Lbl>Rol</Lbl><select value={f.role} onChange={e=>up("role",e.target.value)} style={{...S.inp,appearance:"none"}}>{Object.entries(ROLES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</select></div>
              <div><Lbl>Área</Lbl><select value={f.area} onChange={e=>up("area",e.target.value)} style={{...S.inp,appearance:"none"}}>{AREAS.map(a=><option key={a} value={a}>{a}</option>)}</select></div>
            </div>
            <div><Lbl>Anthropic API Key</Lbl><input type="password" value={f.apiKey} onChange={e=>up("apiKey",e.target.value)} placeholder="sk-ant-api03-..." style={S.inp}/><div style={{fontSize:10.5,color:"var(--muted)",marginTop:3}}>console.anthropic.com → API Keys</div></div>
            <div><Lbl>Contraseña</Lbl><input type="password" value={f.pass} onChange={e=>up("pass",e.target.value)} placeholder="Elegí una contraseña" style={S.inp} onKeyDown={e=>e.key==="Enter"&&register()}/></div>
          </>) : (<>
            <div><Lbl>Usuario</Lbl><input value={f.uid} onChange={e=>up("uid",e.target.value)} placeholder="Tu nombre" style={S.inp}/></div>
            <div><Lbl>Contraseña</Lbl><input type="password" value={f.lp} onChange={e=>up("lp",e.target.value)} placeholder="Tu contraseña" style={S.inp} onKeyDown={e=>e.key==="Enter"&&login()}/></div>
          </>)}
          {err && <div style={{background:"#ff5f5f12",border:"1px solid #ff5f5f30",borderRadius:7,padding:"8px 12px",fontSize:12.5,color:"var(--red)"}}>{err}</div>}
          <button onClick={mode==="register"?register:login} disabled={loading} style={{...S.btnP(),width:"100%",marginTop:4,display:"flex",alignItems:"center",justifyContent:"center",gap:7,opacity:loading?.6:1}}>
            {loading?<><Spin/>Verificando...</>:mode==="register"?"Crear cuenta →":"Entrar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── GLOBAL AGENT CHAT ─────────────────────────────────────────────────────────
function AgentChat({user, context, onClose}) {
  const [msgs, setMsgs] = useState([{role:"assistant",text:`Hola ${user.name}! Soy tu agente. ${context?`Estoy viendo el contexto de "${context}". `:""} ¿En qué te ayudo?`}]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottom = useRef();
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);

  const SYS = `Sos el agente de Aldea Creative Hub, agencia 360 argentina. Hablás en español rioplatense con ${user.name} (${ROLES[user.role]?.label}). Sos estratégico, creativo y directo. ${context?`Contexto actual: ${context}`:""} Ayudás con estrategia, campañas, análisis de mails, organización de proyectos y búsqueda de nuevos clientes.`;

  const send = async () => {
    const msg = input.trim(); if(!msg||loading) return;
    setInput("");
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try {
      const r = await claude(user.apiKey, SYS, msg, msgs.slice(-6).map(m=>({role:m.role,content:m.text})));
      setMsgs(p=>[...p,{role:"assistant",text:r}]);
    } catch(e) { setMsgs(p=>[...p,{role:"assistant",text:"❌ "+e.message}]); }
    setLoading(false);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"12px 14px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"var(--accent)",animation:"pulse 2s infinite"}}/>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13}}>Agente Aldea</span>
        </div>
        {onClose&&<button onClick={onClose} style={{background:"none",border:"none",color:"var(--muted)",fontSize:16,padding:"0 4px"}}>×</button>}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 14px"}}>
        {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
        {loading&&<Typing/>}
        <div ref={bottom}/>
      </div>
      <div style={{padding:"10px 12px",borderTop:"1px solid var(--border)",display:"flex",gap:7,flexShrink:0}}>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Preguntale al agente..." style={{...S.inp,flex:1,fontSize:12.5,padding:"8px 11px"}} onKeyDown={e=>e.key==="Enter"&&send()}/>
        <button onClick={send} disabled={loading||!input.trim()} style={{...S.btnP(),padding:"8px 14px",opacity:(!input.trim()||loading)?.35:1}}>→</button>
      </div>
    </div>
  );
}

// ── CLIENT CARD ───────────────────────────────────────────────────────────────
function ClientCard({client, onClick, projectCount=0}) {
  const colors = ["var(--accent)","var(--purple)","var(--blue)","var(--pink)","var(--amber)","var(--teal)"];
  const color = colors[client.name.charCodeAt(0) % colors.length];
  return (
    <div onClick={onClick} className="fu" style={{...S.card,padding:0,cursor:"pointer",overflow:"hidden",transition:"border .2s"}}
      onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border3)"}
      onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
      <div style={{height:5,background:color}}/>
      <div style={{padding:"16px 18px"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
          {client.coverColor ? (
            <div style={{width:44,height:44,borderRadius:10,background:client.coverColor,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:800,color:"#fff",fontFamily:"'Syne',sans-serif"}}>{client.name[0].toUpperCase()}</div>
          ) : (
            <div style={{width:44,height:44,borderRadius:10,background:color+"22",border:`1px solid ${color}44`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color}}>{client.name[0].toUpperCase()}</div>
          )}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:15,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{client.name}</div>
            <div style={{fontSize:12,color:"var(--muted2)"}}>{client.industry||"Sin industria"}</div>
          </div>
        </div>
        <div style={{fontSize:11.5,color:"var(--muted2)",marginBottom:10,lineHeight:1.5,height:32,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{client.description||"Sin descripción"}</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:11,color:"var(--muted)"}}>📋 {projectCount} proyecto{projectCount!==1?"s":""}</span>
          {client.status&&<Tag color={client.status==="activo"?"var(--green)":client.status==="prospecto"?"var(--amber)":"var(--muted2)"} small>{client.status}</Tag>}
        </div>
      </div>
    </div>
  );
}

// ── NEW CLIENT MODAL ──────────────────────────────────────────────────────────
function NewClientModal({onSave, onClose}) {
  const [f, setF] = useState({name:"",industry:"",description:"",contact:"",email:"",status:"activo",coverColor:""});
  const up = (k,v) => setF(p=>({...p,[k]:v}));
  const COLORS = ["#7c3aed","#2563eb","#dc2626","#059669","#d97706","#db2777","#0891b2"];
  const save = () => {
    if(!f.name.trim()) return;
    const id = "client-"+Date.now().toString(36);
    onSave({id,...f,createdAt:Date.now()});
  };
  return (
    <div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:20}}>
      <div className="fu" style={{...S.card,padding:32,maxWidth:480,width:"100%",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:800,marginBottom:20}}>+ Nuevo cliente</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div><Lbl>Nombre del cliente *</Lbl><input value={f.name} onChange={e=>up("name",e.target.value)} placeholder="Ej: Café Oculto" style={S.inp} autoFocus/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><Lbl>Industria</Lbl><input value={f.industry} onChange={e=>up("industry",e.target.value)} placeholder="Gastronomía" style={S.inp}/></div>
            <div><Lbl>Estado</Lbl><select value={f.status} onChange={e=>up("status",e.target.value)} style={{...S.inp,appearance:"none"}}><option value="activo">Activo</option><option value="prospecto">Prospecto</option><option value="pausado">Pausado</option></select></div>
          </div>
          <div><Lbl>Descripción</Lbl><textarea value={f.description} onChange={e=>up("description",e.target.value)} placeholder="Qué hace, cuál es su propuesta de valor..." rows={3} style={S.inp}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><Lbl>Contacto</Lbl><input value={f.contact} onChange={e=>up("contact",e.target.value)} placeholder="Nombre del contacto" style={S.inp}/></div>
            <div><Lbl>Email</Lbl><input value={f.email} onChange={e=>up("email",e.target.value)} placeholder="email@cliente.com" style={S.inp}/></div>
          </div>
          <div>
            <Lbl>Color de portada</Lbl>
            <div style={{display:"flex",gap:8,marginTop:4}}>
              {COLORS.map(c=><div key={c} onClick={()=>up("coverColor",c)} style={{width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",border:f.coverColor===c?"3px solid var(--text)":"3px solid transparent",transition:"border .15s"}}/>)}
              <div onClick={()=>up("coverColor","")} style={{width:28,height:28,borderRadius:"50%",background:"var(--border2)",cursor:"pointer",border:!f.coverColor?"3px solid var(--text)":"3px solid transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"var(--muted)"}}>Auto</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <button onClick={save} disabled={!f.name.trim()} style={{...S.btnP(),flex:1,opacity:!f.name.trim()?.5:1}}>Crear cliente →</button>
            <button onClick={onClose} style={S.btnS}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PROJECT MODULE PANEL ──────────────────────────────────────────────────────
function ModulePanel({mod, project, client, user, asanaData, onClose}) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState("");
  const [parsed, setParsed] = useState(null);
  const [content, setContent] = useState(project?.modules?.[mod] || "");
  const [saved, setSaved] = useState(false);
  const bottom = useRef();
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);

  // Load Asana tasks for this project
  useEffect(()=>{
    if(mod==="Tareas"&&asanaData.selProject){
      const t = asanaData.tasks || [];
      setTasks(t);
    }
  },[mod,asanaData]);

  const SYS_MOD = {
    Brief: `Sos estratega de agencia 360. Dado un brief, extraé: cliente, objetivo, target, presupuesto, canales, plazo, tono, insight, KPIs. Respondé en formato claro con secciones.`,
    Estrategia: `Sos estratega creativo de agencia 360 argentina. Cliente: ${client?.name}. Proyecto: ${project?.name}. Brief: ${project?.modules?.Brief||"No disponible"}. Proponé insight central + 3 territorios creativos distintos + pregunta clave.`,
    Concepto: `Sos director creativo de agencia 360 argentina. Cliente: ${client?.name}. Brief: ${project?.modules?.Brief||""}. Estrategia: ${project?.modules?.Estrategia||""}. Desarrollá el concepto creativo: nombre de campaña, idea central, tagline, y guía de tono visual.`,
    Medios: `Sos especialista en medios y performance. Cliente: ${client?.name}. Objetivo: ${project?.modules?.Brief||""}. Recomendá plan de medios: canales, distribución de presupuesto %, formatos por canal, KPIs y cronograma.`,
    Tareas: `Sos PM de agencia 360. Equipo disponible: ${(asanaData.members||[]).map(m=>m.name).join(", ")}. Brief: ${project?.modules?.Brief||""}. Dado un proyecto, respondé SOLO con JSON: {"resumen":"...","tareas":[{"nombre":"...","responsable":"nombre","prioridad":"alta|media|baja","deadline":"X días","notas":"..."}],"riesgos":"..."}`,
    Email: `Sos el agente de comunicación de la agencia. Cliente: ${client?.name}. Dado un email, respondé:\n---CLASIFICACIÓN---\nTipo: [Cliente/Proveedor/Prospecto/Interno]\nUrgencia: [Alta/Media/Baja]\nResumen: [1 oración]\n---BORRADOR---\n[respuesta completa]\n---ASUNTO SUGERIDO---\n[asunto]`,
    Archivos: `Sos el asistente de la agencia. Ayudás a organizar archivos y documentos del proyecto ${project?.name} del cliente ${client?.name}.`,
  };

  const send = async (txt) => {
    const msg = (txt||input).trim(); if(!msg||loading) return;
    setInput("");
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try {
      const r = await claude(user.apiKey, SYS_MOD[mod]||SYS_MOD.Brief, msg, msgs.slice(-4).map(m=>({role:m.role,content:m.text})));
      setMsgs(p=>[...p,{role:"assistant",text:r}]);
      if(mod==="Tareas") { try{const j=JSON.parse(r.replace(/```json|```/g,"").trim());setParsed(j);}catch{} }
    } catch(e) { setMsgs(p=>[...p,{role:"assistant",text:"❌ "+e.message}]); }
    setLoading(false);
  };

  const createInAsana = async () => {
    if(!asanaData.selWs||!parsed) return;
    setCreating(true); setCreateMsg("");
    try {
      const name = `[${client?.name}] ${project?.name} — ${mod}`;
      const proj = await createProj(asanaData.selWs, name);
      let n=0;
      for(const t of parsed.tareas||[]) {
        const m = (asanaData.members||[]).find(x=>x.name.toLowerCase().includes((t.responsable||"").toLowerCase().split(" ")[0]));
        await createTask(proj.gid,{name:t.nombre,notes:`Prioridad: ${t.prioridad}\nDeadline: ${t.deadline}\n${t.notas||""}`,assigneeGid:m?.gid||null});
        n++;
      }
      setCreateMsg(`✓ ${n} tareas creadas en Asana`);
    } catch(e) { setCreateMsg("❌ "+e.message); }
    setCreating(false);
  };

  const color = MODULE_COLORS[mod]||"var(--muted2)";

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:"var(--card)"}}>
      {/* Module header */}
      <div style={{padding:"11px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:color,flexShrink:0}}/>
        <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,flex:1}}>{mod}</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"var(--muted)",fontSize:17,padding:"0 2px"}}>×</button>
      </div>

      {/* Content area */}
      <div style={{flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10}}>

        {/* Editable content for Brief, Estrategia, Concepto, Medios */}
        {["Brief","Estrategia","Concepto","Medios"].includes(mod) && (
          <div>
            <textarea value={content} onChange={e=>setContent(e.target.value)}
              placeholder={`Escribí o pegá el ${mod.toLowerCase()} acá, o usá el agente abajo para generarlo...`}
              rows={6} style={{...S.inp,width:"100%",marginBottom:6,fontSize:12.5,lineHeight:1.6}}/>
            <button onClick={()=>setSaved(true)} style={{...S.btnS,fontSize:11.5,padding:"5px 10px"}}>
              {saved?"✓ Guardado":"💾 Guardar"}
            </button>
          </div>
        )}

        {/* Tasks view */}
        {mod==="Tareas" && (
          <div>
            {tasks.length>0 ? (
              <div>
                <div style={{fontSize:11,color:"var(--muted)",marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>{tasks.length} tareas en Asana</div>
                {tasks.map(t=>(
                  <div key={t.gid} style={{background:"var(--card2)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 11px",marginBottom:5,display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:12,height:12,borderRadius:"50%",border:"2px solid",borderColor:t.completed?"var(--green)":"var(--border2)",background:t.completed?"var(--green)":"transparent",flexShrink:0,marginTop:2}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12.5,color:t.completed?"var(--muted)":"var(--text)",textDecoration:t.completed?"line-through":"none"}}>{t.name}</div>
                      {t.assignee&&<div style={{fontSize:11,color:"var(--muted2)"}}>{t.assignee.name}</div>}
                    </div>
                    {t.due_on&&<div style={{fontSize:10.5,color:"var(--amber)",flexShrink:0}}>{t.due_on}</div>}
                  </div>
                ))}
              </div>
            ) : <div style={{fontSize:12.5,color:"var(--muted)",textAlign:"center",padding:"20px 0"}}>No hay tareas todavía. Usá el agente para generarlas.</div>}

            {parsed && (
              <div style={{background:"#b8ff5710",border:"1px solid #b8ff5730",borderRadius:10,padding:12,marginTop:10}}>
                <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>✦ {parsed.tareas?.length||0} tareas generadas</div>
                {(parsed.tareas||[]).map((t,i)=>(
                  <div key={i} style={{display:"flex",gap:6,marginBottom:4,fontSize:12}}>
                    <span style={{color:t.prioridad==="alta"?"var(--red)":t.prioridad==="media"?"var(--amber)":"var(--green)",flexShrink:0}}>{t.prioridad==="alta"?"🔴":"🟡"}</span>
                    <span style={{flex:1}}>{t.nombre}</span>
                    <span style={{color:"var(--muted2)",flexShrink:0,fontSize:11}}>→{t.responsable}</span>
                  </div>
                ))}
                {createMsg ? <div style={{fontSize:12,color:createMsg.startsWith("✓")?"var(--green)":"var(--red)",marginTop:8}}>{createMsg}</div> : (
                  <button onClick={createInAsana} disabled={creating} style={{...S.btnP(),padding:"7px 12px",fontSize:12,marginTop:8,display:"flex",alignItems:"center",gap:5,opacity:creating?.6:1}}>
                    {creating?<><Spin size={12}/>Creando...</>:"🚀 Crear en Asana"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Email view */}
        {mod==="Email" && (
          <div style={{fontSize:12.5,color:"var(--muted2)"}}>Pegá un email del cliente en el chat del agente ↓ y lo clasifico y redacto la respuesta.</div>
        )}

        {/* Archivos view */}
        {mod==="Archivos" && (
          <div style={{border:"2px dashed var(--border2)",borderRadius:10,padding:24,textAlign:"center",color:"var(--muted)"}}>
            <div style={{fontSize:24,marginBottom:8}}>📎</div>
            <div style={{fontSize:12.5}}>Arrastrá archivos acá para adjuntarlos al proyecto</div>
            <div style={{fontSize:11,marginTop:4}}>PDF, imágenes, documentos</div>
          </div>
        )}

        {/* Chat messages */}
        <div style={{borderTop:"1px solid var(--border)",paddingTop:10}}>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>Agente → {mod}</div>
          {msgs.length===0 && (
            <div style={{fontSize:12,color:"var(--muted2)",marginBottom:8}}>
              {mod==="Brief"&&"Pegá el brief del cliente y lo analizo."}
              {mod==="Estrategia"&&"Pedime territorios creativos o análisis estratégico."}
              {mod==="Concepto"&&"Pedime el concepto creativo basado en la estrategia."}
              {mod==="Medios"&&"Pedime el plan de medios y distribución de presupuesto."}
              {mod==="Tareas"&&"Describí el proyecto y lo divido en tareas para el equipo."}
              {mod==="Email"&&"Pegá el email del cliente y lo analizo."}
            </div>
          )}
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
            {loading&&<Typing/>}
            <div ref={bottom}/>
          </div>
        </div>
      </div>

      {/* Input */}
      <div style={{padding:"8px 12px",borderTop:"1px solid var(--border)",display:"flex",gap:6,flexShrink:0}}>
        <input value={input} onChange={e=>setInput(e.target.value)}
          placeholder={mod==="Brief"?"Pegá el brief...":`Preguntale al agente sobre ${mod}...`}
          style={{...S.inp,flex:1,fontSize:12,padding:"7px 10px"}}
          onKeyDown={e=>e.key==="Enter"&&send()}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{...S.btnP(),padding:"7px 12px",opacity:(!input.trim()||loading)?.35:1}}>→</button>
      </div>
    </div>
  );
}

// ── PROJECT VIEW ──────────────────────────────────────────────────────────────
function ProjectView({project, client, user, onBack}) {
  const [activeModules, setActiveModules] = useState(["Brief","Tareas"]);
  const [openModule, setOpenModule] = useState("Brief");
  const [asanaWs, setAsanaWs] = useState([]);
  const [selWs, setSelWs] = useState("");
  const [asanaProjects, setAsanaProjects] = useState([]);
  const [selProject, setSelProject] = useState("");
  const [asanaTasks, setAsanaTasks] = useState([]);
  const [asanaMembers, setAsanaMembers] = useState([]);
  const [showChat, setShowChat] = useState(true);

  useEffect(()=>{
    (async()=>{
      try {
        const w = await getWS(); setAsanaWs(w||[]);
        if(w&&w.length) {
          setSelWs(w[0].gid);
          const [p,m] = await Promise.all([getProjs(w[0].gid),getMembers(w[0].gid)]);
          setAsanaProjects(p||[]); setAsanaMembers(m||[]);
        }
      } catch(e) { console.error(e); }
    })();
  },[]);

  useEffect(()=>{
    if(selProject) getTasks(selProject).then(t=>setAsanaTasks(t||[])).catch(()=>{});
  },[selProject]);

  const asanaData = {ws:asanaWs,selWs,projects:asanaProjects,selProject,tasks:asanaTasks,members:asanaMembers};
  const colors = ["var(--accent)","var(--purple)","var(--blue)","var(--pink)","var(--amber)","var(--teal)"];
  const clientColor = colors[client?.name?.charCodeAt(0) % colors.length] || "var(--accent)";

  const toggleModule = mod => {
    setActiveModules(p => p.includes(mod) ? p.filter(m=>m!==mod) : [...p,mod]);
    if(!activeModules.includes(mod)) setOpenModule(mod);
  };

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)"}}>
      {/* Header */}
      <div style={{height:48,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,padding:"0 18px",background:"var(--surface)",flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"var(--muted2)",fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>← Clientes</button>
        <div style={{width:1,height:18,background:"var(--border)"}}/>
        <span style={{fontSize:12,color:"var(--muted2)"}}>{client?.name}</span>
        <div style={{width:1,height:18,background:"var(--border)"}}/>
        <div style={{width:6,height:6,borderRadius:"50%",background:clientColor}}/>
        <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14}}>{project?.name}</span>
        {project?.status&&<Tag color={project.status==="activo"?"var(--green)":"var(--amber)"} small>{project.status}</Tag>}
        <div style={{flex:1}}/>
        <button onClick={()=>setShowChat(p=>!p)} style={{...S.btnS,fontSize:12,padding:"5px 10px",background:showChat?"var(--border2)":"var(--card2)"}}>💬 Agente</button>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* Left: Module selector + panels */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Module tabs */}
          <div style={{display:"flex",gap:6,padding:"10px 16px",borderBottom:"1px solid var(--border)",background:"var(--surface)",flexShrink:0,overflowX:"auto"}}>
            {PROJECT_MODULES.map(mod=>(
              <button key={mod} onClick={()=>{toggleModule(mod);setOpenModule(mod);}}
                style={{...S.btnS,fontSize:12,padding:"5px 11px",
                  background:activeModules.includes(mod)?MODULE_COLORS[mod]+"22":"var(--card2)",
                  color:activeModules.includes(mod)?MODULE_COLORS[mod]:"var(--muted)",
                  border:`1px solid ${activeModules.includes(mod)?MODULE_COLORS[mod]+"44":"var(--border2)"}`,
                  whiteSpace:"nowrap"}}>
                {mod}
              </button>
            ))}
          </div>

          {/* Active module panel */}
          <div style={{flex:1,overflow:"hidden"}}>
            {openModule && activeModules.includes(openModule) ? (
              <ModulePanel
                mod={openModule}
                project={project}
                client={client}
                user={user}
                asanaData={asanaData}
                onClose={()=>setActiveModules(p=>p.filter(m=>m!==openModule))}
              />
            ) : (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--muted)",gap:12}}>
                <div style={{fontSize:32}}>📋</div>
                <div style={{fontSize:14}}>Seleccioná un módulo arriba para empezar</div>
                <div style={{fontSize:12,color:"var(--muted)"}}>Brief → Estrategia → Concepto → Medios → Tareas</div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Agent chat */}
        {showChat && (
          <div style={{width:300,borderLeft:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0}}>
            <AgentChat user={user} context={`Proyecto "${project?.name}" del cliente ${client?.name}. Módulo activo: ${openModule}`} onClose={()=>setShowChat(false)}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CLIENT VIEW ───────────────────────────────────────────────────────────────
function ClientView({client, user, onBack}) {
  const [projects, setProjects] = useState([]);
  const [showNewProj, setShowNewProj] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [openProject, setOpenProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    fb.getProjects(client.id).then(p=>{setProjects(p||[]);setLoading(false);}).catch(()=>setLoading(false));
  },[client.id]);

  const createProject = async () => {
    if(!newProjName.trim()) return;
    const id = "proj-"+Date.now().toString(36);
    const proj = {id,clientId:client.id,name:newProjName.trim(),status:"activo",modules:{},createdAt:Date.now()};
    await fb.saveProject(proj);
    setProjects(p=>[proj,...p]);
    setNewProjName(""); setShowNewProj(false);
    await fb.logAct({userId:user.id,userName:user.name,module:"proyectos",action:`Proyecto creado: ${proj.name}`});
  };

  if(openProject) return <ProjectView project={openProject} client={client} user={user} onBack={()=>setOpenProject(null)}/>;

  const colors = ["var(--accent)","var(--purple)","var(--blue)","var(--pink)","var(--amber)","var(--teal)"];
  const clientColor = colors[client.name.charCodeAt(0) % colors.length];

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)"}}>
      {/* Header */}
      <div style={{height:48,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:12,padding:"0 20px",background:"var(--surface)",flexShrink:0}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"var(--muted2)",fontSize:13,cursor:"pointer"}}>← Clientes</button>
        <div style={{width:1,height:18,background:"var(--border)"}}/>
        <div style={{width:8,height:8,borderRadius:"50%",background:clientColor}}/>
        <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15}}>{client.name}</span>
        {client.industry&&<span style={{fontSize:12,color:"var(--muted2)"}}>{client.industry}</span>}
        {client.status&&<Tag color={client.status==="activo"?"var(--green)":client.status==="prospecto"?"var(--amber)":"var(--muted2)"} small>{client.status}</Tag>}
        <div style={{flex:1}}/>
        <button onClick={()=>setShowNewProj(true)} style={{...S.btnP(),padding:"7px 14px",fontSize:12}}>+ Nuevo proyecto</button>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* Projects list */}
        <div style={{flex:1,overflowY:"auto",padding:24}}>
          <div style={{marginBottom:20}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700,color:"var(--muted2)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Proyectos</div>
            {client.description&&<div style={{fontSize:13,color:"var(--muted2)",maxWidth:600}}>{client.description}</div>}
          </div>

          {showNewProj && (
            <div className="fu" style={{...S.card,padding:16,marginBottom:16,display:"flex",gap:8}}>
              <input value={newProjName} onChange={e=>setNewProjName(e.target.value)} placeholder="Nombre del proyecto..." style={{...S.inp,flex:1}} autoFocus onKeyDown={e=>e.key==="Enter"&&createProject()}/>
              <button onClick={createProject} disabled={!newProjName.trim()} style={{...S.btnP(),padding:"8px 14px",fontSize:12,opacity:!newProjName.trim()?.5:1}}>Crear</button>
              <button onClick={()=>setShowNewProj(false)} style={S.btnS}>✕</button>
            </div>
          )}

          {loading ? (
            <div style={{display:"flex",gap:8,color:"var(--muted)",padding:20,alignItems:"center"}}><Spin/>Cargando...</div>
          ) : projects.length===0 ? (
            <div style={{textAlign:"center",padding:"60px 20px",color:"var(--muted)"}}>
              <div style={{fontSize:36,marginBottom:12}}>📋</div>
              <div style={{fontSize:14,marginBottom:16}}>No hay proyectos todavía</div>
              <button onClick={()=>setShowNewProj(true)} style={{...S.btnP(),padding:"9px 18px",fontSize:13}}>+ Crear primer proyecto</button>
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
              {projects.map(proj=>{
                const pc = colors[proj.name.charCodeAt(0) % colors.length];
                return (
                  <div key={proj.id} onClick={()=>setOpenProject(proj)} className="fu"
                    style={{...S.card,padding:0,cursor:"pointer",overflow:"hidden",transition:"border .2s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border3)"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
                    <div style={{height:4,background:pc}}/>
                    <div style={{padding:"14px 16px"}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,marginBottom:6}}>{proj.name}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
                        {Object.keys(proj.modules||{}).filter(k=>proj.modules[k]).map(k=>(
                          <Tag key={k} color={MODULE_COLORS[k]||"var(--muted2)"} small>{k}</Tag>
                        ))}
                        {Object.keys(proj.modules||{}).length===0&&<span style={{fontSize:11,color:"var(--muted)"}}>Sin módulos activos</span>}
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:11,color:"var(--muted)"}}>{new Date(proj.createdAt).toLocaleDateString("es-AR")}</span>
                        {proj.status&&<Tag color={proj.status==="activo"?"var(--green)":"var(--amber)"} small>{proj.status}</Tag>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Agent chat */}
        <div style={{width:280,borderLeft:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0}}>
          <AgentChat user={user} context={`Cliente ${client.name} — ${client.industry||""} — ${client.description||""}`}/>
        </div>
      </div>
    </div>
  );
}

// ── CLIENTS HUB (HOME) ────────────────────────────────────────────────────────
function ClientsHub({user, onLogout}) {
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openClient, setOpenClient] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("todos");
  const [showChat, setShowChat] = useState(false);

  useEffect(()=>{
    (async()=>{
      const [c, snap] = await Promise.all([fb.getClients(), getDocs(collection(db,"projects")).catch(()=>({docs:[]}))]);
      setClients(c||[]);
      setProjects(snap.docs?.map(d=>({id:d.id,...d.data()}))||[]);
      setLoading(false);
    })();
  },[]);

  const handleNewClient = async c => {
    await fb.saveClient(c);
    setClients(p=>[c,...p]);
    setShowNew(false);
    await fb.logAct({userId:user.id,userName:user.name,module:"clientes",action:`Cliente creado: ${c.name}`});
  };

  if(openClient) return <ClientView client={openClient} user={user} onBack={()=>setOpenClient(null)}/>;

  const filtered = clients.filter(c=>{
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase())||(c.industry||"").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus==="todos"||c.status===filterStatus;
    return matchSearch&&matchStatus;
  });

  const projCountFor = id => projects.filter(p=>p.clientId===id).length;

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)"}}>
      {/* Top bar */}
      <div style={{height:52,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 22px",background:"var(--surface)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:"var(--accent)",animation:"pulse 2s infinite"}}/>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,letterSpacing:"-.025em"}}>
            <span style={{color:"var(--accent)"}}>Aldea</span> <span style={{color:"var(--muted2)",fontWeight:400}}>Creative</span> Hub
          </span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Tag color={ROLES[user.role]?.color||"var(--muted)"}>{ROLES[user.role]?.icon} {ROLES[user.role]?.label}</Tag>
          <span style={{fontSize:13,color:"var(--muted2)"}}>{user.name}</span>
          <button onClick={()=>setShowChat(p=>!p)} style={{...S.btnS,fontSize:12,padding:"5px 10px",background:showChat?"var(--border2)":"var(--card2)"}}>💬</button>
          <button onClick={onLogout} style={{...S.btnS,fontSize:12,padding:"5px 10px"}}>Salir</button>
        </div>
      </div>

      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* Main content */}
        <div style={{flex:1,overflowY:"auto",padding:24}}>
          {/* Stats row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:24}}>
            {[
              {label:"Clientes totales",value:clients.length,color:"var(--accent)"},
              {label:"Activos",value:clients.filter(c=>c.status==="activo").length,color:"var(--green)"},
              {label:"Prospectos",value:clients.filter(c=>c.status==="prospecto").length,color:"var(--amber)"},
              {label:"Proyectos",value:projects.length,color:"var(--purple)"},
            ].map(s=>(
              <div key={s.label} style={{...S.card,padding:"14px 16px"}}>
                <div style={{fontSize:22,fontFamily:"'Syne',sans-serif",fontWeight:800,color:s.color,marginBottom:2}}>{s.value}</div>
                <div style={{fontSize:11.5,color:"var(--muted2)"}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Search + filters + new */}
          <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Buscar cliente..." style={{...S.inp,maxWidth:260,flex:1}}/>
            <div style={{display:"flex",gap:6}}>
              {["todos","activo","prospecto","pausado"].map(s=>(
                <button key={s} onClick={()=>setFilterStatus(s)}
                  style={{...S.btnS,fontSize:12,padding:"6px 12px",background:filterStatus===s?"var(--border2)":"var(--card2)",color:filterStatus===s?"var(--text)":"var(--muted)"}}>
                  {s.charAt(0).toUpperCase()+s.slice(1)}
                </button>
              ))}
            </div>
            <button onClick={()=>setShowNew(true)} style={{...S.btnP(),padding:"8px 16px",fontSize:13,marginLeft:"auto"}}>+ Nuevo cliente</button>
          </div>

          {/* Clients grid */}
          {loading ? (
            <div style={{display:"flex",gap:8,color:"var(--muted)",padding:20,alignItems:"center"}}><Spin/>Cargando clientes...</div>
          ) : filtered.length===0 ? (
            <div style={{textAlign:"center",padding:"80px 20px",color:"var(--muted)"}}>
              <div style={{fontSize:40,marginBottom:14}}>🏢</div>
              <div style={{fontSize:15,marginBottom:8}}>{clients.length===0?"No hay clientes todavía":"Sin resultados para tu búsqueda"}</div>
              {clients.length===0&&<button onClick={()=>setShowNew(true)} style={{...S.btnP(),padding:"10px 20px",fontSize:13}}>+ Crear primer cliente</button>}
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
              {filtered.map(c=><ClientCard key={c.id} client={c} projectCount={projCountFor(c.id)} onClick={()=>setOpenClient(c)}/>)}
            </div>
          )}
        </div>

        {/* Agent chat panel */}
        {showChat && (
          <div style={{width:300,borderLeft:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0}}>
            <AgentChat user={user} context="Panel principal de la agencia — centro de clientes" onClose={()=>setShowChat(false)}/>
          </div>
        )}
      </div>

      {showNew && <NewClientModal onSave={handleNewClient} onClose={()=>setShowNew(false)}/>}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  return (
    <>
      <G/>
      {user ? <ClientsHub user={user} onLogout={()=>setUser(null)}/> : <Auth onEnter={setUser}/>}
    </>
  );
}
