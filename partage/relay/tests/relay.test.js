'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {io}=require('socket.io-client');
const {createRelay}=require('../server');
const E=require('../../../simulateur/centurion-engine');

async function fixture(t,options={}){
  const relay=createRelay(options),address=await relay.listen();
  const origin=`http://127.0.0.1:${address.port}`,clients=[];
  t.after(async()=>{for(const c of clients)c.disconnect();await relay.close();});
  const create=()=>fetch(origin+'/api/sessions',{method:'POST'});
  const open=async(role,session,proof,authorityId='test-master-authority')=>{
    const socket=io(origin,{transports:['websocket'],forceNew:true,reconnection:false,
      auth:{protocol:1,role,authorityId,sessionId:session.sessionId,token:proof||(role==='master'?session.masterToken:session.inviteToken)}});
    clients.push(socket);
    await new Promise((resolve,reject)=>{socket.once('session:status',resolve);socket.once('connect_error',reject);});return socket;
  };
  return {relay,origin,clients,create,open};
}
function once(socket,name){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Événement absent : '+name)),3000);socket.once(name,value=>{clearTimeout(timer);resolve(value);});});}
const send=(socket,name,value)=>socket.timeout(3000).emitWithAck(name,value);
function frame(model=E.make(),seq=1,epoch='generation-one'){
  return {protocol:1,epoch,seq,time:model.state.time,simulation:{running:true,speed:20,visible:true},instruments:E.instrumentSnapshot(model),core:{dnbr:model.state.dnbr,dpax:model.state.dpaxPctPn}};
}

test('une app sert le simulateur, le tableau auxiliaire et le contrôle de santé sans exposer le dépôt',async t=>{
  const f=await fixture(t);
  for(const url of ['/','/observer','/healthz','/simulateur/centurion.html','/socket.io/socket.io.js'])assert.equal((await fetch(f.origin+url)).status,200,url);
  for(const url of ['/.git/config','/assets/%2e%2e%2fserver.js','/assets/../../server.js'])assert.equal((await fetch(f.origin+url)).status,404,url);
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
  const late=io(f.origin,{transports:['websocket'],forceNew:true,auth:{protocol:1,role:'viewer',sessionId:a.sessionId,token:a.inviteToken}});f.clients.push(late);
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
  const large=frame(E.make(),2,'generation-two');large.extra='x'.repeat(55000);
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
