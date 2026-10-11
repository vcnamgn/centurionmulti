const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../centurion-engine'),State=require('../centurion-state'),H=require('../centurion-history');
const {editorSurface}=require('./helpers/editor-surface'),{svgSurface}=require('./helpers/svg-surface');
const reference=require('./helpers/reference-model');
const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../centurion.html'),'utf8');
const startup=fs.readFileSync(path.join(__dirname,'centurion-startup.test.js'),'utf8');
const ctx=vm.createContext({E,H,State,app,html,vm,assert,svgSurface,Blob,URL});
vm.runInContext(startup.slice(startup.indexOf('function application('),startup.indexOf('\ntest('))
  +'globalThis.application=application;',ctx);
const plain=x=>JSON.parse(JSON.stringify(x));
const ui={speed:1,diagram:'pzr',selectedGv:1,activeView:'synoptiques',historyFollowing:true,historyEndS:null,
  historyWindow:'1800',traceSet:'flows',coreTrailWindow:'300',ptTrailWindow:'14400',alarmLimits:{}};
const editors=()=>Object.fromEntries(['regul','protect'].map(mode=>[mode,
  editorSurface(mode,{saved:reference(mode)}).bridge.receive({type:'centurion-editor-save'}).saved]));

test('consignes : rampes physiques indépendantes en bar/min et %/min, instantanée et absence de régulateur caché',()=>{
  const m=E.make();m.controls.protectionsEnabled=false;
  E.setManualSetpoint(m,'gcta',70);E.setManualSetpoint(m,'pressure',145);E.setManualSetpoint(m,'level',60);
  assert.equal(m.controls.gctAOpeningPressureBar,88.6,'la cible ne crée aucun échelon');
  E.advance(m,60);
  assert.ok(Math.abs(m.controls.gctAOpeningPressureBar-83.6)<1e-8);
  assert.ok(Math.abs(m.controls.pressureSetpointBar-150)<1e-8);
  assert.ok(Math.abs(m.controls.pzrLevelSetpointPct-46.8)<1e-8);
  assert.equal(m.controls.pressureGraphSprayPct,null,'une consigne seule ne commande pas l’aspersion');
  assert.equal(m.controls.rcvChargeGraphM3h,null,'une consigne seule ne commande pas la charge');
  assert.equal(m.state.heaterKW,E.C.nominalHeaterKW);
  for(const name of ['gcta','pressure','level'])m.controls.setpointRamps[name].rate=null;
  E.setManualSetpoint(m,'gcta',75);E.setManualSetpoint(m,'pressure',140);E.setManualSetpoint(m,'level',50);
  assert.equal(m.controls.gctAOpeningPressureBar,75);
  assert.equal(m.controls.pressureSetpointBar,140);
  assert.equal(m.controls.pzrLevelSetpointPct,50);
  assert.equal(E.setManualSetpoint(m,'inconnu',0),false);
  assert.equal(E.setManualSetpoint(m,'pressure',NaN),false);
});

test('GCT-A : pente lente 0,25 bar/min, application et sauvegarde de la rampe',()=>{
  const m=E.make();m.controls.protectionsEnabled=false;
  m.controls.setpointRamps.gcta.rate=0.25;E.setManualSetpoint(m,'gcta',70);
  E.advance(m,60);
  assert.ok(Math.abs(m.controls.gctAOpeningPressureBar-88.35)<1e-8);
  const saved=State.write(E,m,editors(),ui,null);
  const restored=State.read(E,saved).model;
  assert.equal(restored.controls.setpointRamps.gcta.rate,0.25);
  assert.equal(restored.controls.setpointRamps.gcta.target,70);
});

test('RCI du vrai graphe : référence manuelle dans les sommateurs, sorties physiques et retour auto',()=>{
  const m=E.make(),cc=editorSurface('regul',{saved:reference('regul')});
  const page=ctx.application(app,null,{...E,make:()=>m},{regulationEditor:cc.bridge});
  page.get('primaryPressureSetpointRate').value='instant';page.get('primaryPressureSetpointRate').fire('change');
  page.get('pzrLevelSetpointRate').value='instant';page.get('pzrLevelSetpointRate').fire('change');
  page.get('primaryPressureSetpoint').value='151';page.get('primaryPressureSetpoint').fire('input');
  page.get('pzrLevelSetpoint').value='60';page.get('pzrLevelSetpoint').fire('input');
  page.click('toggleRegulationSynoptic');page.frame(200);
  assert.equal(m.controls.prefGraphBar,151);assert.equal(m.controls.nrefGraphPct,60);
  assert.equal(m.state.prefBar,151);assert.equal(m.state.nrefPct,60);
  assert.ok(m.controls.pressureGraphSprayPct>60,'155 − 151 = 4 bar : demande d’aspersion');
  assert.equal(m.controls.pressureGraphHeaterKW,0);
  assert.ok(m.controls.rcvChargeGraphM3h>36,'niveau demandé 60 % : augmentation de charge');
  assert.match(cc.get('regPref').textContent,/151/);assert.match(cc.get('regSpeedPct').textContent,/60/);
  const relay=cc.state().nodes.find(n=>n.type==='rci'&&n.params.setpoint==='pressure');
  assert.deepEqual(plain(cc.state().signals.get(relay.id)),{value:151,unit:'bar abs.'});
  page.get('primaryPressureSetpointManual').checked=false;page.get('primaryPressureSetpointManual').fire('change');
  page.get('pzrLevelSetpointManual').checked=false;page.get('pzrLevelSetpointManual').fire('change');
  assert.equal(m.controls.prefGraphBar,155);assert.ok(Math.abs(m.controls.nrefGraphPct-41.8)<1e-6);
  assert.equal(page.get('primaryPressureSetpoint').disabled,false,'la consigne reste disponible avec CC actif');
});

test('bas niveau PZR : fermeture CC sous 15 %, hystérésis, décharge nulle et sélection restituée',()=>{
  const m=E.make(),cc=editorSurface('regul',{saved:reference('regul')});
  const page=ctx.application(app,null,{...E,make:()=>m},{regulationEditor:cc.bridge});
  page.click('toggleRegulationSynoptic');
  function command(level){
    m.state.pzrLevelPct=level;
    const output=cc.bridge.receive({type:'centurion-editor-tick',dt:.1,signals:E.controlSignals(m)});
    page.receive(output);
  }
  command(14.9);page.frame(200);
  assert.equal(m.controls.rcvLetdownCloseGraph,true);
  assert.equal(E.rcvLetdownM3h(m),0);
  assert.deepEqual(m.controls.rcvLetdownOrifices,[true,true,false]);
  assert.equal(page.query('[data-rcv-orifice="0"]').checked,false);
  assert.equal(page.query('[data-rcv-orifice="0"]').disabled,true);
  assert.match(page.get('rcvOrificeStatus0').textContent,/CC/);
  E.step(m,.1);assert.equal(m.state.rcvLetdownKgS,0,'fermeture réellement prise dans le bilan de masse');
  command(16);assert.equal(m.controls.rcvLetdownCloseGraph,true);
  command(17);assert.equal(m.controls.rcvLetdownCloseGraph,true);
  command(17.1);assert.equal(m.controls.rcvLetdownCloseGraph,false);
  assert.equal(E.rcvLetdownM3h(m),36);
  command(14);page.click('toggleRegulationSynoptic');
  assert.equal(m.controls.rcvLetdownCloseGraph,null);assert.equal(E.rcvLetdownM3h(m),36);
  assert.equal(page.query('[data-rcv-orifice="0"]').checked,true);
  assert.equal(page.query('[data-rcv-orifice="0"]').disabled,false);
});

test('pupitre : trois rampes suivent le temps simulé, pause figée et molette immédiate',()=>{
  const m=E.make(),cc=editorSurface('regul',{saved:reference('regul')});
  const page=ctx.application(app,null,{...E,make:()=>m},{regulationEditor:cc.bridge});
  page.click('toggleRegulationSynoptic');
  for(const [id,value] of [['gctaOpeningPressure',85],['primaryPressureSetpoint',154],['pzrLevelSetpoint',43]]){
    assert.equal(page.get(id+'Rate').value,'5');
    page.get(id).value=String(value);page.get(id).fire('input');
  }
  page.frame(1000);assert.equal(m.state.time,0);assert.equal(m.controls.gctAOpeningPressureBar,88.6);
  page.get('simSpeed').value='20';page.get('simSpeed').fire('change');page.click('runButton');
  for(let i=0;i<10;i++)page.frame(100);
  const elapsed=m.state.time;assert.ok(elapsed>0);
  assert.ok(Math.abs(m.controls.gctAOpeningPressureBar-(88.6-5*elapsed/60))<1e-8);
  assert.ok(Math.abs(m.controls.pressureSetpointBar-Math.max(154,155-5*elapsed/60))<1e-8);
  assert.ok(Math.abs(m.controls.pzrLevelSetpointPct-Math.min(43,41.8+5*elapsed/60))<1e-8);
  assert.equal(Number(page.get('gctaOpeningPressure').value),85,'le champ conserve la cible');
  assert.match(page.get('gctaOpeningPressureProgress').textContent,/→ 85/);
  page.click('runButton');const paused=plain(m.controls.setpointRamps);
  page.frame(1000);assert.equal(m.state.time,elapsed);assert.deepEqual(m.controls.setpointRamps,paused);
  page.get('primaryPressureSetpointRate').value='instant';page.get('primaryPressureSetpointRate').fire('change');
  page.get('primaryPressureSetpoint').fire('wheel',{deltaY:-1});
  assert.ok(Math.abs(m.controls.pressureSetpointBar-154.1)<1e-8);
  assert.equal(m.controls.prefGraphBar,154.1,'molette prise en compte dans le RCI en pause');
});

test('sauvegarde : rampes et fermeture reprises exactement ; ancien état v8 migré sans perdre les stocks',()=>{
  const m=E.make();m.controls.protectionsEnabled=false;
  E.setManualSetpoint(m,'gcta',65);E.setManualSetpoint(m,'pressure',130);E.setManualSetpoint(m,'level',55);
  E.advance(m,2);m.controls.rcvLetdownCloseGraph=true;
  const raw=State.write(E,m,editors(),ui,null),loaded=State.read(E,raw);
  assert.deepEqual(loaded.model,plain(m));
  E.step(m,.1);E.step(loaded.model,.1);assert.deepEqual(loaded.model,m);
  const old=State.write(E,E.make(),editors(),ui,null);old.engineRevision='20261009-pzr-breche-v8';
  const previous=plain(old.model);
  for(const key of ['pressureSetpointBar','pressureSetpointManual','pzrLevelSetpointPct','pzrLevelSetpointManual',
    'setpointRamps','prefGraphBar','rcvLetdownCloseGraph'])delete old.model.controls[key];
  delete old.model.state.prefBar;
  old.editors.regul.graph=JSON.parse(fs.readFileSync(path.join(__dirname,'../modele-de-regulation.simurep_complet.json'),'utf8'));
  old.editors.regul.runtime=[];old.editors.regul.lastSignals=[];
  const migrated=State.read(E,old);
  assert.equal(migrated.model.state.primaryMassKg,previous.state.primaryMassKg);
  assert.equal(migrated.model.state.pressureBar,previous.state.pressureBar);
  assert.deepEqual(migrated.model.state.rcvPipe,previous.state.rcvPipe);
  assert.equal(migrated.editors.regul.graph.nodes.filter(n=>n.type==='rci').length,2);
  assert.equal(migrated.editors.regul.graph.nodes.filter(n=>n.type==='rcvLetdownCloseOut').length,1);
  const invalid=plain(raw);invalid.model.controls.setpointRamps.pressure.rate=-2;
  assert.throws(()=>State.read(E,invalid),/Pente pressure/);
});

test('extensions PZR : migration idempotente, exercice personnalisé et retrait volontaire conservés',()=>{
  const Pzr=require('../centurion-cc-pzr'),provided=reference('regul');
  const stable=plain(provided);Pzr.upgrade(provided);assert.deepEqual(provided,stable);
  const removed=plain(provided),output=removed.nodes.find(n=>n.type==='rcvLetdownCloseOut');
  removed.nodes=removed.nodes.filter(n=>n.id!==output.id);
  removed.links=removed.links.filter(l=>l.to!==output.id&&l.from!==output.id);
  const student=plain(removed);Pzr.upgrade(removed);assert.deepEqual(removed,student,'ne pas reconstruire un bloc supprimé');
  const custom={nodes:[
    {id:'N1',type:'curve',label:'Mon programme',params:{curveRole:'nref'},x:0,y:0},
    {id:'N2',type:'nrefOut',label:'NREF',params:{},x:250,y:0},
    {id:'N3',type:'pi',label:'Correcteur PI',params:{},x:500,y:0},
    {id:'N4',type:'qchargeOut',label:'QCHARGE',params:{},x:750,y:0}],
    links:[{from:'N1',to:'N2',toPort:0},{from:'N2',to:'N3',toPort:0},{from:'N3',to:'N4',toPort:0}],nodeCounter:4};
  const initial=plain(custom);Pzr.upgrade(custom);assert.deepEqual(custom,initial);
});
