import { useState, useRef, useEffect } from "react";
import { collection, doc, setDoc, getDocs, addDoc, query, orderBy, limit, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#09090b;--surface:#101013;--card:#16161a;--border:#1f1f26;--border2:#2a2a34;--accent:#b8ff57;--text:#ededf0;--muted:#62626e;--muted2:#909099;--red:#ff5f5f;--blue:#5fa8ff;--amber:#ffbe4d;--green:#4dffc3;--purple:#b87cff;--pink:#ff7cc8}
    body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
    @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
    @keyframes spin{to{transform:rotate(360deg)}}
    .fu{animation:fadeUp .3s ease both}
    textarea,input,button,select{font-family:'DM Sans',sans-serif}textarea{resize:vertical}button{cursor:pointer}
  `}</style>
);

// ── CLAUDE ────────────────────────────────────────────────────────────────────
async function callClaude(apiKey, system, userMsg, history = []) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:1500,system,messages:[...history,{role:"user",content:userMsg}]}),
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
const getProjs = ws => aGet(`/projects?workspace=${ws}&opt_fields=gid,name`);
const getTasks = p => aGet(`/projects/${p}/tasks?opt_fields=gid,name,completed,assignee,due_on`);
const getMembers = ws => aGet(`/workspaces/${ws}/users?opt_fields=gid,name,email`);
const createProj = (ws,name) => aPost("/projects",{name,workspace:ws,color:"light-green"});
const createTask = (p,t) => aPost("/tasks",{name:t.name,notes:t.notes||"",projects:[p],assignee:t.assigneeGid||null,due_on:t.due_on||null});

// ── FIREBASE ──────────────────────────────────────────────────────────────────
const saveUser = async u => { const {pass,...s}=u; await setDoc(doc(db,"users",u.id),{...s,updatedAt:serverTimestamp()}); };
const getAllUsers = async () => { try{const s=await getDocs(collection(db,"users"));return s.docs.map(d=>d.data());}catch{return[];} };
const logAct = async e => { try{await addDoc(collection(db,"activity"),{...e,ts:serverTimestamp()});}catch{} };
const saveConv = async (uid,mod,msgs,meta={}) => { try{await setDoc(doc(db,"conversations",`${uid}_${mod}_${Date.now()}`),{userId:uid,moduleId:mod,messages:msgs,...meta,savedAt:serverTimestamp()});}catch{} };
const getAllConvs = async () => { try{const s=await getDocs(query(collection(db,"conversations"),orderBy("savedAt","desc"),limit(200)));return s.docs.map(d=>({id:d.id,...d.data()}));}catch{return[];} };
const saveBrief = async b => { try{await setDoc(doc(db,"briefs",b.id),{...b,savedAt:serverTimestamp()});}catch(e){console.error(e);} };
const getAllBriefs = async () => { try{const s=await getDocs(query(collection(db,"briefs"),orderBy("savedAt","desc"),limit(100)));return s.docs.map(d=>({id:d.id,...d.data()}));}catch{return[];} };

const getLocal = () => { try{return JSON.parse(localStorage.getItem("aldea_u")||"{}");}catch{return{};} };
const saveLocal = u => { const d=getLocal(); d[u.id]=u; localStorage.setItem("aldea_u",JSON.stringify(d)); };
const findLocal = (n,p) => Object.values(getLocal()).find(u=>u.name.toLowerCase()===n.toLowerCase()&&u.pass===p);

// ── CONFIG ────────────────────────────────────────────────────────────────────
const ROLES = {
  director:  {label:"Director / Dueño",   color:"var(--accent)",icon:"◆",tabs:["briefs","email","proyectos","estrategia","campanas","equipo","historial"]},
  creativo:  {label:"Director Creativo",  color:"var(--purple)",icon:"✦",tabs:["briefs","estrategia","campanas","email","historial"]},
  cuentas:   {label:"Ejecutivo de Cuentas",color:"var(--blue)", icon:"◉",tabs:["briefs","email","proyectos","campanas","historial"]},
  produccion:{label:"Producción / Social",color:"var(--pink)",  icon:"◈",tabs:["briefs","proyectos","campanas","historial"]},
};
const AREAS = {
  "Diseño / Creatividad":{color:"var(--purple)",icon:"🎨"},
  "Estrategia":          {color:"var(--amber)", icon:"💡"},
  "Producción / Social": {color:"var(--pink)",  icon:"📱"},
  "Cuentas / Comercial": {color:"var(--blue)",  icon:"💼"},
  "Administración":      {color:"var(--green)", icon:"⚙️"},
};
const ALL_TABS=[
  {id:"briefs",     icon:"📁", label:"Briefs"},
  {id:"email",      icon:"✉️", label:"Email"},
  {id:"proyectos",  icon:"📋", label:"Proyectos"},
  {id:"estrategia", icon:"💡", label:"Estrategia"},
  {id:"campanas",   icon:"🎨", label:"Campañas"},
  {id:"equipo",     icon:"👥", label:"Equipo"},
  {id:"historial",  icon:"🗂", label:"Historial"},
];
const MC={email:"var(--blue)",proyectos:"var(--amber)",estrategia:"var(--purple)",campanas:"var(--pink)",briefs:"var(--green)",sistema:"var(--muted2)"};
const ML={email:"Email",proyectos:"Proyectos",estrategia:"Estrategia",campanas:"Campañas",briefs:"Brief",sistema:"Sistema"};

const BASE=(r,n)=>`Sos el agente de Aldea Creative Hub, agencia 360 argentina. Hablás en español rioplatense con ${n} (${ROLES[r]?.label}). Sos estratégico, creativo y directo.`;
const SYS_BRIEF_EXTRACT=`Sos un estratega de agencia 360. Dado un texto de brief, extraé la información clave y respondé SOLO con JSON sin markdown:
{"cliente":"...","producto":"...","objetivo":"...","target":"...","presupuesto":"...","canales":"...","plazo":"...","competencia":"...","tono":"...","insight":"...","kpis":"...","resumen":"párrafo corto que resume todo el brief"}`;
const SYS_EMAIL=(r,n,brief)=>`${BASE(r,n)}${brief?`\n\nCONTEXTO BRIEF ACTIVO — ${brief.cliente}:\n${brief.resumen||""}`:""}\nMÓDULO EMAIL. Respondé SIEMPRE:\n---CLASIFICACIÓN---\nTipo: [Cliente/Proveedor/Prospecto/Interno/Spam]\nUrgencia: [Alta/Media/Baja]\nResumen: [1 oración]\n---BORRADOR---\n[email completo]\n---ASUNTO SUGERIDO---\n[asunto]\n---ACCIÓN ASANA---\n[tarea o No aplica]`;
const SYS_PROY=(r,n,team,brief)=>`${BASE(r,n)}${brief?`\n\nBRIEF ACTIVO — ${brief.cliente}:\nObjetivo: ${brief.objetivo||""}\nTarget: ${brief.target||""}\nPlazo: ${brief.plazo||""}\nCanales: ${brief.canales||""}`:""}\nEquipo:\n${team.map(m=>`- ${m.name} (${m.area||"Sin área"})`).join("\n")}\n\nRespondé SOLO con JSON sin markdown:\n{"resumen":"...","tareas":[{"nombre":"...","responsable":"nombre","prioridad":"alta|media|baja","deadline":"X días","notas":"..."}],"riesgos":"...","arranque":"..."}`;
const SYS_EST=(r,n,brief)=>`${BASE(r,n)}${brief?`\n\nBRIEF ACTIVO — ${brief.cliente}:\n${JSON.stringify({objetivo:brief.objetivo,target:brief.target,tono:brief.tono,insight:brief.insight,competencia:brief.competencia})}`:""}\nMÓDULO ESTRATEGIA: insight central + 3 territorios creativos distintos (nombre+concepto+ejemplo) + pregunta estratégica clave.`;
const SYS_CAMP=(r,n,brief)=>`${BASE(r,n)}${brief?`\n\nBRIEF ACTIVO — ${brief.cliente}:\nProducto: ${brief.producto||""}\nObjetivo: ${brief.objetivo||""}\nTarget: ${brief.target||""}\nPresupuesto: ${brief.presupuesto||""}\nCanales: ${brief.canales||""}\nTono: ${brief.tono||""}`:""}\nCAMPAÑAS 360:\n**CONCEPTO**: nombre/idea/tagline\n**PIEZAS** (4 formatos): formato·copy principal·copy secundario·dir de arte\n**PLAN DE MEDIOS**: canales+%\n**KPIs**: 3 métricas`;

const inp={width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 14px",color:"var(--text)",fontSize:14,outline:"none"};
const btnP=(c="var(--accent)")=>({background:c,color:c==="var(--accent)"?"#09090b":"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13.5,cursor:"pointer"});
const btnS={background:"var(--card)",color:"var(--text)",border:"1px solid var(--border2)",borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer"};

function Tag({color,children}){return <span style={{background:color+"20",color,border:`1px solid ${color}44`,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:600}}>{children}</span>;}
function Typing(){return <div style={{display:"flex",gap:5,padding:"10px 4px"}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",animation:`blink 1.2s ${i*.2}s infinite`}}/>)}</div>;}
function Spin(){return <div style={{width:16,height:16,border:"2px solid var(--border2)",borderTop:"2px solid var(--accent)",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>;}
function Bubble({role:r,text}){const a=r==="assistant";return <div className="fu" style={{display:"flex",justifyContent:a?"flex-start":"flex-end",marginBottom:10}}><div style={{maxWidth:"82%",background:a?"var(--card)":"var(--accent)",color:a?"var(--text)":"#09090b",border:a?"1px solid var(--border)":"none",borderRadius:a?"4px 14px 14px 14px":"14px 4px 14px 14px",padding:"11px 15px",fontSize:13.5,lineHeight:1.68,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{text}</div></div>;}
function MH({icon,title,sub,right}){return <div style={{marginBottom:16,paddingBottom:14,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,marginBottom:3}}>{icon} {title}</div><div style={{fontSize:12.5,color:"var(--muted2)"}}>{sub}</div></div>{right}</div>;}

// ── BRIEF SELECTOR BAR ────────────────────────────────────────────────────────
function BriefBar({briefs, activeBrief, onSelect}){
  if(!briefs.length) return null;
  return(
    <div style={{background:"#b8ff5708",border:"1px solid #b8ff5720",borderRadius:8,padding:"8px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
      <span style={{fontSize:11,color:"var(--accent)",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",flexShrink:0}}>Brief activo</span>
      <select value={activeBrief?.id||""} onChange={e=>onSelect(briefs.find(b=>b.id===e.target.value)||null)}
        style={{...inp,width:"auto",fontSize:12,padding:"4px 10px",appearance:"none",flex:1,minWidth:180}}>
        <option value="">— Sin brief seleccionado —</option>
        {briefs.map(b=><option key={b.id} value={b.id}>{b.cliente} — {b.producto||"sin producto"}</option>)}
      </select>
      {activeBrief&&<span style={{fontSize:11,color:"var(--muted2)",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{activeBrief.resumen}</span>}
    </div>
  );
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
function Setup({onEnter}){
  const [mode,setMode]=useState("login");
  const [f,setF]=useState({name:"",role:"director",area:"Diseño / Creatividad",apiKey:"",pass:"",uid:"",lp:""});
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  const register=async()=>{
    if(!f.name.trim()){setErr("Ingresá tu nombre");return;}
    if(!f.apiKey.trim().startsWith("sk-ant-")){setErr("API key inválida");return;}
    if(!f.pass.trim()){setErr("Ingresá una contraseña");return;}
    setLoading(true);setErr("");
    try{
      await callClaude(f.apiKey.trim(),"Respondé solo: OK","OK");
      const id=f.name.trim().toLowerCase().replace(/\s+/g,"-")+"-"+Date.now().toString(36);
      const user={id,name:f.name.trim(),role:f.role,area:f.area,apiKey:f.apiKey.trim(),pass:f.pass.trim(),createdAt:Date.now()};
      await saveUser(user);saveLocal(user);
      await logAct({userId:id,userName:user.name,userRole:user.role,module:"sistema",action:"Se registró en Aldea"});
      onEnter(user);
    }catch(e){setErr("Error: "+e.message);}
    setLoading(false);
  };
  const login=async()=>{
    if(!f.uid.trim()||!f.lp.trim()){setErr("Completá todos los campos");return;}
    setLoading(true);setErr("");
    const found=findLocal(f.uid.trim(),f.lp.trim());
    if(!found){setErr("Usuario o contraseña incorrectos");setLoading(false);return;}
    await logAct({userId:found.id,userName:found.name,userRole:found.role,module:"sistema",action:"Inició sesión"});
    setLoading(false);onEnter(found);
  };
  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)",padding:24}}>
      <div className="fu" style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:18,padding:48,maxWidth:440,width:"100%"}}>
        <div style={{marginBottom:32,textAlign:"center"}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800,letterSpacing:"-.03em",marginBottom:6}}><span style={{color:"var(--accent)"}}>Aldea</span> <span style={{color:"var(--muted2)",fontWeight:400}}>Creative</span> Hub</div>
          <div style={{fontSize:11,color:"var(--muted)",letterSpacing:".12em",textTransform:"uppercase"}}>Agente cerebro · agencia 360</div>
        </div>
        <div style={{display:"flex",background:"var(--card)",borderRadius:8,padding:3,marginBottom:22,border:"1px solid var(--border)"}}>
          {["login","register"].map(m=><button key={m} onClick={()=>{setMode(m);setErr("");}} style={{flex:1,padding:"8px 0",border:"none",borderRadius:6,fontSize:13,fontWeight:500,background:mode===m?"var(--border2)":"transparent",color:mode===m?"var(--text)":"var(--muted)"}}>{m==="login"?"Ingresar":"Registrarse"}</button>)}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:13}}>
          {mode==="register"?(<>
            <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Tu nombre</label><input value={f.name} onChange={e=>up("name",e.target.value)} placeholder="Ej: Mathias Gamarra" style={inp}/></div>
            <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Tu rol</label><select value={f.role} onChange={e=>up("role",e.target.value)} style={{...inp,appearance:"none"}}>{Object.entries(ROLES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}</select></div>
            <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Tu área</label><select value={f.area} onChange={e=>up("area",e.target.value)} style={{...inp,appearance:"none"}}>{Object.keys(AREAS).map(a=><option key={a} value={a}>{AREAS[a].icon} {a}</option>)}</select></div>
            <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Anthropic API Key</label><input type="password" value={f.apiKey} onChange={e=>up("apiKey",e.target.value)} placeholder="sk-ant-api03-..." style={inp}/></div>
            <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Contraseña</label><input type="password" value={f.pass} onChange={e=>up("pass",e.target.value)} placeholder="Elegí una contraseña" style={inp} onKeyDown={e=>e.key==="Enter"&&register()}/></div>
          </>):(<>
            <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Nombre de usuario</label><input value={f.uid} onChange={e=>up("uid",e.target.value)} placeholder="Tu nombre" style={inp}/></div>
            <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Contraseña</label><input type="password" value={f.lp} onChange={e=>up("lp",e.target.value)} placeholder="Tu contraseña" style={inp} onKeyDown={e=>e.key==="Enter"&&login()}/></div>
          </>)}
          {err&&<div style={{background:"#ff5f5f12",border:"1px solid #ff5f5f30",borderRadius:8,padding:"9px 13px",fontSize:13,color:"var(--red)"}}>{err}</div>}
          <button onClick={mode==="register"?register:login} disabled={loading} style={{...btnP(),width:"100%",marginTop:4,opacity:loading?.6:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {loading?<><Spin/>Verificando...</>:mode==="register"?"Crear cuenta →":"Entrar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── BRIEFS MODULE ─────────────────────────────────────────────────────────────
function BriefsModule({user, briefs, onBriefsUpdate, onActivate}){
  const [view,setView]=useState("lista"); // lista | nuevo | detalle
  const [selected,setSelected]=useState(null);
  const [form,setForm]=useState({cliente:"",producto:"",texto:""});
  const [file,setFile]=useState(null);
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState("");
  const fileRef=useRef();

  const readFile=f=>new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>res(e.target.result);
    r.onerror=rej;
    if(f.name.endsWith(".pdf")||f.type==="application/pdf") r.readAsDataURL(f);
    else r.readAsText(f);
  });

  const extractBrief=async()=>{
    if(!form.texto.trim()&&!file){setMsg("❌ Escribí el brief o subí un archivo");return;}
    setLoading(true);setMsg("");
    try{
      let textContent=form.texto.trim();
      if(file&&!textContent){
        if(file.name.endsWith(".pdf")||file.type==="application/pdf"){
          textContent=`[Archivo PDF: ${file.name}] El usuario subió un brief en PDF. Extraé la info con lo que puedas inferir del nombre: ${file.name}`;
        } else {
          textContent=await readFile(file);
        }
      }
      const prompt=`Brief a analizar:\nCliente: ${form.cliente||"No especificado"}\nProducto: ${form.producto||"No especificado"}\n\nContenido:\n${textContent}`;
      const r=await callClaude(user.apiKey,SYS_BRIEF_EXTRACT,prompt);
      const clean=r.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      const id="brief-"+Date.now().toString(36);
      const brief={id,...parsed,cliente:form.cliente||parsed.cliente||"Sin nombre",rawText:textContent.slice(0,3000),createdBy:user.name,createdAt:Date.now()};
      await saveBrief(brief);
      onBriefsUpdate([brief,...briefs]);
      setMsg(`✓ Brief de ${brief.cliente} guardado`);
      setSelected(brief);setView("detalle");
      setForm({cliente:"",producto:"",texto:""});setFile(null);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"briefs",action:`Brief creado: ${brief.cliente}`});
    }catch(e){setMsg("❌ Error: "+e.message);}
    setLoading(false);
  };

  if(view==="detalle"&&selected) return(
    <div style={{display:"flex",flexDirection:"column",flex:1}} className="fu">
      <MH icon="📁" title={selected.cliente} sub={selected.producto||""}
        right={<div style={{display:"flex",gap:7}}>
          <button onClick={()=>onActivate(selected)} style={{...btnP(),padding:"7px 14px",fontSize:12}}>⚡ Activar en todos</button>
          <button onClick={()=>setView("lista")} style={{...btnS,fontSize:12,padding:"5px 11px"}}>← Volver</button>
        </div>}
      />
      <div style={{flex:1,overflowY:"auto",maxHeight:460}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          {[["🎯 Objetivo",selected.objetivo],["👥 Target",selected.target],["💰 Presupuesto",selected.presupuesto],["📡 Canales",selected.canales],["⏱ Plazo",selected.plazo],["🏆 Competencia",selected.competencia],["🗣 Tono",selected.tono],["📊 KPIs",selected.kpis]].map(([k,v])=>v&&(
            <div key={k} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px"}}>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:4}}>{k}</div>
              <div style={{fontSize:13,color:"var(--text)"}}>{v}</div>
            </div>
          ))}
        </div>
        {selected.insight&&<div style={{background:"#b8ff5710",border:"1px solid #b8ff5730",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
          <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:".08em"}}>💡 Insight</div>
          <div style={{fontSize:13.5,color:"var(--text)",lineHeight:1.65}}>{selected.insight}</div>
        </div>}
        {selected.resumen&&<div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:".08em"}}>Resumen</div>
          <div style={{fontSize:13,color:"var(--muted2)",lineHeight:1.65}}>{selected.resumen}</div>
        </div>}
      </div>
    </div>
  );

  if(view==="nuevo") return(
    <div style={{display:"flex",flexDirection:"column",flex:1}} className="fu">
      <MH icon="📁" title="Nuevo Brief" sub="Subí un archivo o escribí el brief directo"
        right={<button onClick={()=>setView("lista")} style={{...btnS,fontSize:12,padding:"5px 11px"}}>← Volver</button>}
      />
      <div style={{display:"flex",flexDirection:"column",gap:12,flex:1,overflowY:"auto"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Nombre del cliente</label><input value={form.cliente} onChange={e=>setForm(p=>({...p,cliente:e.target.value}))} placeholder="Ej: Café Oculto" style={inp}/></div>
          <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Producto / campaña</label><input value={form.producto} onChange={e=>setForm(p=>({...p,producto:e.target.value}))} placeholder="Ej: Lanzamiento verano" style={inp}/></div>
        </div>

        <div style={{border:"2px dashed var(--border2)",borderRadius:10,padding:20,textAlign:"center",cursor:"pointer",transition:"border .2s"}}
          onClick={()=>fileRef.current?.click()}
          onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--accent)";}}
          onDragLeave={e=>{e.currentTarget.style.borderColor="var(--border2)";}}
          onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--border2)";const f=e.dataTransfer.files[0];if(f)setFile(f);}}>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{display:"none"}} onChange={e=>setFile(e.target.files[0])}/>
          {file?<div style={{color:"var(--accent)",fontSize:14}}>📎 {file.name}</div>:<div><div style={{fontSize:24,marginBottom:8}}>📎</div><div style={{fontSize:13,color:"var(--muted)"}}>Arrastrá o clic para subir PDF, Word o TXT</div></div>}
        </div>

        <div><label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>O escribí el brief acá</label>
          <textarea value={form.texto} onChange={e=>setForm(p=>({...p,texto:e.target.value}))} placeholder="Pegá o escribí el contenido del brief..." rows={8} style={inp}/>
        </div>

        {msg&&<div style={{fontSize:13,color:msg.startsWith("✓")?"var(--green)":"var(--red)",padding:"8px 0"}}>{msg}</div>}

        <button onClick={extractBrief} disabled={loading} style={{...btnP(),width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:loading?.6:1}}>
          {loading?<><Spin/>Analizando brief...</>:"✦ Analizar y guardar brief"}
        </button>
      </div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="📁" title="Briefs" sub="Central de briefs por cliente — activan el contexto en todos los módulos"
        right={<button onClick={()=>setView("nuevo")} style={{...btnP(),padding:"8px 16px",fontSize:13}}>+ Nuevo brief</button>}
      />
      {briefs.length===0?(
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--muted)"}}>
          <div style={{fontSize:36,marginBottom:12}}>📁</div>
          <div style={{fontSize:14,marginBottom:16}}>No hay briefs todavía</div>
          <button onClick={()=>setView("nuevo")} style={{...btnP(),padding:"10px 20px",fontSize:13}}>+ Crear el primer brief</button>
        </div>
      ):(
        <div style={{flex:1,overflowY:"auto",maxHeight:480}}>
          {briefs.map(b=>(
            <div key={b.id} onClick={()=>{setSelected(b);setView("detalle");}}
              style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"13px 15px",marginBottom:7,cursor:"pointer",transition:"border .2s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="var(--accent)"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:700,marginBottom:4}}>{b.cliente}</div>
                  <div style={{fontSize:12.5,color:"var(--muted2)",marginBottom:6}}>{b.producto||"Sin producto definido"}</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {b.objetivo&&<Tag color="var(--blue)">{b.objetivo.slice(0,40)}</Tag>}
                    {b.canales&&<Tag color="var(--purple)">{b.canales.slice(0,30)}</Tag>}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:11,color:"var(--muted)"}}>{b.createdBy}</div>
                  <button onClick={e=>{e.stopPropagation();onActivate(b);}} style={{...btnP(),padding:"5px 10px",fontSize:11,marginTop:6}}>⚡ Activar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────
function EmailModule({user,briefs,activeBrief,onSelectBrief}){
  const [input,setInput]=useState(""); const [msgs,setMsgs]=useState([]); const [loading,setLoading]=useState(false);
  const [draft,setDraft]=useState(null); const [approved,setApproved]=useState(false); const [copied,setCopied]=useState(false);
  const bottom=useRef();
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  const send=async()=>{
    const msg=input.trim(); if(!msg||loading) return;
    setInput(""); setDraft(null); setApproved(false); setCopied(false);
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try{
      const r=await callClaude(user.apiKey,SYS_EMAIL(user.role,user.name,activeBrief),msg,msgs.map(m=>({role:m.role,content:m.text})));
      setMsgs(p=>[...p,{role:"assistant",text:r}]);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"email",action:msg.slice(0,60)});
      const bm=r.match(/---BORRADOR---([\s\S]*?)---ASUNTO SUGERIDO---/);
      const sm=r.match(/---ASUNTO SUGERIDO---([\s\S]*?)---ACCIÓN ASANA---/);
      if(bm) setDraft({body:bm[1].trim(),subject:sm?sm[1].trim():""});
    }catch(e){setMsgs(p=>[...p,{role:"assistant",text:"❌ "+e.message}]);}
    setLoading(false);
  };
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="✉️" title="Email inteligente" sub="Pegá un email → clasifica, resume y redacta la respuesta para tu aprobación"/>
      <BriefBar briefs={briefs} activeBrief={activeBrief} onSelect={onSelectBrief}/>
      <div style={{flex:1,overflowY:"auto",minHeight:200,maxHeight:320,paddingBottom:8}}>
        {msgs.length===0&&<div style={{textAlign:"center",padding:"40px 20px",color:"var(--muted)"}}><div style={{fontSize:28,marginBottom:8}}>✉️</div><div style={{fontSize:13}}>Pegá el email que recibiste</div></div>}
        {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
        {loading&&<Typing/>}<div ref={bottom}/>
      </div>
      {draft&&!approved&&<div className="fu" style={{background:"#b8ff5712",border:"1px solid #b8ff5730",borderRadius:10,padding:12,margin:"8px 0"}}>
        <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>¿Aprobás el borrador?</div>
        <div style={{fontSize:12.5,color:"var(--muted2)",marginBottom:8}}>Asunto: <strong style={{color:"var(--text)"}}>{draft.subject}</strong></div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>{try{navigator.clipboard.writeText(`Asunto: ${draft.subject}\n\n${draft.body}`);}catch(e){}setCopied(true);setApproved(true);setTimeout(()=>setCopied(false),2500);}} style={{...btnP(),padding:"7px 14px",fontSize:13}}>✓ Aprobar y copiar</button>
          <button onClick={()=>{setDraft(null);setInput("Reescribí con tono más formal");}} style={{...btnS,fontSize:13}}>↺ Reescribir</button>
        </div>
      </div>}
      {approved&&<div className="fu" style={{background:"#4dffc310",border:"1px solid #4dffc330",borderRadius:8,padding:"8px 12px",margin:"8px 0",fontSize:13,color:"var(--green)"}}>{copied?"✓ Copiado — pegalo en Gmail":"✓ Borrador aprobado"}</div>}
      <div style={{display:"flex",gap:8,paddingTop:11,borderTop:"1px solid var(--border)",alignItems:"flex-end"}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Pegá el email que recibiste..." rows={3} style={{...inp,flex:1}} onKeyDown={e=>{if(e.key==="Enter"&&e.metaKey)send();}}/>
        <button onClick={send} disabled={loading||!input.trim()} style={{...btnP(),padding:"11px 18px",opacity:(!input.trim()||loading)?.35:1}}>{loading?"...":"→"}</button>
      </div>
    </div>
  );
}

// ── PROYECTOS ─────────────────────────────────────────────────────────────────
function ProyectosModule({user,briefs,activeBrief,onSelectBrief}){
  const [input,setInput]=useState(""); const [msgs,setMsgs]=useState([]); const [loading,setLoading]=useState(false);
  const [parsed,setParsed]=useState(null); const [view,setView]=useState("chat");
  const [ws,setWs]=useState([]); const [selWs,setSelWs]=useState("");
  const [projects,setProjects]=useState([]); const [selProject,setSelProject]=useState("");
  const [tasks,setTasks]=useState([]); const [members,setMembers]=useState([]);
  const [creating,setCreating]=useState(false); const [createMsg,setCreateMsg]=useState("");
  const [asanaLoad,setAsanaLoad]=useState(false); const [dbUsers,setDbUsers]=useState([]);
  const bottom=useRef();
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  useEffect(()=>{
    (async()=>{
      try{const w=await getWS();setWs(w||[]);if(w&&w.length){setSelWs(w[0].gid);const [p,m]=await Promise.all([getProjs(w[0].gid),getMembers(w[0].gid)]);setProjects(p||[]);setMembers(m||[]);}}catch(e){}
      getAllUsers().then(u=>setDbUsers(u||[])).catch(()=>{});
    })();
  },[]);
  useEffect(()=>{if(!selProject)return;setAsanaLoad(true);getTasks(selProject).then(t=>{setTasks(t||[]);setAsanaLoad(false);}).catch(()=>setAsanaLoad(false));},[selProject]);
  const team=dbUsers.length?dbUsers.map(u=>({name:u.name,area:u.area||"Sin área"})):members.map(m=>({name:m.name,area:"Asana"}));
  const send=async()=>{
    const msg=input.trim(); if(!msg||loading) return;
    setInput(""); setParsed(null); setCreateMsg("");
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try{
      const r=await callClaude(user.apiKey,SYS_PROY(user.role,user.name,team,activeBrief),msg,msgs.map(m=>({role:m.role,content:m.text})));
      setMsgs(p=>[...p,{role:"assistant",text:r}]);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"proyectos",action:msg.slice(0,60)});
      try{const j=JSON.parse(r.replace(/```json|```/g,"").trim());setParsed(j);}catch(e){}
    }catch(e){setMsgs(p=>[...p,{role:"assistant",text:"❌ "+e.message}]);}
    setLoading(false);
  };
  const createInAsana=async()=>{
    if(!selWs){setCreateMsg("❌ Sin workspace");return;}
    setCreating(true);setCreateMsg("");
    try{
      const name=(activeBrief?`[${activeBrief.cliente}] `:"")+( parsed?.resumen?.slice(0,50)||"Proyecto Aldea");
      const proj=await createProj(selWs,name); let n=0;
      for(const t of parsed?.tareas||[]){
        const m=members.find(x=>x.name.toLowerCase().includes((t.responsable||"").toLowerCase().split(" ")[0]));
        await createTask(proj.gid,{name:t.nombre,notes:`Prioridad: ${t.prioridad||"media"}\nDeadline: ${t.deadline||"TBD"}\n${t.notas||""}`,assigneeGid:m?.gid||null});n++;
      }
      setCreateMsg(`✓ "${name}" creado con ${n} tareas en Asana`);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"proyectos",action:`Asana: ${name}`});
      const updated=await getProjs(selWs);setProjects(updated||[]);setSelProject(proj.gid);
    }catch(e){setCreateMsg("❌ "+e.message);}
    setCreating(false);
  };
  const TMPL=["Lanzamiento de campaña para cliente nuevo, 3 semanas","Entrega de identidad de marca: logo, paleta, tipografía","Producción de 20 posts mensuales para redes","Pitch para prospecto: presentación + propuesta"];
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="📋" title="Proyectos & Asana" sub="El agente divide el proyecto en tareas y las crea en Asana"
        right={<div style={{display:"flex",gap:5}}>
          <button onClick={()=>setView("chat")} style={{...btnS,fontSize:12,padding:"5px 10px",background:view==="chat"?"var(--border2)":"var(--card)"}}>💬 Agente</button>
          <button onClick={()=>setView("asana")} style={{...btnS,fontSize:12,padding:"5px 10px",background:view==="asana"?"var(--border2)":"var(--card)"}}>🔗 Asana</button>
        </div>}
      />
      <BriefBar briefs={briefs} activeBrief={activeBrief} onSelect={onSelectBrief}/>
      {view==="asana"?(
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Workspace</label>
            <select value={selWs} onChange={e=>setSelWs(e.target.value)} style={{...inp,marginBottom:10,appearance:"none"}}>{ws.map(w=><option key={w.gid} value={w.gid}>{w.name}</option>)}</select>
            <label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Proyecto</label>
            <select value={selProject} onChange={e=>setSelProject(e.target.value)} style={{...inp,appearance:"none"}}><option value="">— Seleccioná un proyecto —</option>{projects.map(p=><option key={p.gid} value={p.gid}>{p.name}</option>)}</select>
          </div>
          {asanaLoad?<div style={{display:"flex",gap:8,color:"var(--muted)",padding:16,alignItems:"center"}}><Spin/>Cargando tareas...</div>
          :selProject&&tasks.length>0?tasks.map(t=>(
            <div key={t.gid} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 12px",marginBottom:5,display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:13,height:13,borderRadius:"50%",border:"2px solid",borderColor:t.completed?"var(--green)":"var(--border2)",background:t.completed?"var(--green)":"transparent",flexShrink:0}}/>
              <div style={{flex:1}}><div style={{fontSize:13,color:t.completed?"var(--muted)":"var(--text)",textDecoration:t.completed?"line-through":"none"}}>{t.name}</div>{t.assignee&&<div style={{fontSize:11,color:"var(--muted2)"}}>{t.assignee.name}</div>}</div>
              {t.due_on&&<div style={{fontSize:11,color:"var(--amber)"}}>{t.due_on}</div>}
            </div>
          )):<div style={{textAlign:"center",padding:"40px 20px",color:"var(--muted)",fontSize:13}}>{selProject?"Sin tareas.":"Seleccioná un proyecto."}</div>}
        </div>
      ):(
        <>
          {msgs.length===0&&<div style={{marginBottom:10}}><div style={{fontSize:11,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>Ejemplos</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{TMPL.map((t,i)=><button key={i} onClick={()=>setInput(t)} style={{...btnS,fontSize:12,padding:"5px 10px"}}>{t}</button>)}</div></div>}
          <div style={{flex:1,overflowY:"auto",minHeight:120,maxHeight:240,paddingBottom:8}}>
            {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
            {loading&&<Typing/>}<div ref={bottom}/>
          </div>
          {parsed&&<div className="fu" style={{background:"#b8ff5712",border:"1px solid #b8ff5730",borderRadius:10,padding:12,margin:"8px 0"}}>
            <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>✦ {parsed.tareas?.length||0} tareas</div>
            <div style={{marginBottom:8,maxHeight:100,overflowY:"auto"}}>{(parsed.tareas||[]).map((t,i)=><div key={i} style={{display:"flex",gap:7,marginBottom:3,fontSize:12.5}}><span style={{color:t.prioridad==="alta"?"var(--red)":t.prioridad==="media"?"var(--amber)":"var(--green)",flexShrink:0}}>{t.prioridad==="alta"?"🔴":t.prioridad==="media"?"🟡":"🟢"}</span><span style={{flex:1}}>{t.nombre}</span><span style={{color:"var(--muted2)",flexShrink:0}}>→ {t.responsable}</span></div>)}</div>
            {parsed.riesgos&&<div style={{fontSize:12,color:"var(--amber)",marginBottom:8}}>⚠️ {parsed.riesgos}</div>}
            {createMsg?<div style={{fontSize:13,color:createMsg.startsWith("✓")?"var(--green)":"var(--red)"}}>{createMsg}</div>:(
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <select value={selWs} onChange={e=>setSelWs(e.target.value)} style={{...inp,width:"auto",fontSize:12,padding:"5px 9px",appearance:"none"}}>{ws.map(w=><option key={w.gid} value={w.gid}>{w.name}</option>)}</select>
                <button onClick={createInAsana} disabled={creating||!selWs} style={{...btnP(),padding:"7px 12px",fontSize:13,display:"flex",alignItems:"center",gap:5,opacity:creating?.6:1}}>{creating?<><Spin/>Creando...</>:"🚀 Crear en Asana"}</button>
              </div>
            )}
          </div>}
          <div style={{display:"flex",gap:8,paddingTop:10,borderTop:"1px solid var(--border)"}}>
            <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Describí el proyecto..." style={{...inp,flex:1}} onKeyDown={e=>e.key==="Enter"&&send()}/>
            <button onClick={send} disabled={loading||!input.trim()} style={{...btnP(),padding:"11px 18px",opacity:(!input.trim()||loading)?.35:1}}>{loading?"...":"→"}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── ESTRATEGIA ────────────────────────────────────────────────────────────────
function EstrategiaModule({user,briefs,activeBrief,onSelectBrief}){
  const [input,setInput]=useState(""); const [msgs,setMsgs]=useState([]); const [loading,setLoading]=useState(false);
  const bottom=useRef();
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  const PROMPTS=["Analizá el brief activo y proponé territorios creativos","Marca de ropa sustentable quiere crecer en Instagram","Restaurante nuevo busca diferenciarse en Palermo","App de delivery vs PedidosYa y Rappi"];
  const send=async(txt)=>{
    const msg=(txt||input).trim(); if(!msg||loading) return; setInput("");
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try{
      const r=await callClaude(user.apiKey,SYS_EST(user.role,user.name,activeBrief),msg,msgs.map(m=>({role:m.role,content:m.text})));
      setMsgs(p=>[...p,{role:"assistant",text:r}]);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"estrategia",action:msg.slice(0,60)});
    }catch(e){setMsgs(p=>[...p,{role:"assistant",text:"❌ "+e.message}]);}
    setLoading(false);
  };
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="💡" title="Estrategia & Brainstorming" sub="Insight estratégico y territorios creativos con contexto del brief"/>
      <BriefBar briefs={briefs} activeBrief={activeBrief} onSelect={onSelectBrief}/>
      {msgs.length===0&&<div style={{marginBottom:10}}><div style={{fontSize:11,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>Ejemplos</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{PROMPTS.map((p,i)=><button key={i} onClick={()=>send(p)} style={{...btnS,fontSize:12,padding:"5px 10px",maxWidth:280}}>{p}</button>)}</div></div>}
      <div style={{flex:1,overflowY:"auto",minHeight:220,maxHeight:340,paddingBottom:8}}>
        {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
        {loading&&<Typing/>}<div ref={bottom}/>
      </div>
      <div style={{display:"flex",gap:8,paddingTop:10,borderTop:"1px solid var(--border)"}}>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Describí el desafío o pedí análisis del brief activo..." style={{...inp,flex:1}} onKeyDown={e=>e.key==="Enter"&&send()}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{...btnP(),padding:"11px 18px",opacity:(!input.trim()||loading)?.35:1}}>{loading?"...":"→"}</button>
      </div>
    </div>
  );
}

// ── CAMPAÑAS ──────────────────────────────────────────────────────────────────
function CampanasModule({user,briefs,activeBrief,onSelectBrief}){
  const FIELDS=[{key:"marca",label:"¿Para qué marca o cliente?",ph:"Ej: Café Oculto"},{key:"producto",label:"¿Qué se comunica?",ph:"Ej: Lanzamiento"},{key:"objetivo",label:"¿Cuál es el objetivo?",ph:"Ej: Awareness + ventas"},{key:"target",label:"¿Quién es el público?",ph:"Ej: Adultos 28-45"},{key:"budget",label:"¿Presupuesto aproximado?",ph:"Ej: USD 5.000/mes"},{key:"canales",label:"¿Qué canales tienen?",ph:"Ej: Instagram, TikTok, Google"}];
  const [step,setStep]=useState(0); const [brief,setBrief]=useState({}); const [result,setResult]=useState(""); const [loading,setLoading]=useState(false); const [saved,setSaved]=useState(false); const [fromBrief,setFromBrief]=useState(false);

  useEffect(()=>{
    if(activeBrief&&!fromBrief&&step===0&&!result){
      setBrief({marca:activeBrief.cliente||"",producto:activeBrief.producto||"",objetivo:activeBrief.objetivo||"",target:activeBrief.target||"",budget:activeBrief.presupuesto||"",canales:activeBrief.canales||""});
      setFromBrief(true);
    }
  },[activeBrief]);

  const next=async()=>{
    if(step<FIELDS.length-1){setStep(s=>s+1);return;}
    setLoading(true);
    const txt=FIELDS.map(f=>`${f.key.toUpperCase()}: ${brief[f.key]||"No especificado"}`).join("\n");
    try{
      const r=await callClaude(user.apiKey,SYS_CAMP(user.role,user.name,activeBrief),`Brief:\n\n${txt}`);
      setResult(r); await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"campanas",action:`Campaña: ${brief.marca||"sin nombre"}`});
    }catch(e){setResult("❌ "+e.message);}
    setLoading(false);
  };

  const reset=()=>{setStep(0);setBrief({});setResult("");setSaved(false);setFromBrief(false);};

  if(loading) return <div style={{display:"flex",flexDirection:"column",flex:1,alignItems:"center",justifyContent:"center",gap:14}}><div style={{fontSize:34,animation:"spin 2.5s linear infinite"}}>✦</div><div style={{color:"var(--muted2)",fontSize:14}}>Generando campaña 360...</div></div>;
  if(result) return(
    <div style={{display:"flex",flexDirection:"column",flex:1}} className="fu">
      <MH icon="🎨" title="Campañas 360" sub={`Campaña para ${brief.marca||"tu cliente"}`}
        right={<div style={{display:"flex",gap:7}}>
          <button onClick={async()=>{await saveConv(user.id,"campanas",[{role:"user",text:FIELDS.map(f=>`${f.key}: ${brief[f.key]||""}`).join("\n")},{role:"assistant",text:result}],{title:`Campaña: ${brief.marca||"Sin nombre"}`,userName:user.name});setSaved(true);setTimeout(()=>setSaved(false),2500);}} disabled={saved} style={{...btnS,fontSize:12,padding:"5px 11px"}}>{saved?"✓ Guardada":"💾 Guardar"}</button>
          <button onClick={reset} style={{...btnS,fontSize:12,padding:"5px 11px"}}>+ Nueva</button>
        </div>}
      />
      <div style={{flex:1,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:20,fontSize:13.5,lineHeight:1.78,whiteSpace:"pre-wrap",overflowY:"auto",maxHeight:460}}>{result}</div>
    </div>
  );

  const f=FIELDS[step];
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="🎨" title="Generador de Campañas" sub="6 preguntas → campaña 360 completa"/>
      <BriefBar briefs={briefs} activeBrief={activeBrief} onSelect={onSelectBrief}/>
      {activeBrief&&fromBrief&&<div style={{fontSize:12,color:"var(--green)",marginBottom:10}}>✓ Datos pre-cargados desde el brief de {activeBrief.cliente}</div>}
      <div style={{display:"flex",gap:4,marginBottom:18}}>{FIELDS.map((_,i)=><div key={i} style={{height:3,flex:1,borderRadius:2,background:i<=step?"var(--accent)":"var(--border2)",transition:"background .3s"}}/>)}</div>
      <div className="fu" key={step}>
        <div style={{fontSize:11,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>Paso {step+1} / {FIELDS.length}</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:19,fontWeight:700,marginBottom:14}}>{f.label}</div>
        <input key={step} value={brief[f.key]||""} onChange={e=>setBrief(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph} style={{...inp,marginBottom:14,fontSize:15}} onKeyDown={e=>e.key==="Enter"&&next()} autoFocus/>
        <div style={{display:"flex",gap:8}}>{step>0&&<button onClick={()=>setStep(s=>s-1)} style={btnS}>← Atrás</button>}<button onClick={next} style={{...btnP(),padding:"11px 22px"}}>{step===FIELDS.length-1?"Generar campaña ✦":"Siguiente →"}</button></div>
      </div>
    </div>
  );
}

// ── EQUIPO ────────────────────────────────────────────────────────────────────
function EquipoModule({user}){
  const [dbUsers,setDbUsers]=useState([]); const [asanaM,setAsanaM]=useState([]); const [activity,setActivity]=useState([]); const [tab,setTab]=useState("miembros"); const [loading,setLoading]=useState(true);
  const isDir=user.role==="director";
  useEffect(()=>{(async()=>{setLoading(true);try{const [u,w]=await Promise.all([getAllUsers(),getWS()]);setDbUsers(u||[]);if(w&&w.length){const m=await getMembers(w[0].gid);setAsanaM(m||[]);}if(isDir){const a=await getDocs(query(collection(db,"activity"),orderBy("ts","desc"),limit(60)));setActivity(a.docs.map(d=>({id:d.id,...d.data()})));}}catch(e){}setLoading(false);})();},[isDir]);
  const fmtTs=ts=>{if(!ts)return"";const d=ts.toDate?ts.toDate():new Date(ts);const s=Math.floor((Date.now()-d.getTime())/1e3);if(s<60)return"ahora";if(s<3600)return`hace ${Math.floor(s/60)}m`;if(s<86400)return`hace ${Math.floor(s/3600)}h`;return`hace ${Math.floor(s/86400)}d`;};
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="👥" title="Equipo Aldea" sub="Miembros, áreas y actividad en tiempo real"/>
      <div style={{display:"flex",gap:6,marginBottom:14,alignItems:"center"}}>
        {["miembros","asana",...(isDir?["actividad"]:[])].map(t=><button key={t} onClick={()=>setTab(t)} style={{...btnS,fontSize:12,padding:"5px 12px",background:tab===t?"var(--border2)":"var(--card)",color:tab===t?"var(--text)":"var(--muted)"}}>{t==="miembros"?"👤 Equipo":t==="asana"?"🔗 Asana":"📊 Actividad"}</button>)}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 2s infinite"}}/>{dbUsers.length} miembro{dbUsers.length!==1?"s":""}</span>
      </div>
      {loading?<div style={{display:"flex",gap:8,color:"var(--muted)",padding:16,alignItems:"center"}}><Spin/>Cargando...</div>
      :tab==="miembros"?(<div style={{flex:1,overflowY:"auto",maxHeight:420}}>{dbUsers.length===0?<div style={{textAlign:"center",padding:40,color:"var(--muted)",fontSize:13}}>No hay miembros todavía.</div>:dbUsers.map(u=>{const r=ROLES[u.role];const ar=AREAS[u.area];return(<div key={u.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",marginBottom:6,display:"flex",alignItems:"center",gap:12}}><div style={{width:36,height:36,borderRadius:"50%",background:(r?.color||"var(--muted)")+"22",border:`1px solid ${r?.color||"var(--muted)"}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{r?.icon||"?"}</div><div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,fontSize:13.5,marginBottom:4}}>{u.name}{u.id===user.id&&<span style={{fontSize:10,color:"var(--muted)",marginLeft:6}}>(vos)</span>}</div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}><Tag color={r?.color||"var(--muted)"}>{r?.label||u.role}</Tag>{u.area&&ar&&<Tag color={ar.color}>{ar.icon} {u.area}</Tag>}</div></div></div>);})}</div>)
      :tab==="asana"?(<div style={{flex:1,overflowY:"auto",maxHeight:420}}><div style={{fontSize:11,color:"var(--muted)",marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>{asanaM.length} en Asana</div>{asanaM.map(m=>(<div key={m.gid} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"9px 12px",marginBottom:5,display:"flex",alignItems:"center",gap:10}}><div style={{width:30,height:30,borderRadius:"50%",background:"var(--border2)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"var(--accent)"}}>{m.name?m.name[0].toUpperCase():"?"}</div><div style={{flex:1}}><div style={{fontSize:13,fontWeight:500}}>{m.name}</div><div style={{fontSize:11,color:"var(--muted2)"}}>{m.email}</div></div><div style={{width:7,height:7,borderRadius:"50%",background:"var(--green)",animation:"pulse 2s infinite"}}/></div>))}</div>)
      :(<div style={{flex:1,overflowY:"auto",maxHeight:420}}>{activity.length===0?<div style={{textAlign:"center",padding:40,color:"var(--muted)",fontSize:13}}>Sin actividad todavía.</div>:activity.map((a,i)=>{const r=ROLES[a.userRole];return(<div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 11px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,marginBottom:5}}><div style={{width:24,height:24,borderRadius:"50%",background:(r?.color||"var(--muted)")+"22",flexShrink:0,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}>{r?.icon||"?"}</div><div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,marginBottom:1}}><strong style={{color:r?.color||"var(--text)"}}>{a.userName}</strong> <span style={{color:"var(--muted2)"}}>en</span> <span style={{color:MC[a.module]||"var(--muted)"}}>{ML[a.module]||a.module}</span></div><div style={{fontSize:11.5,color:"var(--muted2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.action}</div></div><div style={{fontSize:11,color:"var(--muted)",flexShrink:0}}>{fmtTs(a.ts)}</div></div>);})}</div>)}
    </div>
  );
}

// ── HISTORIAL ─────────────────────────────────────────────────────────────────
function HistorialModule({user}){
  const [convs,setConvs]=useState([]); const [loading,setLoading]=useState(true); const [selected,setSelected]=useState(null); const [filter,setFilter]=useState("todos");
  const isDir=user.role==="director";
  useEffect(()=>{(async()=>{setLoading(true);const all=isDir?await getAllConvs():(await getAllConvs()).filter(c=>c.userId===user.id);setConvs(all||[]);setLoading(false);})();},[user.id,isDir]);
  const filtered=filter==="todos"?convs:convs.filter(c=>c.moduleId===filter);
  const fmt=ts=>{if(!ts)return"";const d=ts.toDate?ts.toDate():new Date(ts);return d.toLocaleDateString("es-AR",{day:"2-digit",month:"short"});};
  if(selected) return(<div style={{display:"flex",flexDirection:"column",flex:1}}><MH icon="🗂" title={selected.title||"Conversación"} sub={ML[selected.moduleId]||selected.moduleId} right={<button onClick={()=>setSelected(null)} style={{...btnS,fontSize:12,padding:"5px 11px"}}>← Volver</button>}/><div style={{flex:1,overflowY:"auto",maxHeight:480}}>{(selected.messages||[]).map((m,i)=><Bubble key={i} {...m}/>)}</div></div>);
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="🗂" title="Historial" sub={isDir?"Todo el historial del equipo":"Tus conversaciones guardadas"}/>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>{["todos","briefs","email","proyectos","estrategia","campanas"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{...btnS,fontSize:11,padding:"4px 10px",background:filter===f?"var(--border2)":"var(--card)",color:filter===f?"var(--text)":"var(--muted)"}}>{f==="todos"?"Todos":ML[f]||f}</button>)}</div>
      {loading?<div style={{display:"flex",gap:8,color:"var(--muted)",padding:16,alignItems:"center"}}><Spin/>Cargando...</div>
      :filtered.length===0?<div style={{textAlign:"center",padding:"40px 20px",color:"var(--muted)",fontSize:13}}>No hay conversaciones todavía.</div>
      :<div style={{flex:1,overflowY:"auto",maxHeight:420}}>{filtered.map(c=>(<div key={c.id} onClick={()=>setSelected(c)} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"10px 13px",cursor:"pointer",marginBottom:5,transition:"border .2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}><div style={{display:"flex",justifyContent:"space-between",gap:10}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:500,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title||"Sin título"}</div><div style={{display:"flex",gap:6}}><Tag color={MC[c.moduleId]||"var(--muted)"}>{ML[c.moduleId]||c.moduleId}</Tag>{isDir&&c.userName&&<span style={{fontSize:11,color:"var(--muted2)"}}>{c.userName}</span>}</div></div><div style={{fontSize:11,color:"var(--muted)",flexShrink:0,textAlign:"right"}}>{fmt(c.savedAt)}<br/>{(c.messages||[]).length} msgs</div></div></div>))}</div>}
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]=useState(null); const [tab,setTab]=useState(null);
  const [briefs,setBriefs]=useState([]); const [activeBrief,setActiveBrief]=useState(null);
  const [briefMsg,setBriefMsg]=useState("");

  useEffect(()=>{if(user) getAllBriefs().then(b=>setBriefs(b||[])).catch(()=>{});},[user]);

  const enter=u=>{setUser(u);setTab(ROLES[u.role]?.tabs[0]||"briefs");};

  const handleActivate=b=>{
    setActiveBrief(b);
    setBriefMsg(`⚡ Brief de ${b.cliente} activado en todos los módulos`);
    setTimeout(()=>setBriefMsg(""),3000);
  };

  if(!user) return <><GlobalStyles/><Setup onEnter={enter}/></>;
  const role=ROLES[user.role];
  const tabs=ALL_TABS.filter(t=>role?.tabs.includes(t.id));

  return(
    <>
      <GlobalStyles/>
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:"var(--bg)"}}>
        <header style={{height:52,borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 22px",background:"var(--surface)",position:"sticky",top:0,zIndex:50}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:"var(--accent)",boxShadow:"0 0 8px var(--accent)",animation:"pulse 2s infinite"}}/>
            <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,letterSpacing:"-.025em"}}><span style={{color:"var(--accent)"}}>Aldea</span> <span style={{color:"var(--muted2)",fontWeight:400}}>Creative</span> Hub</span>
            {activeBrief&&<span style={{fontSize:11,color:"var(--accent)",background:"var(--accent)15",border:"1px solid var(--accent)30",borderRadius:4,padding:"2px 8px"}}>📁 {activeBrief.cliente}</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Tag color={role?.color}>{role?.icon} {role?.label}</Tag>
            <span style={{fontSize:13,color:"var(--muted2)"}}>{user.name}</span>
            <button onClick={()=>setUser(null)} style={{...btnS,padding:"5px 12px",fontSize:12}}>Salir</button>
          </div>
        </header>

        {briefMsg&&<div style={{background:"var(--accent)15",borderBottom:"1px solid var(--accent)30",padding:"8px 22px",fontSize:12.5,color:"var(--accent)",textAlign:"center"}}>{briefMsg}</div>}

        <nav style={{display:"flex",borderBottom:"1px solid var(--border)",background:"var(--surface)",padding:"0 18px",gap:2,overflowX:"auto"}}>
          {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"12px 13px",background:"none",border:"none",borderBottom:tab===t.id?"2px solid var(--accent)":"2px solid transparent",color:tab===t.id?"var(--text)":"var(--muted)",fontSize:13,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}><span>{t.icon}</span><span>{t.label}</span></button>)}
        </nav>

        <main key={tab} className="fu" style={{flex:1,padding:24,maxWidth:860,width:"100%",margin:"0 auto",display:"flex",flexDirection:"column"}}>
          {tab==="briefs"     &&<BriefsModule     user={user} briefs={briefs} onBriefsUpdate={setBriefs} onActivate={handleActivate}/>}
          {tab==="email"      &&<EmailModule      user={user} briefs={briefs} activeBrief={activeBrief} onSelectBrief={setActiveBrief}/>}
          {tab==="proyectos"  &&<ProyectosModule  user={user} briefs={briefs} activeBrief={activeBrief} onSelectBrief={setActiveBrief}/>}
          {tab==="estrategia" &&<EstrategiaModule user={user} briefs={briefs} activeBrief={activeBrief} onSelectBrief={setActiveBrief}/>}
          {tab==="campanas"   &&<CampanasModule   user={user} briefs={briefs} activeBrief={activeBrief} onSelectBrief={setActiveBrief}/>}
          {tab==="equipo"     &&<EquipoModule     user={user}/>}
          {tab==="historial"  &&<HistorialModule  user={user}/>}
        </main>
      </div>
    </>
  );
}
