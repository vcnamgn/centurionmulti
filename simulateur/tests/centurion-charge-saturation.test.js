const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine'),Pzr=require('../centurion-cc-pzr'),State=require('../centurion-state');
const {editorSurface}=require('./helpers/editor-surface'),reference=require('./helpers/reference-model');
const plain=x=>JSON.parse(JSON.stringify(x));
function bench(){
  const m=E.make(),cc=editorSurface('regul',{saved:reference('regul')});
  const pi=cc.state().nodes.find(n=>n.type==='pi'&&n.label==='PI niveau');
  function signals(error,letdown,capacity){return {...E.controlSignals(m),
    pzrLevelSetpointManualSignal:[1,'TOR'],pzrLevelSetpointSignal:[60,'%'],mn1Signal:[60-error,'%'],
    qdecSignal:[letdown,'m³/h'],qchargeCapacitySignal:[capacity,'m³/h']};}
  cc.bridge.receive({type:'centurion-editor-enable',enabled:true,signals:signals(0,36,60)});
  const tick=(error,letdown,capacity,dt=.1)=>cc.bridge.receive({type:'centurion-editor-tick',
    dt,signals:signals(error,letdown,capacity),refresh:false});
  const integral=()=>cc.bridge.receive({type:'centurion-editor-save'}).saved.runtime.find(([id])=>id===pi.id)?.[1].integral;
  return {m,cc,pi,tick,integral};
}

test('PI niveau : ±60, bornes partagées et correction réellement disponible pour 0/1/2/3 orifices',()=>{
  const {cc,pi,tick}=bench();
  assert.equal(pi.params.max,60);assert.equal(pi.params.min,-60);
  assert.equal(pi.params.kp,1.5);assert.equal(pi.params.ki,.08);
  assert.equal(pi.params.externalLimits,'oui');
  for(const [letdown,capacity,correction] of [[36,60,24],[18,60,42],[0,60,60],[36,44,8]]){
    const result=tick(50,letdown,capacity,0);
    assert.equal(cc.state().signals.get(pi.id).value,correction);
    assert.equal(result.outputs.qchargeOut,capacity);
  }
  for(const letdown of [0,18,36,54]){
    const result=tick(-50,letdown,60,0);
    assert.equal(cc.state().signals.get(pi.id).value,-letdown,'la borne externe suit les orifices en service');
    assert.equal(result.outputs.qchargeOut,0,'le niveau haut peut ramener la charge à zéro sans débit négatif');
  }
  assert.equal(tick(50,36,0,0).outputs.qchargeOut,0,'capacité insuffisante : MIN aval prioritaire');
  const limit=cc.state().nodes.find(n=>n.type==='limit'&&n.label==='Limite QCHARGE');
  limit.params.max=40;
  assert.equal(tick(50,18,60,0).outputs.qchargeOut,40,'le plafond modifié est commun au PI et au débit total');
  assert.equal(cc.state().signals.get(pi.id).value,22);
});

test('anti-saturation : intégrale accumulée reprise, capacité 44 à 177 bar et reprise sans maintien de charge maxi',()=>{
  const {cc,pi,tick,integral}=bench();
  const cap=E.rcvPumpCapacityM3h(177);assert.equal(cap,44);
  for(let i=0;i<4500;i++)assert.ok(tick(30,0,60).outputs.qchargeOut<=60);
  assert.ok(integral()>14,'une correction utile s’est accumulée avec les orifices fermés');
  // La reprise de décharge réduit à 8 m³/h la correction disponible.
  for(let i=0;i<600;i++)assert.equal(tick(30,36,cap).outputs.qchargeOut,44);
  assert.ok(integral()<-36,'le suivi vide effectivement l’intégrale ancienne');
  assert.ok(tick(0,36,cap).outputs.qchargeOut<36,'au retour à la consigne, plus de demande maintenue au plafond');
  assert.ok(cc.state().signals.get(pi.id).value>=-36,'la correction reste limitée par la décharge réelle');
});

test('mémoires : pause figée, JSON repris au même sous-pas et ancien graphe v9 mis à jour sans perdre l’intégrale',()=>{
  const {cc,pi,tick,integral,m}=bench();
  for(let i=0;i<100;i++)tick(30,36,44);
  const before=integral();for(let i=0;i<50;i++)tick(30,36,44,0);assert.equal(integral(),before);
  const regul=cc.bridge.receive({type:'centurion-editor-save'}).saved;
  const protect=editorSurface('protect',{saved:reference('protect')}).bridge.receive({type:'centurion-editor-save'}).saved;
  const ui={speed:1,diagram:'pzr',selectedGv:1,activeView:'synoptiques',historyFollowing:true,historyEndS:null,
    historyWindow:'1800',traceSet:'flows',coreTrailWindow:'300',ptTrailWindow:'14400',alarmLimits:{}};
  const raw=State.write(E,m,{regul,protect},ui,null),loaded=State.read(E,JSON.stringify(raw));
  const resumed=editorSurface('regul');resumed.bridge.receive({type:'centurion-editor-restore',saved:loaded.editors.regul});
  const input={...E.controlSignals(m),pzrLevelSetpointManualSignal:[1,'TOR'],pzrLevelSetpointSignal:[60,'%'],
    mn1Signal:[30,'%'],qdecSignal:[36,'m³/h'],qchargeCapacitySignal:[44,'m³/h']};
  const next={type:'centurion-editor-tick',dt:.1,signals:input,refresh:false};
  assert.deepEqual(plain(resumed.bridge.receive(next).outputs),plain(cc.bridge.receive(next).outputs));
  assert.deepEqual(plain(resumed.bridge.receive({type:'centurion-editor-save'}).saved.runtime),
    plain(cc.bridge.receive({type:'centurion-editor-save'}).saved.runtime));
  const old=plain(raw);old.engineRevision='20261009-consignes-v9';
  // Construire la chaîne v9 en retirant seulement l'extension de saturation.
  const graph=old.editors.regul.graph,ids=new Set(graph.nodes.filter(n=>
    ['Capacité pompe RCV','Correction minimale','Correction disponible','Débit réalisable'].includes(n.label)).map(n=>n.id));
  graph.nodes=graph.nodes.filter(n=>!ids.has(n.id));graph.links=graph.links.filter(l=>!ids.has(l.from)&&!ids.has(l.to));
  const sum=graph.nodes.find(n=>n.label==='Débit demandé'),limit=graph.nodes.find(n=>n.label==='Limite QCHARGE');
  const charge=graph.nodes.find(n=>n.type==='qchargeOut'),oldPi=graph.nodes.find(n=>n.id===pi.id);
  oldPi.params.max=15;delete oldPi.params.externalLimits;delete oldPi.params.trackingTimeS;
  graph.links=graph.links.filter(l=>l.to!==limit.id&&!(l.to===pi.id&&l.toPort>0));
  graph.links.push({from:sum.id,to:limit.id,toPort:0},{from:limit.id,to:charge.id,toPort:0});
  old.editors.regul.runtime=old.editors.regul.runtime.filter(([id])=>!ids.has(id));
  const upgraded=State.read(E,old);
  assert.equal(upgraded.editors.regul.graph.nodes.find(n=>n.id===pi.id).params.max,60);
  assert.equal(upgraded.editors.regul.runtime.find(([id])=>id===pi.id)[1].integral,before);
  assert.deepEqual(upgraded.model,plain(m),'stocks et tuyaux conservés');
});

test('bornes externes : entrées débranchées signalées, PI GV et montage personnalisé conservés',()=>{
  const {cc,pi,tick}=bench();
  const state=cc.state(),bound=state.links.find(l=>l.to===pi.id&&l.toPort===2);
  state.links.splice(state.links.indexOf(bound),1);
  const result=tick(20,36,60);
  assert.match(result.diagnostics.join(' '),/PI niveau/);
  assert.equal(result.outputs.qchargeOut,36,'la correction débranchée ne fabrique pas de commande');
  const graph=reference('regul'),gv=graph.nodes.filter(n=>/^PI GV/.test(n.label));
  assert.equal(gv.length,4);assert.ok(gv.every(n=>n.params.max===20&&n.params.externalLimits!=='oui'));
  const custom={nodes:[{id:'N1',type:'pi',label:'Mon PI',x:0,y:0,params:{kp:2,ki:.1,min:-5,max:5}}],links:[],nodeCounter:1};
  const copy=plain(custom);Pzr.upgrade(custom);assert.deepEqual(custom,copy);
});
