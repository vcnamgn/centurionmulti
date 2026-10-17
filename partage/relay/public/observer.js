(()=>{'use strict';const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
  const fmt=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
  const duration=t=>{const n=Math.max(0,Math.floor(t));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(v=>String(v).padStart(2,'0')).join(':');};
  let online=false,closed=false,lastReceipt=0,simulation=null,epoch=null,seq=0;
  const fields=[['power','Puissance nucléaire','% PN'],['electricMW','Puissance électrique','MWe'],['pressure','Pression primaire','bar'],['tavgC','Température moyenne','°C'],['pzrLevel','Niveau pressuriseur','%'],['boron','Concentration en bore','ppm'],['dnbr','DNBR',''],['dpax','DPAX','% PN']];
  function metric(label,id,unit){const box=document.createElement('article');box.className='metric';const name=document.createElement('span');name.textContent=label;const value=document.createElement('strong');value.id=id;value.textContent='—';const note=document.createElement('small');note.textContent=unit;box.append(name,value,note);return box;}
  for(const [id,label,unit] of fields)$('metrics').append(metric(label,'m-'+id,unit));
  for(let i=1;i<=4;i++)for(const kind of ['gvs','loops']){const box=document.createElement('article');box.className='train';const title=document.createElement('h3');title.textContent=(kind==='gvs'?'GV ':'Boucle ')+i;const text=document.createElement('p');text.id=kind+'-'+i;text.textContent='En attente de mesures';box.append(title,text);$(kind).append(box);}
  function connection(){
    let text=closed?'Séance terminée.':!online?'Maître indisponible · dernières valeurs confirmées.':!lastReceipt?'En attente des premières mesures…':Date.now()-lastReceipt>2500?'Mesures en retard · dernières valeurs confirmées.':simulation?.visible===false?'Maître masqué · la progression peut être interrompue.':simulation?.running?'En direct · simulation en marche':'En direct · simulation en pause';
    $('connection').textContent=text;$('connection').classList.toggle('stale',closed||!online||Date.now()-lastReceipt>2500);
  }
  if(!params.get('session')||!params.get('inviteToken')){$('connection').textContent='Ce lien d’invitation est incomplet.';return;}
  const socket=io({transports:['websocket'],auth:{protocol:1,role:'viewer',sessionId:params.get('session'),token:params.get('inviteToken')}});
  socket.on('session:status',state=>{online=state.online;closed=state.closed;if(closed)socket.disconnect();connection();});
  socket.on('disconnect',()=>{online=false;connection();});
  socket.on('connect_error',()=>{online=false;$('connection').textContent='Séance inaccessible ou expirée. Vérifie le lien d’invitation.';});
  socket.on('state:frame',frame=>{
    if(frame.protocol!==1||frame.epoch===epoch&&frame.seq<=seq)return;
    epoch=frame.epoch;seq=frame.seq;lastReceipt=Date.now();simulation=frame.simulation;
    const values={...frame.instruments,dnbr:frame.core?.dnbr,dpax:frame.core?.dpax};
    $('time').textContent=duration(frame.time);$('speed').textContent='Vitesse demandée ×'+simulation.speed;
    for(const [id] of fields)$('m-'+id).textContent=fmt(values[id],id==='dnbr'?2:1);
    frame.instruments.gvAll.forEach((g,i)=>{$('gvs-'+(i+1)).textContent=`Pression ${fmt(g.pressureBar)} bar\nNiveau ${fmt(g.levelPct)} %\nAlimentation ${fmt(g.feedTh)} t/h\nVapeur ${fmt(g.steamKgS*3.6)} t/h`;});
    frame.instruments.loops.forEach((loop,i)=>{$('loops-'+(i+1)).textContent=`Débit ${fmt(loop.flowPct)} %\nBranche chaude ${fmt(loop.hotC)} °C\nBranche froide ${fmt(loop.coldC)} °C\nGMPP ${loop.pumpStopped?'arrêtée':'en marche'}`;});connection();
  });
  setInterval(connection,1000);
})();
