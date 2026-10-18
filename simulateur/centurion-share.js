/* Transport de séance : calculs dans le maître, vues et gestes communs aux auxiliaires. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.CenturionShare=api;})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  const PROTOCOL=2;
  const enabled=()=>root.document?.querySelector('meta[name="centurion-relay"]')?.content==='on';
  const isAuxiliary=()=>Boolean(enabled()&&new URLSearchParams(root.location?.search||'').get('shareViewer'));
  function attach({readState,applyState=()=>{},applyDocument=()=>{},execute=async()=>({ok:false,error:'unsupported'})}){
    if(!enabled()||typeof readState!=='function')return null;
    const document=root.document,$=id=>document.getElementById(id),auxiliary=isAuxiliary(),role=auxiliary?'Auxiliaire':'Maître';
    const menu=$('reactorMenu'),button=$('reactorButton');if(!menu||!button)return null;menu.hidden=false;
    document.documentElement.dataset.sessionRole=auxiliary?'auxiliary':'master';
    const authorityId=root.crypto.randomUUID(),params=new URLSearchParams(root.location.search),secrets=new URLSearchParams(root.location.hash.slice(1));
    let session=null,socket=null,sdk=null,timer=null,identity=null,epoch='',seq=0,documentSignature='',documentInFlight=false,documentRetryAt=0,disposed=false,busy=false,lastPublish=0,lastReceipt=0,lastHistoryTime=null,closed=false;
    const errors={creation_rate:'Trop de créations. Réessaie dans une minute.',room_limit:'Le relais est plein. La simulation reste locale.'};
    function status(text,error=false){$('reactorStatus').textContent=text;$('reactorStatus').dataset.error=String(error);button.title=role+' · '+text;}
    function label(code){
      button.textContent=(auxiliary?'A':'M')+' · '+(code||'····');button.setAttribute('aria-label',role+' '+(code||'')+' · options de séance');
      $('reactorTitle').textContent=role+(code?' · réacteur '+code:'');
      if(auxiliary)document.title='Centurion · Auxiliaire'+(code?' '+code:'');
    }
    function controls(){
      $('reactorNew').disabled=busy;$('reactorNew').textContent=auxiliary?'Ouvrir mon réacteur':session?'Nouvelle séance':'Démarrer le partage';
      $('reactorStop').disabled=busy||!session;$('reactorStop').textContent=auxiliary?'Quitter la séance':'Arrêter le partage';
      $('reactorCopy').disabled=busy||!session;
    }
    function observerUrl(current){
      const url=new URL('/simulateur/centurion.html',root.location.href);url.searchParams.set('shareViewer',current.sessionId);
      url.hash=new URLSearchParams({session:current.sessionId,inviteToken:current.inviteToken,code:current.code||''}).toString();return url.href;
    }
    function loadSdk(){
      if(typeof root.io==='function')return Promise.resolve();if(sdk)return sdk;
      sdk=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='/socket.io/socket.io.js';
        const failed=()=>{root.clearTimeout(timeout);sdk=null;script.remove();reject(Error('Relais inaccessible.'));};
        const timeout=root.setTimeout(failed,8000);script.onerror=failed;
        script.onload=()=>{root.clearTimeout(timeout);if(typeof root.io==='function')resolve();else failed();};document.head.append(script);
      });return sdk;
    }
    function publish(){
      if(auxiliary||!socket?.connected||disposed||Date.now()-lastPublish<120)return;
      let current=readState({historySince:lastHistoryTime});if(!current)return;
      if(current.identity!==identity){identity=current.identity;epoch=root.crypto.randomUUID();seq=0;documentSignature='';lastHistoryTime=null;current=readState({historySince:null});}
      const signature=epoch+'/'+current.document.revision;
      if(documentSignature!==signature&&!documentInFlight&&Date.now()>=documentRetryAt){
        documentInFlight=true;
        socket.timeout(3000).emit('session:document',root.structuredClone({...current.document,protocol:PROTOCOL,epoch}), (error,result)=>{
          documentInFlight=false;
          if(!error&&result?.ok)documentSignature=signature;
          else{documentRetryAt=Date.now()+3000;status('Transmission des schémas interrompue. La simulation reste locale.',true);}
        });
      }
      lastPublish=Date.now();lastHistoryTime=current.frame.time;socket.volatile.emit('state:frame',root.structuredClone({...current.frame,simulation:{...current.frame.simulation,visible:document.visibilityState==='visible'},protocol:PROTOCOL,epoch,seq:++seq}));
    }
    async function disconnect(end){
      const previous=socket;socket=null;if(timer!==null)root.clearInterval(timer);timer=null;
      if(end&&previous?.connected&&!auxiliary)await new Promise(resolve=>{const timeout=root.setTimeout(resolve,1000);previous.emit('session:end',()=>{root.clearTimeout(timeout);resolve();});});
      previous?.disconnect();
    }
    function connect(current){
      session=current;identity=null;epoch='';seq=0;lastPublish=0;lastHistoryTime=null;documentSignature='';documentInFlight=false;closed=false;label(current.code);button.dataset.online='false';
      $('reactorObserver').href=observerUrl(current);$('reactorObserver').hidden=auxiliary;status('Connexion au relais…');
      const connection=root.io({transports:['websocket'],auth:{protocol:PROTOCOL,role:auxiliary?'viewer':'master',sessionId:current.sessionId,token:auxiliary?current.inviteToken:current.masterToken,...(!auxiliary?{authorityId}:{})}});socket=connection;
      connection.on('session:status',state=>{
        if(socket!==connection)return;
        if(state.code){current.code=state.code;label(state.code);$('reactorObserver').href=observerUrl(current);}
        closed=Boolean(state.closed);
        if(closed){status('Séance terminée · schémas présents exportables depuis les ateliers.',true);button.dataset.online='false';connection.disconnect();}
        else if(auxiliary&&!state.online){status('Maître absent · valeurs figées et commandes indisponibles.',true);button.dataset.online='false';}
        else{status(role+' connecté · '+state.viewers+' auxiliaire'+(state.viewers>1?'s':''));button.dataset.online='true';}
      });
      connection.on('connect',()=>{if(socket!==connection)return;status(role+' connecté');if(!auxiliary)publish();});
      connection.on('disconnect',()=>{if(socket!==connection)return;button.dataset.online='false';if(!closed)status(auxiliary?'Relais déconnecté · dernières valeurs confirmées.':'Relais déconnecté · la simulation reste locale.',true);});
      connection.on('connect_error',error=>{if(socket!==connection)return;button.dataset.online='false';status(error.message==='authority_lost'?'Page maître rechargée · crée une nouvelle séance.':'Séance inaccessible ou expirée.',true);});
      if(auxiliary){
        connection.on('session:document',(packet,ack)=>{if(socket===connection){try{applyDocument(packet);}catch(error){status('Schéma reçu invalide : '+error.message,true);}}if(typeof ack==='function')ack({ok:true});});
        connection.on('state:frame',packet=>{
          if(socket!==connection||packet.protocol!==PROTOCOL||packet.epoch===epoch&&packet.seq<=seq)return;
          epoch=packet.epoch;seq=packet.seq;lastReceipt=Date.now();
          try{applyState(packet);}catch(error){status('Actualisation interrompue : '+error.message,true);}
        });
        timer=root.setInterval(()=>{if(!closed&&lastReceipt&&Date.now()-lastReceipt>2500){button.dataset.online='false';status('Mesures en retard · commandes suspendues.',true);}else if(connection.connected&&!closed&&lastReceipt)button.dataset.online='true';},1000);
      }else{
        connection.on('command:apply',async(packet,ack)=>{
          if(typeof ack!=='function')return;
          const currentState=readState({identityOnly:true});
          if(socket!==connection||packet.epoch!==epoch||!currentState||currentState.identity!==identity){ack({ok:false,error:'stale_epoch',message:'La simulation a changé ou un chargement est en cours.'});return;}
          try{const result=await execute(packet.action,{actor:packet.actor,id:packet.id,identity});publish();ack(result);}
          catch(error){ack({ok:false,error:error.code||'command_refused',message:error.message});}
        });
        timer=root.setInterval(publish,200);
      }
      controls();
    }
    async function createSession(){
      if(busy||disposed)return;if(auxiliary){root.open('/simulateur/centurion.html','_blank','noopener');return;}
      busy=true;controls();status('Attribution du numéro du réacteur…');
      try{await loadSdk();const response=await root.fetch('/api/sessions',{method:'POST',signal:root.AbortSignal.timeout(8000)}),current=await response.json();
        if(!response.ok)throw Error(errors[current.error]||'Partage indisponible.');if(disposed)return;
        await disconnect(true);if(!disposed)connect(current);
      }catch(error){status(error.message,true);}finally{busy=false;controls();}
    }
    async function request(action){
      if(!auxiliary||!socket?.connected||closed||!epoch||Date.now()-lastReceipt>2500)return {ok:false,error:'offline',message:'Maître indisponible ou mesures périmées. Aucune commande envoyée.'};
      try{const result=await socket.timeout(25000).emitWithAck('command:request',{id:root.crypto.randomUUID(),epoch,action});
        if(!result.ok)status(result.message||'Commande refusée par le maître.',true);return result;
      }catch{return {ok:false,error:'uncertain',message:'Réponse absente. Vérifie les valeurs avant de recommencer.'};}
    }
    async function exportFile(){
      let transfer=null;
      try{
        const start=await request({kind:'state-export-start'});if(!start.ok)throw Error(start.message||'Sauvegarde indisponible.');transfer=start.transfer;
        const chunks=[];for(let index=0;index<start.parts;index++){
          const page=await request({kind:'state-export-page',transfer,index});if(!page.ok)throw Error(page.message||'Sauvegarde interrompue.');chunks.push(page.text);
          if(index+1<start.parts)await new Promise(resolve=>root.setTimeout(resolve,90));
        }
        const url=root.URL.createObjectURL(new root.Blob(chunks,{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=start.name;link.click();root.setTimeout(()=>root.URL.revokeObjectURL(url),30000);
        return {ok:true,message:'État du maître sauvegardé dans le fichier.'};
      }finally{if(transfer)void request({kind:'state-export-end',transfer});}
    }
    async function importFile(file){
      if(file.size>160*1024*1024)throw Error('Fichier trop volumineux (160 Mo maximum).');
      const text=await file.text(),parts=Math.ceil(text.length/65536),start=await request({kind:'state-import-start',name:file.name,parts,length:text.length});
      if(!start.ok)throw Error(start.message||'Chargement indisponible.');
      for(let index=0;index<parts;index++){
        const result=await request({kind:'state-import-part',transfer:start.transfer,index,text:text.slice(index*65536,(index+1)*65536)});
        if(!result.ok)throw Error(result.message||'Transfert interrompu.');if(index+1<parts)await new Promise(resolve=>root.setTimeout(resolve,90));
      }
      const result=await request({kind:'state-import-finish',transfer:start.transfer});if(!result.ok)throw Error(result.message||'Chargement refusé par le maître.');return result;
    }
    $('reactorNew').addEventListener('click',createSession);
    $('reactorCopy').addEventListener('click',async()=>{if(session){try{await root.navigator.clipboard.writeText(observerUrl(session));status('Invitation copiée · pilotage et édition partagés.');}catch{status('Copie l’adresse du lien auxiliaire.',true);}}});
    $('reactorStop').addEventListener('click',async()=>{if(busy)return;busy=true;controls();await disconnect(true);session=null;closed=true;label(null);button.dataset.online='false';$('reactorObserver').hidden=true;status(auxiliary?'Séance quittée · données figées.':'Partage arrêté · simulation individuelle.');busy=false;controls();});
    const menus=[...document.querySelectorAll('.state-menu')];menus.forEach(item=>item.addEventListener('toggle',()=>{if(item.open)menus.forEach(other=>{if(other!==item)other.open=false;});}));
    root.addEventListener('pagehide',()=>{disposed=true;void disconnect(false);},{once:true});
    label(null);controls();
    const sessionId=params.get(auxiliary?'shareViewer':'shareMaster');
    if(auxiliary||sessionId&&secrets.get('masterToken'))loadSdk().then(()=>connect({sessionId,code:secrets.get('code'),inviteToken:secrets.get('inviteToken'),masterToken:secrets.get('masterToken')})).catch(error=>status(error.message,true));else void createSession();
    return Object.freeze({request,exportFile,importFile,setStatus:status,publish,isAuxiliary:()=>auxiliary,close:()=>{disposed=true;return disconnect(true);}});
  }
  return Object.freeze({attach,isAuxiliary});
});
