/* Publication optionnelle : aucune dépendance réseau en utilisation individuelle. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CenturionShare=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  function attach({readState}){
    const sessionId=new URLSearchParams(root.location?.search||'').get('shareMaster');
    if(!sessionId)return null;
    const secrets=new URLSearchParams(root.location.hash.slice(1)),proof=secrets.get('masterToken'),invite=secrets.get('inviteToken');
    if(!proof||typeof readState!=='function')return null;
    const document=root.document,banner=document.createElement('aside');banner.setAttribute('aria-label','Séance partagée');
    banner.style.cssText='display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 18px;background:#e5f4f2;color:#164d50;font:14px system-ui;position:relative;z-index:50';
    const label=document.createElement('strong');label.textContent='Maître · connexion au relais…';
    const invitation=document.createElement('a');invitation.textContent='Ouvrir un écran auxiliaire';invitation.target='_blank';invitation.rel='noopener';
    const invitationUrl=new URL('/observer',root.location.href);invitationUrl.hash=new URLSearchParams({session:sessionId,inviteToken:invite||''}).toString();invitation.href=invitationUrl.href;
    const copy=document.createElement('button');copy.type='button';copy.textContent='Copier l’invitation';
    const stop=document.createElement('button');stop.type='button';stop.textContent='Terminer le partage';
    const note=document.createElement('small');note.textContent='Premier essai : garde cet onglet visible.';
    banner.append(label,invitation,copy,stop,note);document.body.prepend(banner);
    const authorityId=root.crypto.randomUUID();
    let socket=null,timer=null,identity=null,epoch='',seq=0,stopped=false;
    copy.addEventListener('click',async()=>{try{await root.navigator.clipboard.writeText(invitationUrl.href);copy.textContent='Invitation copiée';}catch{label.textContent='Copie l’adresse du lien « Ouvrir un écran auxiliaire ».';}});
    function cleanup(){if(timer!==null)root.clearInterval(timer);timer=null;if(socket)socket.disconnect();}
    stop.addEventListener('click',()=>{stopped=true;if(socket?.connected)socket.emit('session:end',()=>cleanup());else cleanup();label.textContent='Partage terminé · simulation individuelle';copy.disabled=true;invitation.remove();stop.disabled=true;});
    root.addEventListener('pagehide',cleanup,{once:true});
    function publish(){
      if(!socket?.connected||stopped)return;
      const current=readState();if(!current)return;
      if(current.identity!==identity){identity=current.identity;epoch=root.crypto.randomUUID();seq=0;}
      const frame={...current.frame,simulation:{...current.frame.simulation,visible:document.visibilityState==='visible'},protocol:1,epoch,seq:++seq};
      // Copier uniquement la projection courante ; jamais le modèle ou l’historique.
      socket.volatile.emit('state:frame',root.structuredClone(frame));
    }
    const script=document.createElement('script');script.src='/socket.io/socket.io.js';
    script.onerror=()=>{label.textContent='Relais inaccessible · la simulation reste locale';};
    script.onload=()=>{
      if(stopped)return;
      socket=root.io({transports:['websocket'],auth:{protocol:1,role:'master',sessionId,token:proof,authorityId}});
      socket.on('session:status',status=>{if(!stopped)label.textContent=status.closed?'Séance terminée':`Maître connecté · ${status.viewers} auxiliaire${status.viewers>1?'s':''}`;});
      socket.on('connect',()=>{label.textContent='Maître connecté';publish();});
      socket.on('disconnect',()=>{if(!stopped)label.textContent='Relais déconnecté · la simulation reste locale';});
      socket.on('connect_error',error=>{label.textContent=error.message==='authority_lost'
        ?'Page maître rechargée · crée une nouvelle séance depuis l’accueil'
        :'Séance inaccessible · la simulation reste locale';});
      timer=root.setInterval(publish,200);
    };
    document.head.append(script);
    return Object.freeze({close:cleanup});
  }
  return Object.freeze({attach});
});
