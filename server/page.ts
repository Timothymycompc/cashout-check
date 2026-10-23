// The one web page: paste a link, a Telegram bot or a wallet; the page calls POST /api/check and shows the answer.
// Plain HTML, CSS and a little script, all inline, so it loads fast on a phone.
export const PAGE = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CashOut Check</title>
<meta name="description" content="Paste an online casino, play-and-earn game, Telegram game bot or deposit wallet. See the known ways people lose money there, before you deposit.">
<style>
:root{--bg:#07090d;--panel:#0e131b;--line:#1c2532;--ink:#e8eef6;--dim:#8796a8;--red:#ff4d5e;--amber:#ffb547;--green:#35e0a1;--blue:#5aa8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body:before{content:"";position:fixed;inset:0;background:radial-gradient(600px 300px at 80% -10%,#1b3a5a55,transparent),radial-gradient(500px 300px at 0% 110%,#3a1b4a44,transparent);pointer-events:none}
main{max-width:720px;margin:0 auto;padding:40px 16px 64px;position:relative}
h1{font-size:34px;letter-spacing:-.02em;margin:0 0 6px}h1 span{background:linear-gradient(90deg,var(--green),var(--blue));-webkit-background-clip:text;color:transparent}
.sub{color:var(--dim);margin:0 0 28px}
form{display:flex;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:8px;transition:border-color .2s}
form:focus-within{border-color:var(--blue)}
input{flex:1;min-width:0;background:transparent;border:0;color:var(--ink);font:inherit;padding:10px 8px;outline:0}
button{background:linear-gradient(90deg,var(--green),var(--blue));color:#04121c;border:0;border-radius:10px;padding:10px 18px;font:600 15px/1 inherit;cursor:pointer;transition:transform .15s}
button:active{transform:scale(.97)}button:disabled{opacity:.5}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0}.chips span{font-size:13px;color:var(--dim);border:1px solid var(--line);border-radius:99px;padding:3px 10px}
.scan{height:2px;margin:18px 0;background:linear-gradient(90deg,transparent,var(--blue),transparent);background-size:40% 100%;background-repeat:no-repeat;animation:scan 1.1s linear infinite;display:none}
@keyframes scan{from{background-position:-40% 0}to{background-position:140% 0}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin-top:18px;animation:up .35s ease both}
@keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.verdict{font-size:22px;font-weight:700;display:flex;align-items:center;gap:10px}.dot{width:12px;height:12px;border-radius:50%;box-shadow:0 0 14px currentColor;animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{50%{opacity:.45}}
.v-DONT_DEPOSIT{color:var(--red)}.v-CAREFUL{color:var(--amber)}.v-NO_KNOWN_TRAPS{color:var(--green)}.v-UNKNOWN{color:var(--dim)}
.head{color:var(--dim);margin:4px 0 14px}.f{border-top:1px solid var(--line);padding:12px 0;animation:up .3s ease both}
.f b{font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin-right:6px}.r-fail b{color:var(--red)}.r-warn b{color:var(--amber)}.r-info b{color:var(--blue)}.r-pass b{color:var(--green)}.r-unknown b{color:var(--dim)}
.src{font-size:13px;color:var(--dim);margin-top:4px;word-break:break-word}.why{font-size:13px;color:#6f7f93}
.tip{border-left:3px solid var(--red);padding:8px 12px;margin-top:12px;background:#ff4d5e12;border-radius:0 10px 10px 0}
footer{color:var(--dim);font-size:13px;margin-top:40px}a{color:var(--blue)}
</style></head><body><main>
<h1><span>CashOut</span> Check</h1>
<p class="sub">Will this casino or game ever let you cash out? Paste it before you deposit.</p>
<form id="f"><input id="q" placeholder="Casino link, t.me/gamebot or a wallet address" autocomplete="off" autocapitalize="off" spellcheck="false" required><button id="go">Check</button></form>
<div class="chips"><span>🎰 casino &amp; game sites</span><span>🤖 Telegram game bots</span><span>👛 deposit wallets</span></div>
<div class="scan" id="scan"></div>
<div id="out"></div>
<footer>Every finding names its source and the real case its rule comes from. "No known traps found" means none of the traps we know about were found; it never means safe. Free. <a href="https://t.me/CashOutCheckBot">Telegram bot</a> · <a href="https://github.com/Timothymycompc/cashout-check">Open source</a> · <a href="https://github.com/Timothymycompc/cashout-check/blob/main/PRINCIPLES.md">Principles</a></footer>
</main>
<script>
const NAMES={DONT_DEPOSIT:"Don't deposit",CAREFUL:"Be careful",NO_KNOWN_TRAPS:"No known traps found",UNKNOWN:"Couldn't check"};
const LABEL={fail:"Trap",warn:"Warning",info:"Note",pass:"OK",unknown:"Unknown"};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const out=document.getElementById("out"),scan=document.getElementById("scan"),q=document.getElementById("q"),go=document.getElementById("go");
async function run(v){
  out.innerHTML="";scan.style.display="block";go.disabled=true;history.replaceState(null,"","?q="+encodeURIComponent(v));
  try{
    const r=await fetch("/api/check",{method:"POST",headers:{"content-type":"application/json","x-from":"page"},body:JSON.stringify({input:v})});
    const d=await r.json();
    if(!r.ok){out.innerHTML='<div class="card">'+esc(d.error||"Something went wrong.")+'</div>';return}
    out.innerHTML='<div class="card"><div class="verdict v-'+d.verdict+'"><span class="dot"></span>'+NAMES[d.verdict]+'</div><div class="head">'+esc(d.headline)+'</div>'
      +d.findings.map((f,i)=>'<div class="f r-'+f.result+'" style="animation-delay:'+(i*60)+'ms"><b>'+LABEL[f.result]+'</b>'+esc(f.detail)+'<div class="src">Source: '+esc(f.source)+'</div><div class="why">Why we check: '+esc(f.why)+'</div></div>').join("")
      +(d.verdict==="DONT_DEPOSIT"?'<div class="tip">Never pay a fee, tax or deposit to "unlock" a withdrawal. Never connect your wallet or share a seed phrase.</div>':"")+'</div>';
  }catch(e){out.innerHTML='<div class="card">Couldn\\'t reach the checker. Try again in a moment.</div>'}
  finally{scan.style.display="none";go.disabled=false}
}
document.getElementById("f").addEventListener("submit",e=>{e.preventDefault();run(q.value.trim())});
const pre=new URLSearchParams(location.search).get("q");if(pre){q.value=pre;run(pre)}
</script></body></html>`;
