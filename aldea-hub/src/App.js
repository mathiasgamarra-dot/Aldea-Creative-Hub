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

async function callClaude(apiKey, system, userMsg, history = []) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:1500,system,messages:[...history,{role:"user",content:userMsg}]}),
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message||`HTTP ${res.status}`); }
  return (await res.json()).content[0]?.text || "";
}

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

const saveUser = async u => { const {pass,...s}=u; await setDoc(doc(db,"users",u.id),{...s,updatedAt:serverTimestamp()}); };
const getAllUsers = async () => { try{const s=await getDocs(collection(db,"users"));return s.docs.map(d=>d.data());}catch{return[];} };
const logAct = async e => { try{await addDoc(collection(db,"activity"),{...e,ts:serverTimestamp()});}catch{} };
const saveConv = async (uid,mod,msgs,meta={}) => { try{await setDoc(doc(db,"conversations",`${uid}_${mod}_${Date.now()}`),{userId:uid,moduleId:mod,messages:msgs,...meta,savedAt:serverTimestamp()});}catch{} };
const getAllConvs = async () => { try{const s=await getDocs(query(collection(db,"conversations"),orderBy("savedAt","desc"),limit(200)));return s.docs.map(d=>({id:d.id,...d.data()}));}catch{return[];} };

const getLocal = () => { try{return JSON.parse(localStorage.getItem("aldea_u")||"{}");}catch{return{};} };
const saveLocal = u => { const d=getLocal(); d[u.id]=u; localStorage.setItem("aldea_u",JSON.stringify(d)); };
const findLocal = (n,p) => Object.values(getLocal()).find(u=>u.name.toLowerCase()===n.toLowerCase()&&u.pass===p);

const ROLES = {
  director:  {label:"Director / Dueño",   color:"var(--accent)",icon:"◆",tabs:["email","proyectos","estrategia","campanas","equipo","historial"]},
  creativo:  {label:"Director Creativo",  color:"var(--purple)",icon:"✦",tabs:["estrategia","campanas","email","historial"]},
  cuentas:   {label:"Ejecutivo de Cuentas",color:"var(--blue)", icon:"◉",tabs:["email","proyectos","campanas","historial"]},
  produccion:{label:"Producción / Social",color:"var(--pink)",  icon:"◈",tabs:["proyectos","campanas","historial"]},
};
const AREAS = {
  "Diseño / Creatividad":{color:"var(--purple)",icon:"🎨"},
  "Estrategia":          {color:"var(--amber)", icon:"💡"},
  "Producción / Social": {color:"var(--pink)",  icon:"📱"},
  "Cuentas / Comercial": {color:"var(--blue)",  icon:"💼"},
  "Administración":      {color:"var(--green)", icon:"⚙️"},
};
const ALL_TABS=[{id:"email",icon:"✉️",label:"Email"},{id:"proyectos",icon:"📋",label:"Proyectos"},{id:"estrategia",icon:"💡",label:"Estrategia"},{id:"campanas",icon:"🎨",label:"Campañas"},{id:"equipo",icon:"👥",label:"Equipo"},{id:"historial",icon:"🗂",label:"Historial"}];
const MC={email:"var(--blue)",proyectos:"var(--amber)",estrategia:"var(--purple)",campanas:"var(--pink)",sistema:"var(--muted2)"};
const ML={email:"Email",proyectos:"Proyectos",estrategia:"Estrategia",campanas:"Campañas",sistema:"Sistema"};

const BASE=(r,n)=>`Sos el agente de Aldea Creative Hub, agencia 360 argentina. Hablás en español rioplatense con ${n} (${ROLES[r]?.label}). Sos estratégico, creativo y directo.`;
const SYS_EMAIL=(r,n)=>`${BASE(r,n)}\nMÓDULO EMAIL. Respondé SIEMPRE:\n---CLASIFICACIÓN---\nTipo: [Cliente/Proveedor/Prospecto/Interno/Spam]\nUrgencia: [Alta/Media/Baja]\nResumen: [1 oración]\n---BORRADOR---\n[email completo]\n---ASUNTO SUGERIDO---\n[asunto]\n---ACCIÓN ASANA---\n[tarea o No aplica]`;
const SYS_PROY=(r,n,team)=>`${BASE(r,n)}\nEquipo:\n${team.map(m=>`- ${m.name} (${m.area||"Sin área"})`).join("\n")}\n\nRespondé SOLO con JSON sin markdown:\n{"resumen":"...","tareas":[{"nombre":"...","responsable":"nombre","prioridad":"alta|media|baja","deadline":"X días","notas":"..."}],"riesgos":"...","arranque":"..."}`;
const SYS_EST=(r,n)=>`${BASE(r,n)}\nMÓDULO ESTRATEGIA: insight central + 3 territorios creativos distintos (nombre+concepto+ejemplo) + pregunta estratégica clave.`;
const SYS_CAMP=(r,n)=>`${BASE(r,n)}\nCAMPAÑAS 360:\n**CONCEPTO**: nombre/idea/tagline\n**PIEZAS** (4 formatos): formato·copy principal·copy secundario·dir de arte\n**PLAN DE MEDIOS**: canales+%\n**KPIs**: 3 métricas`;

const inp={width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 14px",color:"var(--text)",fontSize:14,outline:"none"};
const btnP=(c="var(--accent)")=>({background:c,color:c==="var(--accent)"?"#09090b":"#fff",border:"none",borderRadius:8,padding:"10px 20px",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13.5,cursor:"pointer"});
const btnS={background:"var(--card)",color:"var(--text)",border:"1px solid var(--border2)",borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer"};

function Tag({color,children}){return <span style={{background:color+"20",color,border:`1px solid ${color}44`,borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:600}}>{children}</span>;}
function Typing(){return <div style={{display:"flex",gap:5,padding:"10px 4px"}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",animation:`blink 1.2s ${i*.2}s infinite`}}/>)}</div>;}
function Spin(){return <div style={{width:16,height:16,border:"2px solid var(--border2)",borderTop:"2px solid var(--accent)",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>;}
function Bubble({role:r,text}){const a=r==="assistant";return <div className="fu" style={{display:"flex",justifyContent:a?"flex-start":"flex-end",marginBottom:10}}><div style={{maxWidth:"82%",background:a?"var(--card)":"var(--accent)",color:a?"var(--text)":"#09090b",border:a?"1px solid var(--border)":"none",borderRadius:a?"4px 14px 14px 14px":"14px 4px 14px 14px",padding:"11px 15px",fontSize:13.5,lineHeight:1.68,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{text}</div></div>;}
function MH({icon,title,sub,right}){return <div style={{marginBottom:16,paddingBottom:14,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,marginBottom:3}}>{icon} {title}</div><div style={{fontSize:12.5,color:"var(--muted2)"}}>{sub}</div></div>{right}</div>;}

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

function EmailModule({user}){
  const [input,setInput]=useState(""); const [msgs,setMsgs]=useState([]); const [loading,setLoading]=useState(false);
  const [draft,setDraft]=useState(null); const [approved,setApproved]=useState(false); const [copied,setCopied]=useState(false);
  const bottom=useRef();
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  const send=async()=>{
    const msg=input.trim(); if(!msg||loading) return;
    setInput(""); setDraft(null); setApproved(false); setCopied(false);
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try{
      const r=await callClaude(user.apiKey,SYS_EMAIL(user.role,user.name),msg,msgs.map(m=>({role:m.role,content:m.text})));
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
      <div style={{flex:1,overflowY:"auto",minHeight:240,maxHeight:340,paddingBottom:8}}>
        {msgs.length===0&&<div style={{textAlign:"center",padding:"50px 20px",color:"var(--muted)"}}><div style={{fontSize:30,marginBottom:8}}>✉️</div><div style={{fontSize:13}}>Pegá el email que recibiste</div></div>}
        {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
        {loading&&<Typing/>}<div ref={bottom}/>
      </div>
      {draft&&!approved&&<div className="fu" style={{background:"#b8ff5712",border:"1px solid #b8ff5730",borderRadius:10,padding:13,margin:"8px 0"}}>
        <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>¿Aprobás el borrador?</div>
        <div style={{fontSize:12.5,color:"var(--muted2)",marginBottom:9}}>Asunto: <strong style={{color:"var(--text)"}}>{draft.subject}</strong></div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>{try{navigator.clipboard.writeText(`Asunto: ${draft.subject}\n\n${draft.body}`);}catch(e){}setCopied(true);setApproved(true);setTimeout(()=>setCopied(false),2500);}} style={{...btnP(),padding:"8px 16px",fontSize:13}}>✓ Aprobar y copiar</button>
          <button onClick={()=>{setDraft(null);setInput("Reescribí con tono más formal");}} style={{...btnS,fontSize:13}}>↺ Reescribir</button>
        </div>
      </div>}
      {approved&&<div className="fu" style={{background:"#4dffc310",border:"1px solid #4dffc330",borderRadius:8,padding:"8px 13px",margin:"8px 0",fontSize:13,color:"var(--green)"}}>{copied?"✓ Copiado — pegalo en Gmail":"✓ Borrador aprobado"}</div>}
      <div style={{display:"flex",gap:8,paddingTop:11,borderTop:"1px solid var(--border)",alignItems:"flex-end"}}>
        <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="Pegá el email que recibiste..." rows={3} style={{...inp,flex:1}} onKeyDown={e=>{if(e.key==="Enter"&&e.metaKey)send();}}/>
        <button onClick={send} disabled={loading||!input.trim()} style={{...btnP(),padding:"11px 18px",opacity:(!input.trim()||loading)?.35:1}}>{loading?"...":"→"}</button>
      </div>
    </div>
  );
}

function ProyectosModule({user}){
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
      try{
        const w=await getWS(); setWs(w||[]);
        if(w&&w.length){
          setSelWs(w[0].gid);
          const [p,m]=await Promise.all([getProjs(w[0].gid),getMembers(w[0].gid)]);
          setProjects(p||[]); setMembers(m||[]);
        }
      }catch(e){console.error("Asana:",e.message);}
      getAllUsers().then(u=>setDbUsers(u||[])).catch(()=>{});
    })();
  },[]);

  useEffect(()=>{
    if(!selProject) return;
    setAsanaLoad(true);
    getTasks(selProject).then(t=>{setTasks(t||[]);setAsanaLoad(false);}).catch(()=>setAsanaLoad(false));
  },[selProject]);

  const team=dbUsers.length?dbUsers.map(u=>({name:u.name,area:u.area||"Sin área"})):members.map(m=>({name:m.name,area:"Asana"}));

  const send=async()=>{
    const msg=input.trim(); if(!msg||loading) return;
    setInput(""); setParsed(null); setCreateMsg("");
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try{
      const r=await callClaude(user.apiKey,SYS_PROY(user.role,user.name,team),msg,msgs.map(m=>({role:m.role,content:m.text})));
      setMsgs(p=>[...p,{role:"assistant",text:r}]);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"proyectos",action:msg.slice(0,60)});
      try{const j=JSON.parse(r.replace(/```json|```/g,"").trim());setParsed(j);}catch(e){}
    }catch(e){setMsgs(p=>[...p,{role:"assistant",text:"❌ "+e.message}]);}
    setLoading(false);
  };

  const createInAsana=async()=>{
    if(!selWs){setCreateMsg("❌ No hay workspace disponible");return;}
    setCreating(true); setCreateMsg("");
    try{
      const name=parsed?.resumen?.slice(0,60)||"Proyecto Aldea "+new Date().toLocaleDateString("es-AR");
      const proj=await createProj(selWs,name);
      let n=0;
      for(const t of parsed?.tareas||[]){
        const m=members.find(x=>x.name.toLowerCase().includes((t.responsable||"").toLowerCase().split(" ")[0]));
        await createTask(proj.gid,{name:t.nombre,notes:`Prioridad: ${t.prioridad||"media"}\nDeadline: ${t.deadline||"TBD"}\n${t.notas||""}`,assigneeGid:m?.gid||null});
        n++;
      }
      setCreateMsg(`✓ Proyecto "${name}" creado con ${n} tareas en Asana`);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"proyectos",action:`Asana: ${name}`});
      const updated=await getProjs(selWs); setProjects(updated||[]); setSelProject(proj.gid);
    }catch(e){setCreateMsg("❌ "+e.message);}
    setCreating(false);
  };

  const TMPL=["Lanzamiento de campaña para cliente nuevo, 3 semanas","Entrega de identidad de marca: logo, paleta, tipografía","Producción de 20 posts mensuales para redes","Pitch para prospecto: presentación + propuesta económica"];

  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="📋" title="Proyectos & Asana" sub="El agente divide el proyecto en tareas y las crea automáticamente en Asana"
        right={<div style={{display:"flex",gap:5}}>
          <button onClick={()=>setView("chat")} style={{...btnS,fontSize:12,padding:"5px 10px",background:view==="chat"?"var(--border2)":"var(--card)"}}>💬 Agente</button>
          <button onClick={()=>setView("asana")} style={{...btnS,fontSize:12,padding:"5px 10px",background:view==="asana"?"var(--border2)":"var(--card)"}}>🔗 Ver Asana</button>
        </div>}
      />
      {view==="asana"?(
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Workspace</label>
            <select value={selWs} onChange={e=>setSelWs(e.target.value)} style={{...inp,marginBottom:10,appearance:"none"}}>{ws.map(w=><option key={w.gid} value={w.gid}>{w.name}</option>)}</select>
            <label style={{fontSize:11,color:"var(--muted2)",display:"block",marginBottom:5,textTransform:"uppercase",letterSpacing:".08em"}}>Proyecto</label>
            <select value={selProject} onChange={e=>setSelProject(e.target.value)} style={{...inp,appearance:"none"}}><option value="">— Seleccioná un proyecto —</option>{projects.map(p=><option key={p.gid} value={p.gid}>{p.name}</option>)}</select>
          </div>
          {asanaLoad?<div style={{display:"flex",gap:8,color:"var(--muted)",padding:16,alignItems:"center"}}><Spin/>Cargando tareas...</div>
          :selProject&&tasks.length>0?(
            <div>
              <div style={{fontSize:11,color:"var(--muted)",marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>{tasks.length} tareas</div>
              {tasks.map(t=>(
                <div key={t.gid} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 12px",marginBottom:5,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:13,height:13,borderRadius:"50%",border:"2px solid",borderColor:t.completed?"var(--green)":"var(--border2)",background:t.completed?"var(--green)":"transparent",flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,color:t.completed?"var(--muted)":"var(--text)",textDecoration:t.completed?"line-through":"none"}}>{t.name}</div>
                    {t.assignee&&<div style={{fontSize:11,color:"var(--muted2)"}}>{t.assignee.name}</div>}
                  </div>
                  {t.due_on&&<div style={{fontSize:11,color:"var(--amber)"}}>{t.due_on}</div>}
                </div>
              ))}
            </div>
          ):<div style={{textAlign:"center",padding:"40px 20px",color:"var(--muted)",fontSize:13}}>{selProject?"Sin tareas.":"Seleccioná un proyecto."}</div>}
        </div>
      ):(
        <>
          {msgs.length===0&&<div style={{marginBottom:12}}><div style={{fontSize:11,color:"var(--muted)",marginBottom:7,textTransform:"uppercase",letterSpacing:".08em"}}>Ejemplos</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{TMPL.map((t,i)=><button key={i} onClick={()=>setInput(t)} style={{...btnS,fontSize:12,padding:"5px 10px"}}>{t}</button>)}</div></div>}
          <div style={{flex:1,overflowY:"auto",minHeight:140,maxHeight:260,paddingBottom:8}}>
            {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
            {loading&&<Typing/>}<div ref={bottom}/>
          </div>
          {parsed&&(
            <div className="fu" style={{background:"#b8ff5712",border:"1px solid #b8ff5730",borderRadius:10,padding:13,margin:"8px 0"}}>
              <div style={{fontSize:11,color:"var(--accent)",fontWeight:700,marginBottom:7,textTransform:"uppercase",letterSpacing:".08em"}}>✦ {parsed.tareas?.length||0} tareas generadas</div>
              <div style={{marginBottom:8,maxHeight:110,overflowY:"auto"}}>
                {(parsed.tareas||[]).map((t,i)=>(
                  <div key={i} style={{display:"flex",gap:7,marginBottom:4,fontSize:12.5}}>
                    <span style={{color:t.prioridad==="alta"?"var(--red)":t.prioridad==="media"?"var(--amber)":"var(--green)",flexShrink:0}}>{t.prioridad==="alta"?"🔴":t.prioridad==="media"?"🟡":"🟢"}</span>
                    <span style={{flex:1}}>{t.nombre}</span>
                    <span style={{color:"var(--muted2)",flexShrink:0}}>→ {t.responsable}</span>
                  </div>
                ))}
              </div>
              {parsed.riesgos&&<div style={{fontSize:12,color:"var(--amber)",marginBottom:8}}>⚠️ {parsed.riesgos}</div>}
              {createMsg?<div style={{fontSize:13,color:createMsg.startsWith("✓")?"var(--green)":"var(--red)"}}>{createMsg}</div>:(
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <select value={selWs} onChange={e=>setSelWs(e.target.value)} style={{...inp,width:"auto",fontSize:12,padding:"6px 10px",appearance:"none"}}>{ws.map(w=><option key={w.gid} value={w.gid}>{w.name}</option>)}</select>
                  <button onClick={createInAsana} disabled={creating||!selWs} style={{...btnP(),padding:"8px 14px",fontSize:13,display:"flex",alignItems:"center",gap:6,opacity:creating?.6:1}}>{creating?<><Spin/>Creando...</>:"🚀 Crear en Asana"}</button>
                </div>
              )}
            </div>
          )}
          <div style={{display:"flex",gap:8,paddingTop:11,borderTop:"1px solid var(--border)"}}>
            <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Describí el proyecto..." style={{...inp,flex:1}} onKeyDown={e=>e.key==="Enter"&&send()}/>
            <button onClick={send} disabled={loading||!input.trim()} style={{...btnP(),padding:"11px 18px",opacity:(!input.trim()||loading)?.35:1}}>{loading?"...":"→"}</button>
          </div>
        </>
      )}
    </div>
  );
}

function EstrategiaModule({user}){
  const [input,setInput]=useState(""); const [msgs,setMsgs]=useState([]); const [loading,setLoading]=useState(false);
  const bottom=useRef();
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  const PROMPTS=["Marca de ropa sustentable quiere crecer en Instagram","Restaurante nuevo en Palermo busca diferenciarse","App de delivery vs PedidosYa y Rappi","ONG medioambiental: awareness para jóvenes"];
  const send=async(txt)=>{
    const msg=(txt||input).trim(); if(!msg||loading) return; setInput("");
    setMsgs(p=>[...p,{role:"user",text:msg}]); setLoading(true);
    try{
      const r=await callClaude(user.apiKey,SYS_EST(user.role,user.name),msg,msgs.map(m=>({role:m.role,content:m.text})));
      setMsgs(p=>[...p,{role:"assistant",text:r}]);
      await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"estrategia",action:msg.slice(0,60)});
    }catch(e){setMsgs(p=>[...p,{role:"assistant",text:"❌ "+e.message}]);}
    setLoading(false);
  };
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="💡" title="Estrategia & Brainstorming" sub="Describí el desafío → insight estratégico y territorios creativos"/>
      {msgs.length===0&&<div style={{marginBottom:12}}><div style={{fontSize:11,color:"var(--muted)",marginBottom:7,textTransform:"uppercase",letterSpacing:".08em"}}>Casos de ejemplo</div><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{PROMPTS.map((p,i)=><button key={i} onClick={()=>send(p)} style={{...btnS,fontSize:12,padding:"5px 10px",maxWidth:280}}>{p}</button>)}</div></div>}
      <div style={{flex:1,overflowY:"auto",minHeight:240,maxHeight:360,paddingBottom:8}}>
        {msgs.map((m,i)=><Bubble key={i} {...m}/>)}
        {loading&&<Typing/>}<div ref={bottom}/>
      </div>
      <div style={{display:"flex",gap:8,paddingTop:11,borderTop:"1px solid var(--border)"}}>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Describí el cliente o desafío..." style={{...inp,flex:1}} onKeyDown={e=>e.key==="Enter"&&send()}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{...btnP(),padding:"11px 18px",opacity:(!input.trim()||loading)?.35:1}}>{loading?"...":"→"}</button>
      </div>
    </div>
  );
}

function CampanasModule({user}){
  const FIELDS=[{key:"marca",label:"¿Para qué marca o cliente?",ph:"Ej: Café Oculto"},{key:"producto",label:"¿Qué se comunica?",ph:"Ej: Lanzamiento de café"},{key:"objetivo",label:"¿Cuál es el objetivo?",ph:"Ej: Awareness + ventas"},{key:"target",label:"¿Quién es el público?",ph:"Ej: Adultos 28-45, urbanos"},{key:"budget",label:"¿Presupuesto aproximado?",ph:"Ej: USD 5.000/mes"},{key:"canales",label:"¿Qué canales tienen?",ph:"Ej: Instagram, TikTok, Google"}];
  const [step,setStep]=useState(0); const [brief,setBrief]=useState({}); const [result,setResult]=useState(""); const [loading,setLoading]=useState(false); const [saved,setSaved]=useState(false);
  const next=async()=>{
    if(step<FIELDS.length-1){setStep(s=>s+1);return;}
    setLoading(true);
    const txt=FIELDS.map(f=>`${f.key.toUpperCase()}: ${brief[f.key]||"No especificado"}`).join("\n");
    try{
      const r=await callClaude(user.apiKey,SYS_CAMP(user.role,user.name),`Brief:\n\n${txt}`);
      setResult(r); await logAct({userId:user.id,userName:user.name,userRole:user.role,module:"campanas",action:`Campaña: ${brief.marca||"sin nombre"}`});
    }catch(e){setResult("❌ "+e.message);}
    setLoading(false);
  };
  if(loading) return <div style={{display:"flex",flexDirection:"column",flex:1,alignItems:"center",justifyContent:"center",gap:14}}><div style={{fontSize:34,animation:"spin 2.5s linear infinite"}}>✦</div><div style={{color:"var(--muted2)",fontSize:14}}>Generando campaña 360...</div></div>;
  if(result) return(
    <div style={{display:"flex",flexDirection:"column",flex:1}} className="fu">
      <MH icon="🎨" title="Campañas 360" sub={`Campaña para ${brief.marca||"tu cliente"}`}
        right={<div style={{display:"flex",gap:7}}>
          <button onClick={async()=>{await saveConv(user.id,"campanas",[{role:"user",text:FIELDS.map(f=>`${f.key}: ${brief[f.key]||""}`).join("\n")},{role:"assistant",text:result}],{title:`Campaña: ${brief.marca||"Sin nombre"}`,userName:user.name});setSaved(true);setTimeout(()=>setSaved(false),2500);}} disabled={saved} style={{...btnS,fontSize:12,padding:"5px 11px"}}>{saved?"✓ Guardada":"💾 Guardar"}</button>
          <button onClick={()=>{setStep(0);setBrief({});setResult("");setSaved(false);}} style={{...btnS,fontSize:12,padding:"5px 11px"}}>+ Nueva</button>
        </div>}
      />
      <div style={{flex:1,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:20,fontSize:13.5,lineHeight:1.78,whiteSpace:"pre-wrap",overflowY:"auto",maxHeight:480}}>{result}</div>
    </div>
  );
  const f=FIELDS[step];
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="🎨" title="Generador de Campañas" sub="6 preguntas → campaña 360 completa"/>
      <div style={{display:"flex",gap:4,marginBottom:20}}>{FIELDS.map((_,i)=><div key={i} style={{height:3,flex:1,borderRadius:2,background:i<=step?"var(--accent)":"var(--border2)",transition:"background .3s"}}/>)}</div>
      <div className="fu" key={step}>
        <div style={{fontSize:11,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>Paso {step+1} / {FIELDS.length}</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:700,marginBottom:16}}>{f.label}</div>
        <input key={step} value={brief[f.key]||""} onChange={e=>setBrief(p=>({...p,[f.key]:e.target.value}))} placeholder={f.ph} style={{...inp,marginBottom:16,fontSize:15}} onKeyDown={e=>e.key==="Enter"&&next()} autoFocus/>
        <div style={{display:"flex",gap:8}}>{step>0&&<button onClick={()=>setStep(s=>s-1)} style={btnS}>← Atrás</button>}<button onClick={next} style={{...btnP(),padding:"11px 22px"}}>{step===FIELDS.length-1?"Generar campaña ✦":"Siguiente →"}</button></div>
      </div>
    </div>
  );
}

function EquipoModule({user}){
  const [dbUsers,setDbUsers]=useState([]); const [asanaM,setAsanaM]=useState([]); const [activity,setActivity]=useState([]); const [tab,setTab]=useState("miembros"); const [loading,setLoading]=useState(true);
  const isDir=user.role==="director";
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try{
        const [u,w]=await Promise.all([getAllUsers(),getWS()]);
        setDbUsers(u||[]);
        if(w&&w.length){const m=await getMembers(w[0].gid);setAsanaM(m||[]);}
        if(isDir){const a=await getDocs(query(collection(db,"activity"),orderBy("ts","desc"),limit(60)));setActivity(a.docs.map(d=>({id:d.id,...d.data()})));}
      }catch(e){console.error(e);}
      setLoading(false);
    })();
  },[isDir]);
  const fmtTs=ts=>{if(!ts)return"";const d=ts.toDate?ts.toDate():new Date(ts);const s=Math.floor((Date.now()-d.getTime())/1e3);if(s<60)return"ahora";if(s<3600)return`hace ${Math.floor(s/60)}m`;if(s<86400)return`hace ${Math.floor(s/3600)}h`;return`hace ${Math.floor(s/86400)}d`;};
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="👥" title="Equipo Aldea" sub="Miembros registrados, áreas y actividad en tiempo real"/>
      <div style={{display:"flex",gap:6,marginBottom:14,alignItems:"center"}}>
        {["miembros","asana",...(isDir?["actividad"]:[])].map(t=><button key={t} onClick={()=>setTab(t)} style={{...btnS,fontSize:12,padding:"5px 12px",background:tab===t?"var(--border2)":"var(--card)",color:tab===t?"var(--text)":"var(--muted)"}}>{t==="miembros"?"👤 Equipo":t==="asana"?"🔗 Asana":"📊 Actividad"}</button>)}
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:"var(--green)",display:"inline-block",animation:"pulse 2s infinite"}}/>{dbUsers.length} miembro{dbUsers.length!==1?"s":""}</span>
      </div>
      {loading?<div style={{display:"flex",gap:8,color:"var(--muted)",padding:16,alignItems:"center"}}><Spin/>Cargando...</div>
      :tab==="miembros"?(
        <div style={{flex:1,overflowY:"auto",maxHeight:440}}>
          {dbUsers.length===0?<div style={{textAlign:"center",padding:40,color:"var(--muted)",fontSize:13}}>No hay miembros registrados todavía.</div>
          :dbUsers.map(u=>{const r=ROLES[u.role];const ar=AREAS[u.area];return(
            <div key={u.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",marginBottom:6,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:(r?.color||"var(--muted)")+"22",border:`1px solid ${r?.color||"var(--muted)"}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{r?.icon||"?"}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:13.5,marginBottom:4}}>{u.name}{u.id===user.id&&<span style={{fontSize:10,color:"var(--muted)",marginLeft:6}}>(vos)</span>}</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  <Tag color={r?.color||"var(--muted)"}>{r?.label||u.role}</Tag>
                  {u.area&&ar&&<Tag color={ar.color}>{ar.icon} {u.area}</Tag>}
                </div>
              </div>
            </div>
          );})}
        </div>
      ):tab==="asana"?(
        <div style={{flex:1,overflowY:"auto",maxHeight:440}}>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>{asanaM.length} miembros en Asana</div>
          {asanaM.map(m=>(
            <div key={m.gid} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"10px 12px",marginBottom:5,display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:"var(--border2)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"var(--accent)"}}>{m.name?m.name[0].toUpperCase():"?"}</div>
              <div style={{flex:1}}><div style={{fontSize:13.5,fontWeight:500}}>{m.name}</div><div style={{fontSize:11,color:"var(--muted2)"}}>{m.email}</div></div>
              <div style={{width:7,height:7,borderRadius:"50%",background:"var(--green)",animation:"pulse 2s infinite"}}/>
            </div>
          ))}
        </div>
      ):(
        <div style={{flex:1,overflowY:"auto",maxHeight:440}}>
          {activity.length===0?<div style={{textAlign:"center",padding:40,color:"var(--muted)",fontSize:13}}>No hay actividad todavía.</div>
          :activity.map((a,i)=>{const r=ROLES[a.userRole];return(
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"9px 12px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,marginBottom:5}}>
              <div style={{width:26,height:26,borderRadius:"50%",background:(r?.color||"var(--muted)")+"22",flexShrink:0,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11}}>{r?.icon||"?"}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,marginBottom:2}}><strong style={{color:r?.color||"var(--text)"}}>{a.userName}</strong> <span style={{color:"var(--muted2)"}}>en</span> <span style={{color:MC[a.module]||"var(--muted)"}}>{ML[a.module]||a.module}</span></div><div style={{fontSize:11.5,color:"var(--muted2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.action}</div></div>
              <div style={{fontSize:11,color:"var(--muted)",flexShrink:0}}>{fmtTs(a.ts)}</div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

function HistorialModule({user}){
  const [convs,setConvs]=useState([]); const [loading,setLoading]=useState(true); const [selected,setSelected]=useState(null); const [filter,setFilter]=useState("todos");
  const isDir=user.role==="director";
  useEffect(()=>{(async()=>{setLoading(true);const all=isDir?await getAllConvs():(await getAllConvs()).filter(c=>c.userId===user.id);setConvs(all||[]);setLoading(false);})();},[user.id,isDir]);
  const filtered=filter==="todos"?convs:convs.filter(c=>c.moduleId===filter);
  const fmt=ts=>{if(!ts)return"";const d=ts.toDate?ts.toDate():new Date(ts);return d.toLocaleDateString("es-AR",{day:"2-digit",month:"short"});};
  if(selected) return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="🗂" title={selected.title||"Conversación"} sub={ML[selected.moduleId]||selected.moduleId} right={<button onClick={()=>setSelected(null)} style={{...btnS,fontSize:12,padding:"5px 11px"}}>← Volver</button>}/>
      <div style={{flex:1,overflowY:"auto",maxHeight:480}}>{(selected.messages||[]).map((m,i)=><Bubble key={i} {...m}/>)}</div>
    </div>
  );
  return(
    <div style={{display:"flex",flexDirection:"column",flex:1}}>
      <MH icon="🗂" title="Historial" sub={isDir?"Todo el historial del equipo":"Tus conversaciones guardadas"}/>
      <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>{["todos","email","proyectos","estrategia","campanas"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{...btnS,fontSize:11,padding:"4px 10px",background:filter===f?"var(--border2)":"var(--card)",color:filter===f?"var(--text)":"var(--muted)"}}>{f==="todos"?"Todos":ML[f]||f}</button>)}</div>
      {loading?<div style={{display:"flex",gap:8,color:"var(--muted)",padding:16,alignItems:"center"}}><Spin/>Cargando...</div>
      :filtered.length===0?<div style={{textAlign:"center",padding:"50px 20px",color:"var(--muted)",fontSize:13}}>No hay conversaciones todavía.<br/><span style={{fontSize:11}}>Usá "💾 Guardar" en cualquier módulo.</span></div>
      :<div style={{flex:1,overflowY:"auto",maxHeight:440}}>{filtered.map(c=>(
        <div key={c.id} onClick={()=>setSelected(c)} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:9,padding:"11px 13px",cursor:"pointer",marginBottom:6,transition:"border .2s"}} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--border2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
          <div style={{display:"flex",justifyContent:"space-between",gap:10}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:500,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.title||"Sin título"}</div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}><Tag color={MC[c.moduleId]||"var(--muted)"}>{ML[c.moduleId]||c.moduleId}</Tag>{isDir&&c.userName&&<span style={{fontSize:11,color:"var(--muted2)"}}>{c.userName}</span>}</div>
            </div>
            <div style={{fontSize:11,color:"var(--muted)",flexShrink:0,textAlign:"right"}}>{fmt(c.savedAt)}<br/>{(c.messages||[]).length} msgs</div>
          </div>
        </div>
      ))}</div>}
    </div>
  );
}

export default function App(){
  const [user,setUser]=useState(null); const [tab,setTab]=useState(null);
  const enter=u=>{setUser(u);setTab(ROLES[u.role]?.tabs[0]||"email");};
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
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Tag color={role?.color}>{role?.icon} {role?.label}</Tag>
            <span style={{fontSize:13,color:"var(--muted2)"}}>{user.name}</span>
            <button onClick={()=>setUser(null)} style={{...btnS,padding:"5px 12px",fontSize:12}}>Salir</button>
          </div>
        </header>
        <nav style={{display:"flex",borderBottom:"1px solid var(--border)",background:"var(--surface)",padding:"0 18px",gap:2,overflowX:"auto"}}>
          {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"12px 13px",background:"none",border:"none",borderBottom:tab===t.id?"2px solid var(--accent)":"2px solid transparent",color:tab===t.id?"var(--text)":"var(--muted)",fontSize:13,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}><span>{t.icon}</span><span>{t.label}</span></button>)}
        </nav>
        <main key={tab} className="fu" style={{flex:1,padding:24,maxWidth:860,width:"100%",margin:"0 auto",display:"flex",flexDirection:"column"}}>
          {tab==="email"      &&<EmailModule      user={user}/>}
          {tab==="proyectos"  &&<ProyectosModule  user={user}/>}
          {tab==="estrategia" &&<EstrategiaModule user={user}/>}
          {tab==="campanas"   &&<CampanasModule   user={user}/>}
          {tab==="equipo"     &&<EquipoModule     user={user}/>}
          {tab==="historial"  &&<HistorialModule  user={user}/>}
        </main>
      </div>
    </>
  );
}
