'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {io}=require('socket.io-client');
const {createRelay,PROTOCOL}=require('../server');
const E=require('../../../simulateur/centurion-engine');

async function fixture(t,options={}){
  const relay=createRelay(options),address=await relay.listen();
  const origin=`http://127.0.0.1:${address.port}`,clients=[];
  t.after(async()=>{for(const c of clients)c.disconnect();await relay.close();});
  const create=()=>fetch(origin+'/api/sessions',{method:'POST'});
  const open=async(role,session,proof,authorityId='test-master-authority')=>{
    const socket=io(origin,{transports:['websocket'],forceNew:true,reconnection:false,
      auth:{protocol:PROTOCOL,role,authorityId,sessionId:session.sessionId,token:proof||(role==='master'?session.masterToken:session.inviteToken)}});
    clients.push(socket);
    await new Promise((resolve,reject)=>{socket.once('session:status',resolve);socket.once('connect_error',reject);});return socket;
  };
  return {relay,origin,clients,create,open};
}
function once(socket,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Événement absent : '+name)),3000);socket.once(name,value=>{clearTimeout(timer);resolve(value);});});}
const send=(socket,name,value)=>socket.timeout(3000).emitWithAck(name,value);
function frame(model=E.make(),seq=1,epoch='generation-one'){
  return {protocol:PROTOCOL,epoch,seq,time:model.state.time,simulation:{running:true,speed:20,visible:true},instruments:E.instrumentSnapshot(model),core:{dnbr:model.state.dnbr,dpax:model.state.dpaxPctPn}};
}

test('une app sert le simulateur, le tableau auxiliaire et le contrôle de santé sans exposer le dépôt',async t=>{
  const f=await fixture(t);
  for(const url of ['/','/observer','/healthz','/simulateur/centurion.html','/socket.io/socket.io.js'])assert.equal((await fetch(f.origin+url)).status,200,url);
  for(const url of ['/.git/config','/assets/%2e%2e%2fserver.js','/assets/../../server.js'])assert.equal((await fetch(f.origin+url)).status,404,url);
  const masterHtml=await(await fetch(f.origin+'/simulateur/centurion.html')).text();
  const auxHtml=await(await fetch(f.origin+'/simulateur/centurion.html?shareViewer=test-session')).text();
  assert.equal((masterHtml.match(/&amp;shared=0/g)||[]).length,3);
  assert.equal((auxHtml.match(/&amp;shared=1/g)||[]).length,3,'le mode auxiliaire précède tout chargement d’iframe');
  const content=await(await fetch(f.origin+'/observer')).text();
  assert.doesNotMatch(content,/centurion-(engine|app|auto|cc-regul)\./);
  assert.equal((await fetch(f.origin+'/api/sessions',{method:'POST',headers:{Origin:'https://unrelated.example'}})).status,403);
});

test('un maître distribue les vraies mesures ; un auxiliaire ne peut publier ni terminer la séance',async t=>{
  const f=await fixture(t),session=await(await f.create()).json();
  const master=await f.open('master',session),viewer=await f.open('viewer',session);
  const model=E.make();model.state.pressureBar=147;const expected=frame(model);
  const received=once(viewer,'state:frame');assert.deepEqual(await send(master,'state:frame',expected),{ok:true});
  assert.equal((await received).instruments.pressure,147);
  assert.deepEqual(await send(viewer,'state:frame',frame()),{ok:false,error:'read_only'});
  assert.deepEqual(await new Promise(resolve=>viewer.emit('session:end',resolve)),{ok:false,error:'read_only'});
});

test('authentification : invitation sans pouvoir maître, jeton incorrect et double maître refusés',async t=>{
  const f=await fixture(t),session=await(await f.create()).json();
  await assert.rejects(f.open('master',session,session.inviteToken),/access_refused/);
  await assert.rejects(f.open('viewer',session,'invalid'),/access_refused/);
  await f.open('master',session);
  await assert.rejects(f.open('master',session),/master_already_connected/);
});

test('séances isolées et arrivée tardive par dernier instantané confirmé',async t=>{
  const f=await fixture(t),a=await(await f.create()).json(),b=await(await f.create()).json();
  const master=await f.open('master',a);await send(master,'state:frame',frame());
  const late=io(f.origin,{transports:['websocket'],forceNew:true,auth:{protocol:PROTOCOL,role:'viewer',sessionId:a.sessionId,token:a.inviteToken}});f.clients.push(late);
  const saved=await once(late,'state:frame');assert.equal(saved.seq,1);
  await assert.rejects(f.open('viewer',b,a.inviteToken),/access_refused/);
});

test('numérotation, génération et volume des mesures bornés',async t=>{
  const f=await fixture(t),session=await(await f.create()).json(),master=await f.open('master',session);
  assert.equal((await send(master,'state:frame',frame())).ok,true);
  assert.deepEqual(await send(master,'state:frame',frame()),{ok:false,error:'old_frame'});
  assert.equal((await send(master,'state:frame',frame(E.make(),1,'generation-two'))).ok,true);
  const invalid=frame(E.make(),2,'generation-two');invalid.instruments.gvAll=[];
  assert.deepEqual(await send(master,'state:frame',invalid),{ok:false,error:'invalid_frame'});
  const large=frame(E.make(),2,'generation-two');large.extra='x'.repeat(1024*1024);
  assert.deepEqual(await send(master,'state:frame',large),{ok:false,error:'frame_too_large'});
});

test('perte du maître signalée ; retour du même maître sans promotion auxiliaire',async t=>{
  const f=await fixture(t),session=await(await f.create()).json(),master=await f.open('master',session),viewer=await f.open('viewer',session);
  await send(master,'state:frame',frame());
  const offline=once(viewer,'session:status');master.disconnect();assert.equal((await offline).online,false);
  const back=once(viewer,'session:status'),newMaster=await f.open('master',session);assert.equal((await back).online,true);
  const next=once(viewer,'state:frame');await send(newMaster,'state:frame',frame(E.make(),2));assert.equal((await next).seq,2);
});

test('limites de capacité et expiration des séances inactives',async t=>{
  let clock=1000;const f=await fixture(t,{maxRooms:1,idleMs:100,now:()=>clock});
  assert.equal((await f.create()).status,201);assert.equal((await f.create()).status,429);
  clock+=101;f.relay.expireRooms();assert.equal((await f.create()).status,201);
});

test('un maître rechargé ne remplace pas silencieusement une simulation perdue',async t=>{
  const f=await fixture(t),session=await(await f.create()).json(),master=await f.open('master',session),viewer=await f.open('viewer',session);
  const offline=once(viewer,'session:status');master.disconnect();await offline;
  await assert.rejects(f.open('master',session,undefined,'another-browser-page'),/authority_lost/);
});

test('terminer la séance invalide les invitations et signale la fermeture',async t=>{
  const f=await fixture(t),session=await(await f.create()).json(),master=await f.open('master',session),viewer=await f.open('viewer',session);
  const ended=once(viewer,'session:status');await new Promise(resolve=>master.emit('session:end',resolve));assert.equal((await ended).closed,true);
  await assert.rejects(f.open('viewer',session),/access_refused/);
});

test('le client de partage ne charge aucun réseau ni DOM en mode individuel',()=>{
  const context=vm.createContext({URLSearchParams,location:{search:''}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../simulateur/centurion-share.js'),'utf8'),context);
  assert.equal(context.CenturionShare.attach({readState:()=>{throw Error('Lecture non demandée');}}),null);
});

test('les numéros sont distincts, à quatre chiffres et ouvrent seulement le rôle auxiliaire',async t=>{
  const f=await fixture(t),a=await(await f.create()).json(),b=await(await f.create()).json();
  assert.match(a.code,/^[1-9]\d{3}$/);assert.notEqual(a.code,b.code);
  const join=code=>fetch(f.origin+'/api/sessions/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
  assert.equal((await join(a.code)).status,404,'pas de maître connecté');
  const master=await f.open('master',a);
  const response=await join(a.code);assert.equal(response.status,200);const invitation=await response.json();
  assert.equal(invitation.sessionId,a.sessionId);assert.equal(invitation.code,a.code);assert.equal(invitation.masterToken,undefined);
  await assert.rejects(f.open('master',a,invitation.inviteToken),/access_refused/);
  const viewer=await f.open('viewer',invitation);
  const received=once(viewer,'state:frame');await send(master,'state:frame',frame());assert.equal((await received).seq,1);
});

test('un formulaire de numéro ouvre l’auxiliaire sans jeton dans le chemin ou la requête',async t=>{
  const f=await fixture(t),session=await(await f.create()).json();await f.open('master',session);
  const page=await fetch(f.origin+'/simulateur/centurion.html');assert.equal(page.headers.get('referrer-policy'),'same-origin','préserve Origin dans les formulaires POST sans référent externe');
  const response=await fetch(f.origin+'/api/sessions/join',{method:'POST',redirect:'manual',headers:{Origin:f.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:session.code})});
  assert.equal(response.status,303);const link=new URL(response.headers.get('location'),f.origin);
  assert.equal(link.pathname,'/simulateur/centurion.html');assert.equal(link.searchParams.get('shareViewer'),session.sessionId);assert.equal(link.searchParams.has('inviteToken'),false);assert.equal(new URLSearchParams(link.hash.slice(1)).get('code'),session.code);
  assert.equal(new URLSearchParams(link.hash.slice(1)).get('inviteToken'),session.inviteToken);assert.doesNotMatch(link.href,/masterToken/);
  const bad=await fetch(f.origin+'/api/sessions/join',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'code=oops'});
  assert.equal(bad.status,303);assert.equal(bad.headers.get('location'),'/observer?joinError=invalid_code');
});

test('renouveler une séance invalide son numéro et son invitation, sans fermer le nouveau maître',async t=>{
  const f=await fixture(t),old=await(await f.create()).json(),master=await f.open('master',old),viewer=await f.open('viewer',old);
  const current=await(await f.create()).json();assert.notEqual(old.code,current.code);const next=await f.open('master',current);
  const ended=once(viewer,'session:status');await new Promise(resolve=>master.emit('session:end',resolve));assert.equal((await ended).closed,true);
  const join=await fetch(f.origin+'/api/sessions/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:old.code})});assert.equal(join.status,404);
  await assert.rejects(f.open('viewer',old),/access_refused/);assert.equal((await send(next,'state:frame',frame())).ok,true);
});

test('recherche par numéro : origine, contenu, rythme et maître absent contrôlés',async t=>{
  const f=await fixture(t);const post=(body,headers={})=>fetch(f.origin+'/api/sessions/join',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
  assert.equal((await post('{"code":"1234"}',{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await post('broken')).status,400);
  for(const code of [1234,'12','12345','1e03','<script>'])assert.equal((await post(JSON.stringify({code}))).status,400);
  assert.equal((await post('x'.repeat(1100))).status,413);
  for(let n=0;n<3;n++)assert.equal((await post('{"code":"1234"}')).status,404);
  assert.equal((await post('{"code":"1234"}')).status,429);
});

test('seul le serveur du relais active l’attribution automatique de numéro',async t=>{
  const f=await fixture(t);const response=await fetch(f.origin+'/',{redirect:'manual'});
  assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/simulateur/centurion.html');
  const html=await(await fetch(f.origin+'/simulateur/centurion.html')).text();assert.match(html,/name="centurion-relay" content="on"/);assert.match(html,/>Fichier<\/summary>/);
  const source=fs.readFileSync(path.resolve(__dirname,'../../../simulateur/centurion.html'),'utf8');assert.match(source,/name="centurion-relay" content="off"/);
  let read=false;const context=vm.createContext({URLSearchParams,document:{querySelector:()=>({content:'off'})}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../simulateur/centurion-share.js'),'utf8'),context);
  assert.equal(context.CenturionShare.attach({readState:()=>{read=true;}}),null);assert.equal(read,false);
});

test('les gestes auxiliaires sont exécutés une seule fois par le maître et restent bornés à leur séance',async t=>{
  const f=await fixture(t),session=await(await f.create()).json(),master=await f.open('master',session),viewer=await f.open('viewer',session);
  await send(master,'state:frame',frame());let calls=0,actor='';
  master.on('command:apply',(packet,ack)=>{calls++;actor=packet.actor;setTimeout(()=>ack({ok:true,value:packet.action.value}),5);});
  const request={id:'command-unique-one',epoch:'generation-one',action:{kind:'ui',target:'heaterInput',event:'input',value:'450'}};
  const [first,second]=await Promise.all([send(viewer,'command:request',request),send(viewer,'command:request',request)]);
  assert.deepEqual(first,{ok:true,value:'450'});assert.deepEqual(second,first);assert.equal(calls,1);assert.equal(actor,viewer.id);
  assert.equal((await send(viewer,'command:request',{...request,action:{...request.action,value:'500'}})).error,'duplicate_conflict');
  assert.equal((await send(viewer,'command:request',{...request,id:'command-stale-one',epoch:'generation-old'})).error,'stale_epoch');
  assert.equal((await send(viewer,'command:request',{...request,id:'command-unknown-one',action:{kind:'write-model-path',path:'state.powerPct'}})).error,'invalid_command');
  const other=await(await f.create()).json(),otherViewer=await f.open('viewer',other);
  assert.equal((await send(otherViewer,'command:request',request)).error,'master_offline');assert.equal(calls,1);
});

test('les schémas partagés proviennent seulement du maître et parviennent aux auxiliaires tardifs',async t=>{
  const f=await fixture(t),session=await(await f.create()).json(),master=await f.open('master',session),viewer=await f.open('viewer',session);
  const document={protocol:PROTOCOL,epoch:'generation-one',revision:1,editors:{regul:{revision:1,graph:{nodes:[],links:[]}}}};
  viewer.on('session:document',(_,ack)=>ack({ok:true}));
  assert.equal((await send(viewer,'session:document',document)).error,'read_only');
  const received=once(viewer,'session:document');assert.equal((await send(master,'session:document',document)).ok,true);assert.equal((await received).revision,1);
  assert.equal((await new Promise(resolve=>viewer.emit('session:document-request',resolve))).revision,1);
  const late=io(f.origin,{transports:['websocket'],forceNew:true,reconnection:false,auth:{protocol:PROTOCOL,role:'viewer',sessionId:session.sessionId,token:session.inviteToken}});f.clients.push(late);
  const latest=await once(late,'session:document');assert.equal(latest.revision,1);
});

test('édition exclusive : demande au propriétaire, refus, transfert, contrôle réseau et reprise au départ',async t=>{
  let clock=100000;const f=await fixture(t,{now:()=>clock}),room=await(await f.create()).json();
  const master=await f.open('master',room),aux=await f.open('viewer',room),other=await f.open('viewer',room);
  await send(master,'state:frame',frame());
  const action={kind:'cc-edit',mode:'regul',revision:1,graph:{}};
  assert.equal((await send(aux,'command:request',{id:'edit-denied-001',epoch:'generation-one',action,editRevision:1})).error,'edit_required');
  let prompt=once(master,'edit:prompt');assert.equal((await masterRequest(aux)).ok,true);const first=await prompt;
  assert.equal((await send(other,'edit:answer',{id:first.id,accept:true})).ok,false,'un tiers ne peut pas accepter');
  assert.equal((await send(master,'edit:answer',{id:first.id,accept:false})).ok,true);
  clock+=11000;prompt=once(master,'edit:prompt');await masterRequest(aux);const second=await prompt;
  const changed=once(aux,'edit:state');assert.equal((await send(master,'edit:answer',{id:second.id,accept:true})).ok,true);const access=await changed;
  assert.equal(access.owner,aux.id);assert.equal(access.revision,2);
  let applied=0;master.on('command:apply',(_packet,ack)=>{applied++;ack({ok:true});});
  assert.equal((await send(aux,'command:request',{id:'edit-allowed-001',epoch:'generation-one',action,editRevision:access.revision})).ok,true);assert.equal(applied,1);
  assert.equal((await send(other,'command:request',{id:'edit-denied-002',epoch:'generation-one',action,editRevision:access.revision})).error,'edit_required');
  const returned=once(master,'edit:state');aux.disconnect();assert.equal((await returned).owner,'master');
});
const masterRequest=socket=>socket.timeout(3000).emitWithAck('edit:request');
