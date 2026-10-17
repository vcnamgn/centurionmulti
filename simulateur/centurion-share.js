/* Séances du relais : le maître garde seul la simulation et les ateliers. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.CenturionShare=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  function attach({readState}){
    const document=root.document;
    // Seul le serveur du relais active cette balise. Fichiers et site statique restent autonomes.
    if(document?.querySelector('meta[name="centurion-relay"]')?.content!=='on'||typeof readState!=='function')return null;
    const $=id=>document.getElementById(id),menu=$('reactorMenu'),button=$('reactorButton');
    if(!menu||!button)return null;
    menu.hidden=false;
    const authorityId=root.crypto.randomUUID();
    let socket=null,session=null,timer=null,identity=null,epoch='',seq=0,busy=false,disposed=false,sdk=null;
    const messages={creation_rate:'Trop de créations. Réessaie dans une minute.',room_limit:'Le relais est plein. La simulation continue ; réessaie plus tard.'};
    function status(text,error=false){$('reactorStatus').textContent=text;$('reactorStatus').dataset.error=String(error);}
    function controls(){
      $('reactorNew').disabled=busy; $('reactorNew').textContent=session?'Nouvelle séance':'Démarrer le partage';
      $('reactorStop').disabled=busy||!session;$('reactorCopy').disabled=busy||!session;
    }
    function observerUrl(current){
      const url=new URL('/observer',root.location.href);
      url.hash=new URLSearchParams({session:current.sessionId,inviteToken:current.inviteToken,...(current.code?{code:current.code}:{})}).toString();return url.href;
    }
    function loadSdk(){
      if(typeof root.io==='function')return Promise.resolve();
      if(sdk)return sdk;
      sdk=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='/socket.io/socket.io.js';
        const failed=()=>{root.clearTimeout(timeout);sdk=null;script.remove();reject(Error('Relais inaccessible. La simulation reste locale.'));};
        const timeout=root.setTimeout(failed,8000);
        script.onload=()=>{root.clearTimeout(timeout);if(typeof root.io==='function')resolve();else failed();};
        script.onerror=failed;document.head.append(script);
      });return sdk;
    }
    function publish(){
      if(!socket?.connected||disposed)return;
      const current=readState();if(!current)return;
      if(current.identity!==identity){identity=current.identity;epoch=root.crypto.randomUUID();seq=0;}
      const frame={...current.frame,simulation:{...current.frame.simulation,visible:document.visibilityState==='visible'},protocol:1,epoch,seq:++seq};
      socket.volatile.emit('state:frame',root.structuredClone(frame));
    }
    async function disconnect(end){
      const previous=socket;socket=null;
      if(timer!==null)root.clearInterval(timer);timer=null;
      if(end&&previous?.connected)await new Promise(resolve=>{
        const timeout=root.setTimeout(resolve,1000);
        previous.emit('session:end',()=>{root.clearTimeout(timeout);resolve();});
      });
      previous?.disconnect();
    }
    function connect(current){
      session=current;identity=null;epoch='';seq=0;
      button.textContent=current.code?'Réacteur '+current.code:'Réacteur partagé';
      button.setAttribute('aria-label',button.textContent+' · options de séance');button.dataset.online='false';
      $('reactorTitle').textContent=current.code?'Séance du réacteur '+current.code:'Séance de ce réacteur';
      $('reactorObserver').href=observerUrl(current);$('reactorObserver').hidden=false;status('Connexion au relais…');
      const connection=root.io({transports:['websocket'],auth:{protocol:1,role:'master',sessionId:current.sessionId,token:current.masterToken,authorityId}});socket=connection;
      connection.on('session:status',state=>{
        if(socket!==connection)return;
        if(state.code&&!current.code){current.code=state.code;button.textContent='Réacteur '+state.code;button.setAttribute('aria-label',button.textContent+' · options de séance');$('reactorObserver').href=observerUrl(current);}
        status(`Maître connecté · ${state.viewers} auxiliaire${state.viewers>1?'s':''}`);
      });
      connection.on('connect',()=>{if(socket===connection){button.dataset.online='true';status('Maître connecté');publish();}});
      connection.on('disconnect',()=>{if(socket===connection){button.dataset.online='false';status('Relais déconnecté · la simulation reste locale',true);}});
      connection.on('connect_error',error=>{if(socket!==connection)return;button.dataset.online='false';status(error.message==='authority_lost'
        ?'Cette page a perdu le maître. Crée une nouvelle séance pour partager la simulation courante.'
        :'Séance inaccessible. Crée une nouvelle séance ; la simulation reste locale.',true);});
      timer=root.setInterval(publish,200);controls();
    }
    async function createSession(){
      if(busy||disposed)return;busy=true;controls();status(session?'Préparation d’une nouvelle séance…':'Attribution du numéro du réacteur…');
      try{
        await loadSdk();
        const response=await root.fetch('/api/sessions',{method:'POST',signal:root.AbortSignal.timeout(8000)});
        const current=await response.json();
        if(!response.ok)throw Error(messages[current.error]||'Partage indisponible. La simulation continue localement.');
        if(disposed)return;
        await disconnect(true);if(!disposed)connect(current);
      }catch(error){status(error.name==='TimeoutError'?'Le relais ne répond pas. La simulation continue localement.':error.message,true);}
      finally{busy=false;controls();}
    }
    $('reactorNew').addEventListener('click',createSession);
    $('reactorCopy').addEventListener('click',async()=>{
      if(!session)return;try{await root.navigator.clipboard.writeText(observerUrl(session));status('Invitation copiée · accès en lecture seule.');}
      catch{status('Copie l’adresse du lien « Ouvrir un écran auxiliaire ».',true);}
    });
    $('reactorStop').addEventListener('click',async()=>{
      if(busy)return;busy=true;controls();await disconnect(true);session=null;
      button.textContent='Réacteur local';button.setAttribute('aria-label','Réacteur local · options de séance');button.dataset.online='false';
      $('reactorTitle').textContent='Réacteur local';$('reactorObserver').hidden=true;status('Partage arrêté. La simulation et tes schémas restent ici.');busy=false;controls();
    });
    // Ne pas superposer les menus Fichier et Réacteur.
    const menus=[...document.querySelectorAll('.state-menu')];
    menus.forEach(item=>item.addEventListener('toggle',()=>{if(item.open)menus.forEach(other=>{if(other!==item)other.open=false;});}));
    root.addEventListener('pagehide',()=>{disposed=true;void disconnect(false);},{once:true});
    const sessionId=new URLSearchParams(root.location.search).get('shareMaster'),params=new URLSearchParams(root.location.hash.slice(1));
    if(sessionId&&params.get('masterToken'))loadSdk().then(()=>connect({sessionId,masterToken:params.get('masterToken'),inviteToken:params.get('inviteToken')})).catch(error=>{status(error.message,true);controls();});
    else void createSession();
    return Object.freeze({close:()=>{disposed=true;return disconnect(true);}});
  }
  return Object.freeze({attach});
});
