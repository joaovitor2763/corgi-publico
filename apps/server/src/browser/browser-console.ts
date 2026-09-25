/** The console renders only a screenshot; remote page code never runs in this document. */
export function browserConsole(previewUrl: string) {
  const preview = JSON.stringify(previewUrl).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Navegador OpenMuse</title><style>
*{box-sizing:border-box}body{margin:0;background:#fcfcfc;color:#172125;font:14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
header{padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}#status{color:#697176;font-size:12px}#status.live{color:#248258}
button,input{font:inherit;border:1px solid #e9edef;border-radius:24px;padding:10px 14px;background:white;color:inherit;min-height:42px}
button{cursor:pointer}button:hover{background:#edf7fd}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #1473c8;outline-offset:2px}
form{padding:0 12px 10px;display:flex;gap:8px}input{flex:1;min-width:0;background:#f1f3f4;border-color:transparent}#type{background:#c8e7ff}
nav{display:flex;gap:6px;padding:0 12px 12px;flex-wrap:wrap}nav button{font-size:12px;min-height:36px;padding:7px 12px}
#stage{overflow:hidden;background:#eef1f3;border-radius:18px;min-height:160px;margin:0 8px}img{display:block;width:100%;height:auto;cursor:crosshair;touch-action:pan-y}img.stale{opacity:.45;pointer-events:none}
#error{margin:0 12px 12px;color:#984a41;background:#fbefed;padding:12px;border-radius:14px}#error:empty{display:none}footer{padding:12px;color:#697176;font-size:12px;line-height:1.5}
</style><header><strong>Navegador</strong><span id="status" role="status">Conectando…</span><button id="refresh" aria-label="Atualizar prévia do navegador">↻</button></header>
<form><input id="text" aria-label="Texto para digitar no navegador" placeholder="Digite no campo selecionado" autocomplete="off"><button id="type" type="submit">Enviar texto</button></form>
<nav aria-label="Teclado do navegador"><button data-key="Enter">Enter ↵</button><button data-key="Tab">Tab ⇥</button><button data-key="Backspace">Apagar ⌫</button><button id="up">Rolar ↑</button><button id="down">Rolar ↓</button></nav>
<div id="error" role="alert"></div><div id="stage"><img id="screen" class="stale" alt="Sessão de navegador ao vivo, clique para interagir" draggable="false"></div>
<footer>Toque na página para selecionar um campo, depois envie o texto acima. Você está controlando o navegador do agente.</footer><script>
const image=document.querySelector('#screen'),error=document.querySelector('#error'),status=document.querySelector('#status'),field=document.querySelector('#text');
let refreshing=false,sending=false,imageUrl,live=false,previewError=false;
function controls(){document.querySelectorAll('nav button,#type').forEach(button=>button.disabled=sending||!live);image.classList.toggle('stale',!live||sending);}
async function refresh(){if(refreshing||sending||document.hidden)return;refreshing=true;try{
const r=await fetch(${preview},{cache:'no-store',signal:AbortSignal.timeout(20000)});
if(!r.ok)throw new Error(r.status===401?'O acesso à sessão expirou. Feche esta janela e abra o navegador de novo.':'Navegador desconectado. Reabra a sessão pelo OpenMuse.');
const blob=await r.blob();const next=URL.createObjectURL(blob);await new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=()=>{URL.revokeObjectURL(next);reject(new Error('Não foi possível exibir a prévia do navegador.'));};probe.src=next;});
if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=next;image.src=next;live=true;status.textContent='Ao vivo';status.className='live';if(previewError){error.textContent='';previewError=false;}
}catch(e){live=false;previewError=true;status.textContent='Desconectado';status.className='';error.textContent=e.message;}finally{refreshing=false;controls();}}
async function input(body){if(sending||!live)return false;sending=true;controls();error.textContent='';status.textContent='Atualizando…';let ok=false;try{
const r=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
if(!r.ok){const data=await r.json();throw new Error(typeof data.error==='string'?data.error:'A ação no navegador falhou. Seu texto continua aqui.');}ok=true;
}catch(e){error.textContent=e.message;}finally{sending=false;controls();await refresh();}return ok;}
image.onclick=e=>{if(!live||sending)return;const r=image.getBoundingClientRect();input({type:'click',x:Math.min(1279,Math.max(0,Math.floor((e.clientX-r.left)*1280/r.width))),y:Math.min(799,Math.max(0,Math.floor((e.clientY-r.top)*800/r.height)))});};
document.querySelector('form').onsubmit=async e=>{e.preventDefault();const text=field.value;if(text&&await input({type:'text',text})&&field.value===text)field.value='';};
document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>input({type:'key',key:b.dataset.key}));
document.querySelector('#up').onclick=()=>input({type:'scroll',deltaY:-600});document.querySelector('#down').onclick=()=>input({type:'scroll',deltaY:600});
document.querySelector('#refresh').onclick=()=>{error.textContent='';refresh();};document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
controls();refresh();const timer=setInterval(refresh,2000);window.addEventListener('pagehide',()=>{clearInterval(timer);if(imageUrl)URL.revokeObjectURL(imageUrl);});
</script></html>`;
}
