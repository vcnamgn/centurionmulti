const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../centurion-engine.js');
const html = fs.readFileSync(path.join(__dirname,'../centurion-cc-regul.html'),'utf8');

function appSignals(model) {
  const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
  const source=app.slice(app.indexOf('  function editorSignals()'),app.indexOf('  function sendEditorTick('));
  const context=vm.createContext({E,model});
  vm.runInContext(source+';globalThis.values=editorSignals();',context);
  return context.values;
}

test('toutes les sources CC reçoivent le moteur Centurion, sans repli sur le simulateur historique',()=>{
  const m=E.make(),{cc}=editor('protect');
  Object.assign(m.state,{dnbr:.62,subcoolingC:1.3,heaterKW:415,sprayPct:12.7,pzrLevelPct:7.5});
  const values=appSignals(m);cc.setSignals(values);
  for(const type of cc.sensorTypes()){
    assert.ok(values[type],`source ${type} oubliée par l'application`);
    assert.ok(Number.isFinite(values[type][0]),type);
    assert.equal(cc.source(type).value,values[type][0],type);
    assert.equal(cc.source(type).unit,values[type][1],type);
  }
  assert.equal(cc.source('dnbrSignal').value,.62);
  assert.equal(cc.source('tsubSignal').value,1.3);
  assert.equal(cc.source('imchSignal').value,50);
  assert.equal(cc.display('qaspOut'),'12,7 %');
  assert.equal(cc.display('pchauffOut'),'415,0 kW');
  assert.equal(values.pchauffSignal[0],415);
});

test('liaisons complètes CC → actionneurs → moteur → synoptiques et signaux de retour',()=>{
  const {svgSurface}=require('./helpers/svg-surface');
  const m=E.make(),{cc}=editor('regul',true),protect=editor('protect').cc;
  m.controls.protectionsEnabled=false;m.controls.protectionGraphMode=true;
  const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
  const ctx=vm.createContext({E,model:m,regulationActive:true,protectionActive:true});
  vm.runInContext(app.slice(app.indexOf('  function applyEditorOutputs('),app.indexOf('  function bindControls('))
    +'globalThis.apply=applyEditorOutputs;',ctx);
  const rcp=svgSurface('synoptique-RCP-1300.svg'),pzr=svgSurface('synoptique-RCPPZR-1300.svg');
  const gv=svgSurface('synoptique-RCPGV-1300.svg');
  const apply=(mode,outputs)=>ctx.apply({mode,enabled:true,
    outputs:Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,v.value]))});
  const check=()=>{
    const s=m.state,v=E.instrumentSnapshot(m,2),signals=appSignals(m);
    rcp.update(v);pzr.update(v);gv.update(v);cc.setSignals(signals);protect.setSignals(signals);
    assert.equal(rcp.get('coeur-0-valeur').getAttribute('data-current-value'),String(cc.source('pow1').value));
    assert.equal(pzr.get('002MP-valeur').getAttribute('data-current-value'),String(protect.source('mp1Signal').value));
    assert.equal(rcp.get('texte-17').getAttribute('data-current-value'),String(signals.posgSignal[0]));
    assert.equal(pzr.get('003MN-valeur').getAttribute('data-current-value'),String(signals.mn1Signal[0]));
    assert.equal(pzr.get('006MT-valeur').getAttribute('data-current-value'),String(signals.tpzrSignal[0]));
    assert.equal(rcp.get('coeur-4-valeur').getAttribute('data-current-value'),String(signals.tmoy[0]));
    assert.equal(rcp.get('texte-193').getAttribute('data-current-value'),String(signals.qchaSignal[0]));
    assert.equal(rcp.get('texte-196').getAttribute('data-current-value'),String(signals.qdecSignal[0]));
    assert.equal(gv.get('105MN-valeur').getAttribute('data-current-value'),String(signals.gv2LevelSignal[0]));
    assert.equal(gv.get('vapeur-total').getAttribute('data-current-value'),String(signals.gv2SteamSignal[0]));
    assert.equal(pzr.get('004KM-valeur').getAttribute('data-current-value'),String(s.heaterKW));
    assert.equal(pzr.get('201KM-valeur').getAttribute('data-current-value'),String(s.sprayPct));
    assert.equal(gv.get('are130vl').getAttribute('data-opening-pct'),String(s.gv[1].feedValvePct));
  };
  E.startTransient(m,'pilotage');
  for(let t=0;t<30;t+=.25){
    if(t===10){m.state.pressureBar=158.5;m.state.pzrThermalPressureBar=158.5;}
    cc.setSignals(appSignals(m));apply('regul',cc.evaluate(.25,true).outputs);
    E.advance(m,.25);check();
  }
  assert.ok(m.state.g3Count<780,'la courbe G3 du vrai CC déplace les groupes');
  assert.ok(m.controls.pressureGraphSprayPct!==null,'le vrai CC pilote l’aspersion');
  assert.equal(m.state.heaterKW,m.controls.pressureGraphHeaterKW);
  m.state.pressureBar=80;protect.setSignals(appSignals(m));
  const requests=protect.evaluate(.1,true).outputs;
  assert.equal(requests.aarOut.value,1);assert.equal(requests.risOut.value,1);
  apply('protect',requests);
  require('./helpers/liquid-primary-point')(E,m,80);
  // Maintenir le point hydraulique pour isoler ici le transit et les liaisons.
  for(let i=0;i<800;i++){
    m.state.pressureBar=80;m.state.pzrThermalPressureBar=80;E.step(m,.1);
  }
  check();
  assert.notEqual(m.state.tripAt,null);assert.notEqual(m.state.risAt,null);
  assert.equal(m.state.rods.R,0);assert.ok(m.state.risDeliveredKgS>0);
  assert.equal(rcp.get('texte-20').textContent,'—');
  assert.doesNotMatch(m.state.primaryPumpStopReason||'',/injection de sécurité|ordre IS/i);
  assert.equal(rcp.get('gmpp-2').getAttribute('data-pump-state'),m.state.primaryPumpsStopped?'stopped':'running',
    'état réel après le point de pression imposé ; IS ne commande pas les GMPP');
  Object.assign(m,E.make()); // Isoler l'arrêt manuel depuis un état amorcé.
  E.tripPrimaryPumps(m);check();
  assert.equal(rcp.get('gmpp-2').getAttribute('data-pump-state'),'coasting','commande manuelle et décélération reflétées dans le SVG');
});

test('baisse 100 → 80 % avec les vrais CC : débit nominal malgré la baisse régulée du niveau PZR',()=>{
  const m=E.make(),cc=editor('regul',true).cc,protect=editor('protect').cc;
  m.controls.protectionGraphMode=true;
  const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
  const ctx=vm.createContext({E,model:m,regulationActive:true,protectionActive:true});
  vm.runInContext(app.slice(app.indexOf('  function applyEditorOutputs('),app.indexOf('  function bindControls('))
    +'globalThis.apply=applyEditorOutputs;',ctx);
  const apply=(mode,outputs)=>ctx.apply({mode,enabled:true,
    outputs:Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,v.value]))});
  for(let t=0;t<1800;t+=.5){
    if(t===10)m.controls.demandPct=80;
    const signals=E.controlSignals(m);cc.setSignals(signals);protect.setSignals(signals);
    apply('regul',cc.evaluate(.5,true).outputs);apply('protect',protect.evaluate(.5,true).outputs);
    E.advance(m,.5);
    assert.equal(m.state.tripAt,null,'pas d’AAR pendant la baisse de charge');
    assert.equal(m.state.coreFlowFraction,1,'QPRI reste à 100 % avec les GMPP en marche');
    assert.ok(m.state.loops.every(l=>l.forcedFlowKgS===E.C.nominalPrimaryFlowKgS/4));
  }
  assert.ok(m.state.pzrLevelPct<40,'le niveau PZR baisse avec la charge');
  // Vérifier aussi le point bas de l'ancien défaut, indépendamment du
  // temps de réponse des GV et de la bande morte du correcteur de température.
  const removedKg=2000,waterC=m.state.tavgC;
  m.state.primaryMassKg-=removedKg;
  m.state.boronInventory-=removedKg*m.state.boronPpm;
  m.state.primaryEnergyJ-=removedKg*E.C.primaryCpJkgK*waterC;
  E.step(m,.1);
  assert.ok(m.state.pzrLevelPct<35,'réserve PZR basse, boucles toujours pleines');
  assert.deepEqual(m.state.inventory.loopPriming,[1,1,1,1]);
  const snapshot=E.instrumentSnapshot(m);
  assert.ok(snapshot.loops.every(l=>l.flowPct===100));
  assert.equal(E.controlSignals(m).qpriSignal[0],100);
});

// Exécuter les fonctions du véritable éditeur, sans son interface DOM.
function editorFunction(name) {
  const start=html.indexOf(`    function ${name}(`);
  assert.ok(start>=0, name);
  const tail=html.slice(start);
  const end=/\n    }\r?\n/.exec(tail);
  assert.ok(end, name);
  return tail.slice(0,end.index+6);
}
function editor(mode='protect',fullGraph=false) {
  // Les essais physiques chargent explicitement la correction complète ;
  // le démarrage des ateliers étudiants est testé sur la page entière.
  const baseModelText=JSON.stringify(require('./helpers/reference-model')(mode));
  const context=vm.createContext({console,baseModelText,PzrCommands:require('../centurion-cc-pzr')});
  const specs=html.slice(html.indexOf('    const BLOCK_TYPES ='),html.indexOf('    const SPECIAL_CURVE_PRESETS ='));
  const functions=['regSignalDisplay','regSourceSignal','compareOperatorValue','runtimeStateFor',
    'evaluateRegulationGraph','formatRegLinkSignal','regInputKey','resetRegRuntime',
    'migrateCenturionRegulation','migrateCenturionTemperature','migrateCenturionProtection','centurionDefaultModel',
    'normalizedCurvePoints','applyEditableCurve','initialIntegratorValue','hasRegPath',
    'integratedUnit','productUnit','applyG1Curve','applyG2Curve']
    .map(editorFunction).join('\n');
  vm.runInContext(`
    const CENTURION_EDITOR_MODE='${mode}', REG_MODEL_FORMAT='SimuREP-Regulation', REG_MODEL_VERSION=1;
    const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    const fmt=(v,d)=>Number(v).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
    const C={PNOM:3817}; const s=new Proxy({power:3817},{get:(o,k)=>o[k]??0});
    const maximumLinearPower=()=>0;
    let regNodes=[],regLinks=[],regRuntimeStates=new Map(),regLastSignals=new Map(),regLastDiagnostics=[];
    let centurionInput=null;
    const REG_MANUAL_OUTPUT_TYPES=new Set(['aarOut','risOut','asgOut','gv1Out','gv2Out','gv3Out','gv4Out',
      'posg','g3Out','nrefOut','pchauffOut','qaspOut','qchargeOut','rcvLetdownCloseOut']);
    const $=()=>({textContent:baseModelText});
    const window={parent:{},CenturionPzrCommands:PzrCommands};
    ${specs}
    ${functions}
    globalThis.cc={
      setInput:(power)=>{centurionInput={signals:{pow1:[power,'% PN'],mp1Signal:[155,'bar abs.'],voltageSignal:[0,'TOR']}};},
      setSignals:(signals,rManualOverride=false)=>{centurionInput={signals,rManualOverride};},
      setModel:(model)=>{regNodes=model.nodes;regLinks=model.links;resetRegRuntime();},
      evaluate:evaluateRegulationGraph,display:regSignalDisplay,source:regSourceSignal,
      reset:resetRegRuntime,migrate:migrateCenturionProtection,
      migrateRegulation:migrateCenturionRegulation,defaults:centurionDefaultModel,
      format:formatRegLinkSignal,
      sensorTypes:()=>Object.keys(BLOCK_TYPES).filter(key=>BLOCK_TYPES[key].role==='sensor')
    };
  `,context);
  const cc=context.cc;
  const model=JSON.parse(baseModelText);if(fullGraph)cc.migrateRegulation(model);
  cc.setModel(model);cc.setInput(100);
  return {cc,model};
}

test('PZR : les lois CC rattrapent les rampes thermiques 100↔15 à 50 points PN/min',()=>{
  const m=E.make(),{cc}=editor('regul',true),s=m.state;
  const mass=s.primaryMassKg,dt=.1;
  const stats={};
  function tick(tempC,label){
    const before={massKg:mass,vaporKg:0,tempC:s.tavgC,pressureBar:s.pressureBar};
    cc.setSignals(E.controlSignals(m));
    const outputs=cc.evaluate(dt,true).outputs;
    s.heaterKW=outputs.pchauffOut.value;
    s.sprayPct+=Math.max(-5,Math.min(5,outputs.qaspOut.value-s.sprayPct));
    // Banc de la boucle pression : TMOY est imposée selon le programme
    // thermique. Ne remplace pas un essai global neutronique/turbine.
    const load=(tempC-297.2)/9.3,coreMW=E.C.nominalThermalMW*load;
    const coldC=tempC-coreMW*1e6/(2*E.C.nominalPrimaryFlowKgS*E.C.primaryCpJkgK);
    const sprayKgS=(250*s.sprayPct/100+.46)*E.liquidWaterDensityKgM3(coldC,s.pressureBar)/3600;
    const netHeat=(s.heaterKW-E.C.pzrPassiveTransferKW)/1000
      -sprayKgS*E.C.primaryCpJkgK*(E.saturationTemperatureC(s.pressureBar)-coldC)/1e6;
    const result=E.advancePrimaryPressure(before,mass,mass*E.C.primaryCpJkgK*tempC,
      netHeat,0,s.pzrThermalPressureBar,s.pzrLevelPct,dt);
    s.pressureBar=result.pressureBar;s.pzrThermalPressureBar=result.thermalPressureBar;s.tavgC=tempC;
    s.inventory=E.cppInventory(mass,tempC,s.pressureBar);s.pzrLevelPct=s.inventory.components.pzr.fillPct;
    const a=stats[label]??={min:Infinity,max:-Infinity};
    a.min=Math.min(a.min,s.pressureBar);a.max=Math.max(a.max,s.pressureBar);a.final=s.pressureBar;
    assert.ok(s.inventory.overfillKg<.001,'aucune masse effacée ou excès géométrique');
  }
  for(let i=0;i<102/dt;i++)tick(306.5-7.905*(i+1)*dt/102,'down');
  for(let i=0;i<600/dt;i++)tick(298.595,'hold15');
  for(let i=0;i<102/dt;i++)tick(298.595+7.905*(i+1)*dt/102,'up');
  for(let i=0;i<600/dt;i++)tick(306.5,'hold100');
  assert.ok(stats.down.min>145&&stats.down.max<161,'contraction rattrapable sans seuil bas pression');
  assert.ok(stats.up.max<161,'dilatation contrôlée avant les soupapes à 166 bar');
  assert.ok(Math.abs(stats.hold15.final-155)<1,'pression récupérée par les chaufferettes');
  assert.ok(Math.abs(stats.hold100.final-155)<1,'pression récupérée par l’aspersion');
});

test('température : compensation REF-01 à gain statique unitaire, réponse dynamique et pause',()=>{
  const {cc}=editor('regul');
  const source={id:'E',type:'constant',params:{value:3,unit:'°C'}};
  const lead={id:'L',type:'leadlag',params:{tauZero:50,tauPole:6.7}};
  cc.setModel({nodes:[source,lead],links:[{from:'E',to:'L',toPort:0}]});
  const value=dt=>cc.evaluate(dt,true).signals.get('L').value;
  assert.equal(value(0),3,'initialisation sans saut à entrée constante');
  source.params.value=7;
  const expected=7+4*(50/6.7-1)*Math.exp(-1/6.7);
  assert.ok(Math.abs(value(1)-expected)<1e-10,'réponse analytique à un échelon');
  const held=value(0);
  assert.equal(cc.evaluate(60,false).signals.get('L').value,held,'aucune évolution en pause');
  for(let i=0;i<300;i++)value(1);
  assert.ok(Math.abs(value(1)-7)<1e-10,'gain statique égal à 1');
});

test('température : hystérésis 0,83/0,55 et vitesse R 8–72 pas/min, insertion et extraction',()=>{
  const {cc,model}=editor('regul',true);
  const gate=model.nodes.find(n=>n.type==='deadband'&&n.params.mode==='entrée entière');
  const speed=model.nodes.find(n=>n.type==='curve'&&n.params.curveRole==='rodSpeed');
  assert.ok(gate&&speed);
  const source={id:'E',type:'constant',params:{value:0,unit:'°C'}};
  cc.setModel({nodes:[source,gate,speed],links:[
    {from:'E',to:gate.id,toPort:0},{from:gate.id,to:speed.id,toPort:0}]});
  for(const [error,expected] of [[.82,0],[.84,-8],[.7,-8],[.56,-8],[.54,0],
      [-.84,8],[-.7,8],[-.54,0],[2,-24],[2.8,-72],[5,-72],[-2,24],[-5,72]]){
    source.params.value=error;
    const actual=cc.evaluate(.1,true).signals.get(speed.id);
    assert.ok(Math.abs(actual.value-expected)<1e-8,`${error} °C : ${actual.value} pas/min`);
    assert.equal(actual.unit,'pas/min');
  }
});

test('température : anciennes sauvegardes mises à jour une seule fois et paramètres personnalisés conservés',()=>{
  const fixture=fs.readFileSync(path.join(__dirname,'fixtures/cc-regul-legacy.json'),'utf8');
  const legacy=JSON.parse(fixture);
  const {cc}=editor('regul');cc.migrateRegulation(legacy);
  assert.equal(legacy.nodes.find(n=>n.id==='N7').params.tau,50);
  assert.equal(legacy.nodes.find(n=>n.id==='N8').params.points.find(p=>p.x===1).y,.4);
  assert.equal(legacy.nodes.find(n=>n.id==='N9').params.points[0].y,4);
  assert.equal(legacy.nodes.find(n=>n.id==='N13').params.yUnit,'pas/min');
  assert.equal(legacy.nodes.filter(n=>n.type==='leadlag').length,1);
  assert.ok(legacy.nodes.some(n=>n.type==='filter'&&n.params.tau===60));
  assert.equal(new Set(legacy.nodes.map(n=>n.id)).size,legacy.nodes.length);
  const migrated=JSON.stringify(legacy);cc.migrateRegulation(legacy);
  assert.equal(JSON.stringify(legacy),migrated,'migration idempotente');
  const own=JSON.parse(fixture);
  own.nodes.find(n=>n.id==='N8').params.points[4].y=.7;
  own.nodes.find(n=>n.id==='N9').params.points[0].y=5;
  own.nodes.find(n=>n.id==='N7').params.tau=33;
  own.nodes.find(n=>n.id==='N13').params.k=-17;
  own.nodes.find(n=>n.id==='N12').params.width=1.1;
  cc.migrateRegulation(own);
  assert.equal(own.nodes.find(n=>n.id==='N8').params.points[4].y,.7);
  assert.equal(own.nodes.find(n=>n.id==='N9').params.points[0].y,5);
  assert.equal(own.nodes.find(n=>n.id==='N7').params.tau,33);
  assert.equal(own.nodes.find(n=>n.id==='N13').params.k,-17);
  assert.equal(own.nodes.find(n=>n.id==='N12').params.width,1.1);
});

test('transitoire 6 corrigé : boucle stable à 10 % PN, indépendamment du surplus de xénon',()=>{
  for(const dt of [.5,15]){
    const m=E.make(),{cc}=editor('regul',true),protect=editor('protect').cc;
    // Réglage disponible dans le modèle : isoler la boucle de température
    // du besoin de dilution. Les masses, G3, poids des grappes et αM/αD restent réels.
    m.controls.xenonEquilibriumWorthPcm=0;m.controls.protectionGraphMode=true;
    const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
    const ctx=vm.createContext({E,model:m,regulationActive:true,protectionActive:true});
    vm.runInContext(app.slice(app.indexOf('  function applyEditorOutputs('),app.indexOf('  function bindControls('))
      +'globalThis.apply=applyEditorOutputs;',ctx);
    const apply=(mode,outputs)=>ctx.apply({mode,enabled:true,
      outputs:Object.fromEntries(Object.entries(outputs).map(([k,v])=>[k,v.value]))});
    const tail=[];E.startTransient(m,'pilotage');
    for(let t=0;t<2280;t+=dt){
      const signals=E.controlSignals(m);cc.setSignals(signals);protect.setSignals(signals);
      apply('regul',cc.evaluate(dt,true).outputs);apply('protect',protect.evaluate(dt,true).outputs);
      E.advance(m,dt);
      assert.equal(m.state.tripAt,null,`${dt} s : pas d'AAR pendant le programme`);
      assert.equal(m.state.endState,null,`${dt} s : scénario poursuivi`);
      if(m.state.time>1680)tail.push({T:m.state.tavgC,P:m.state.powerPct});
    }
    const span=key=>Math.max(...tail.map(r=>r[key]))-Math.min(...tail.map(r=>r[key]));
    assert.ok(span('T')<.5,`${dt} s : étendue TMOY ${span('T')} °C, sous la bande morte`);
    assert.ok(span('P')<.5,`${dt} s : étendue puissance ${span('P')} % PN`);
    assert.ok(Math.abs(m.state.tavgC-m.state.trefC)<.6,'température dans la bande de régulation');
    assert.ok(m.state.rods.R>190&&m.state.rods.R<220,'R stabilisé avec marge de manœuvre');
    assert.deepEqual(m.controls.rodWorthPcm,{...E.ROD_WORTH_PCM});
    assert.equal(m.controls.coolantWorthPcmC,-30);assert.equal(m.controls.dopplerWorthPcmC,-2.6);
    assert.equal(m.state.coreFlowFraction,1);
  }
});

test('POW1 à 135 % traverse application, source, affichage et comparateur de protection', () => {
  const m=E.make();m.state.powerPct=135;
  const values=appSignals(m);
  assert.equal(values.pow1[0],135);
  const {cc,model}=editor();cc.setInput(values.pow1[0]);
  assert.equal(cc.source('pow1').value,135);
  assert.match(cc.display('pow1'),/135,0.*% PN/);
  const evaluation=cc.evaluate(0.1,true);
  const flux=model.nodes.find(n=>n.type==='pow1');
  assert.equal(evaluation.signals.get(flux.id).value,135);
  assert.equal(evaluation.outputs.aarOut.value,1);
});

test('signaux vapeur du CC : chaque GV et MD1 incluent le débit GCT-A', () => {
  const m=E.make();m.controls.protectionsEnabled=false;
  const hot=m.state.gv[3];hot.tempC=E.C.gctATempC+1;hot.pressureBar=E.saturationPressureBar(hot.tempC);
  E.step(m,0.1);
  const signals=appSignals(m);
  assert.ok(hot.dumpKgS>0);
  m.state.gv.forEach((g,i)=>{
    assert.equal(signals[`gv${i+1}SteamSignal`][0],g.turbineSteamKgS+g.dumpKgS);
    assert.equal(signals[`gv${i+1}SteamSignal`][1],'kg/s');
  });
  const total=m.state.gv.reduce((q,g)=>q+g.turbineSteamKgS+g.dumpKgS,0);
  assert.ok(Math.abs(signals.md1Signal[0]*1000-total)<1e-9);
});

test('un graphe CC-RÉGUL sauvegardé adopte le débit RCV nominal de 36 m³/h', () => {
  const {cc}=editor('regul');
  const saved={nodes:[
    {id:'N1',type:'qdecOut',label:'QDEC',params:{}},
    {id:'N2',type:'qchaSignal',label:'QCHA',params:{}},
    {id:'N3',type:'limit',label:'Limite QDEC',params:{min:0,max:30}}
  ],links:[],nodeCounter:3};
  cc.migrateRegulation(saved);
  assert.equal(saved.nodes[0].type,'qchargeOut');
  assert.equal(saved.nodes[1].type,'qdecSignal');
  assert.match(saved.nodes[1].label,/orifices/);
  assert.equal(saved.nodes[2].params.min,6);
  assert.equal(saved.nodes[2].params.max,36);
  const embedded=/id="solutionDataComplete">([^<]+)<\/script>/.exec(html);
  assert.ok(embedded);
  const complete=JSON.parse(embedded[1]);
  cc.migrateRegulation(complete);
  const limit=complete.nodes.find(node=>node.label==='Limite QCHARGE');
  assert.equal(limit.params.max,60);
});

test('la régulation de charge reçoit le débit réel des orifices et respecte le maximum de la pompe',()=>{
  for(const [qdec,expected] of [[18,18],[36,36],[54,54]]){
    const {cc}=editor('regul',true),m=E.make();
    m.state.pzrLevelPct=41.8;
    m.state.rcvLetdownKgS=qdec*E.liquidWaterDensityKgM3(m.state.tavgC,m.state.pressureBar)/3600;
    cc.setSignals(appSignals(m));
    assert.ok(Math.abs(cc.evaluate(0,true).outputs.qchargeOut.value-expected)<1e-8);
  }
});

test('dérivateur : démarrage sans impulsion, rampe positive et négative en % PN/s', () => {
  for (const slope of [2,-2]) {
    const {cc,model}=editor();
    const derivative=model.nodes.find(n=>n.type==='derivative');
    cc.evaluate(0.1,true);
    for(let i=1;i<=40;i++){
      cc.setInput(100+slope*i*0.1);
      const evaluation=cc.evaluate(0.1,true);
      const out=evaluation.signals.get(derivative.id);
      assert.equal(out.unit,'% PN/s');
      if(i===40)assert.ok(Math.abs(out.value-slope)<0.002);
      assert.equal(evaluation.outputs.aarOut.value,0);
    }
  }
});

test('dérivateur : forte baisse, pause et réinitialisation sans nouveau pic', () => {
  const {cc,model}=editor();const id=model.nodes.find(n=>n.type==='derivative').id;
  assert.equal(cc.evaluate(0.1,true).signals.get(id).value,0);
  cc.setInput(80);
  const stepped=cc.evaluate(0.1,true);
  assert.ok(stepped.signals.get(id).value<-5);
  assert.equal(stepped.outputs.aarOut.value,1);
  const frozen=stepped.signals.get(id).value;
  cc.setInput(70);
  assert.equal(cc.evaluate(0,false).signals.get(id).value,frozen);
  cc.reset();
  assert.equal(cc.evaluate(0.1,true).signals.get(id).value,0);
  assert.equal(cc.evaluate(0.1,true).outputs.aarOut.value,0);
});

test('migration des protections sauvegardées : remplacer la source magique et conserver les seuils', () => {
  const {cc}=editor();
  const model={nodes:[{id:'N1',type:'pow1',params:{}},
    {id:'N2',type:'fluxRateSignal',label:'Ancien débit flux',x:230,y:100},
    {id:'N3',type:'compare',params:{threshold:7}}],
    links:[{from:'N2',to:'N3',toPort:0}],nodeCounter:3};
  cc.migrate(model);cc.migrate(model);
  assert.equal(model.nodes[1].type,'derivative');
  assert.equal(model.nodes[1].params.tau,0.5);
  assert.equal(model.nodes[2].params.threshold,7);
  assert.equal(model.links.length,3);
  assert.equal(model.nodes.filter(n=>n.type==='asgOut').length,1);
  assert.ok(model.links.some(l=>l.from==='N1'&&l.to==='N2'));
  const withoutFlux={nodes:[{id:'N1',type:'fluxRateSignal',x:0,y:0}],links:[],nodeCounter:1};
  cc.migrate(withoutFlux);
  assert.equal(withoutFlux.nodes.length,4);
  const flux=withoutFlux.nodes.find(n=>n.type==='pow1');
  assert.ok(withoutFlux.links.some(l=>l.from===flux.id&&l.to==='N1'));
});

test('PLIN : le véritable logigramme demande AAR au-delà de 435 W/cm, sans plafonner la mesure',()=>{
  const {cc,model}=editor();
  const plin=model.nodes.find(n=>n.type==='plinSignal');
  assert.ok(plin);
  for(const [linear,trip] of [[434,0],[435,0],[435.01,1],[600,1]]){
    cc.reset();cc.setSignals({pow1:[100,'% PN'],mp1Signal:[155,'bar abs.'],
      voltageSignal:[0,'TOR'],plinSignal:[linear,'W/cm']});
    const result=cc.evaluate(.1,true);
    assert.equal(result.signals.get(plin.id).value,linear);
    assert.equal(result.outputs.aarOut.value,trip);
  }
  const m=E.make();m.controls.fxYUngraped=1.8;E.refreshAxial(m);
  assert.ok(m.state.peakLinearWcm>435);
  cc.reset();cc.setSignals(appSignals(m));
  assert.equal(cc.evaluate(.1,true).outputs.aarOut.value,1);
});

test('PLIN : migration des graphes existants idempotente, avec maintien des seuils personnalisés',()=>{
  const {cc}=editor();
  const model={nodes:[{id:'N1',type:'pow1',x:0,y:0,params:{}},
    {id:'N2',type:'compare',x:235,y:0,params:{relation:'>',threshold:120,whenTrue:1,whenFalse:0}},
    {id:'N3',type:'aarOut',x:700,y:0,params:{}}],
    links:[{from:'N1',to:'N2',toPort:0},{from:'N2',to:'N3',toPort:0}],nodeCounter:3};
  cc.migrate(model);const count=model.nodes.length,links=model.links.length;cc.migrate(model);
  assert.equal(model.nodes.length,count);assert.equal(model.links.length,links);
  assert.equal(model.nodes[1].params.threshold,120);
  for(const [plin,expected] of [[400,0],[436,1]]){
    cc.setModel(model);cc.setSignals({pow1:[100,'% PN'],plinSignal:[plin,'W/cm']});
    assert.equal(cc.evaluate(.1,true).outputs.aarOut.value,expected);
  }
  const own={nodes:[{id:'N1',type:'plinSignal',params:{}},
    {id:'N2',type:'compare',params:{relation:'>',threshold:420,whenTrue:1,whenFalse:0}},
    {id:'N3',type:'aarOut',params:{}}],
    links:[{from:'N1',to:'N2',toPort:0},{from:'N2',to:'N3',toPort:0}],nodeCounter:3};
  cc.migrate(own);assert.equal(own.nodes.length,5);assert.equal(own.nodes[1].params.threshold,420);
});

test('les quatre chaînes GV du vrai graphe stabilisent le niveau GE après un écart d’inventaire', () => {
  const {cc,model:graph}=editor('regul');
  graph.nodes=graph.nodes.filter(n=>/^gv[1-4]LevelSignal$/.test(n.type)
    || /GV[1-4]|ARE[1-4]|VAP[1-4]/.test(n.label));
  const ids=new Set(graph.nodes.map(n=>n.id));
  graph.links=graph.links.filter(l=>ids.has(l.from)&&ids.has(l.to));
  cc.setModel(graph);
  const m=E.make();m.controls.protectionsEnabled=false;
  m.state.gv[0].waterKg-=1500;m.state.gv[1].waterKg+=1500;
  for(let i=0;i<2400;i++){
    const signals={gvSetpointSignal:[55,'%']};
    m.state.gv.forEach((g,n)=>{
      Object.assign(g,E.gvLevels(g.waterKg));
      signals[`gv${n+1}LevelSignal`]=[g.levelPct,'%'];
      signals[`gv${n+1}SteamSignal`]=[g.steamKgS,'kg/s'];
    });
    cc.setSignals(signals);
    const {outputs}=cc.evaluate(0.1,true);
    m.controls.gvGraphFeedPct=[1,2,3,4].map(n=>outputs[`gv${n}Out`].value);
    E.step(m,0.1);
  }
  assert.ok(m.state.gv.every(g=>Math.abs(g.levelPct-55)<0.2),
    m.state.gv.map(g=>g.levelPct.toFixed(3)).join(', '));
});

test('pilotage avec CC-RÉGUL complet : bosses G1 ≈ −5, G2 ≈ −8 et N1 visible autour de 2 % PN',()=>{
  const {cc}=editor('regul',true),m=E.make(),u=m.controls;
  u.protectionsEnabled=false;u.rMode='graph';
  const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
  const source=app.slice(app.indexOf('  function editorSignals()'),app.indexOf('  function sendEditorTick('));
  const signals=vm.createContext({E,model:m});
  vm.runInContext(source+'globalThis.getSignals=editorSignals;',signals);
  const initial=m.state.dpaxPctPn;let g1=0,g2=0,n1=0,recovery=-Infinity,returnG2=-Infinity;
  E.startTransient(m,'pilotage');
  for(let t=0;t<1100;t+=0.5){
    cc.setSignals(signals.getSignals());
    const out=cc.evaluate(0.5,true).outputs,value=name=>out[name]?.value;
    u.rGraphPas=value('posg');u.g3GraphTarget=value('g3Out');
    u.gvGraphFeedPct=[1,2,3,4].map(n=>value(`gv${n}Out`));
    u.pressureGraphHeaterKW=value('pchauffOut');u.pressureGraphSprayPct=value('qaspOut');
    u.nrefGraphPct=value('nrefOut');u.rcvChargeGraphM3h=value('qchargeOut');
    E.advance(m,0.5);
    const p=m.state.demandPct,delta=m.state.dpaxPctPn-initial;
    assert.ok(Number.isFinite(delta));
    if(p>80)g1=Math.min(g1,delta);
    if(p<80&&p>50)g2=Math.min(g2,delta);
    if(p<85&&p>78)recovery=Math.max(recovery,delta);
    if(p<50&&p>35)returnG2=Math.max(returnG2,delta);
    if(p<35&&p>10)n1=Math.min(n1,delta);
  }
  assert.ok(g1<-4&&g1>-6.2,`bosse G1 ${g1.toFixed(2)}`);
  assert.ok(g2<-7&&g2>-9.5,`bosse G2 ${g2.toFixed(2)}`);
  assert.ok(g2<g1-1.5,'G2 plus marquée que G1');
  assert.ok(recovery>g1+2,'G1 reste distincte de G2');
  // L'amplitude depuis le retour G2 dépend aussi de l'inertie thermique et
  // de la position régulée de R. Le déplacement N1 depuis le point nominal
  // reste voisin de 2 % PN, avec une bosse distincte après G2.
  assert.ok(returnG2-n1>1,`bosse N1 depuis le retour G2 : ${(returnG2-n1).toFixed(2)} % PN`);
  assert.ok(n1<-1.8&&n1>-4,`écart N1 depuis le point initial : ${n1.toFixed(2)}`);
  assert.equal(E.C.dpaxReferencePctPn,-1);
  assert.deepEqual(u.rodWorthPcm,{...E.ROD_WORTH_PCM});
});

test('R en manuel : son intégrateur suit la position réelle sans suspendre les autres régulations',()=>{
  const {cc}=editor('regul',true),m=E.make();
  m.state.rods.R=177;m.state.tavgC=310;
  cc.setSignals(appSignals(m),true);
  const out=cc.evaluate(60,true).outputs;
  assert.equal(out.posg.value,177);
  assert.ok(Number.isFinite(out.pchauffOut.value));
  assert.ok(Number.isFinite(out.gv1Out.value));
  m.state.rods.R=205;cc.setSignals(appSignals(m),true);
  assert.equal(cc.evaluate(60,true).outputs.posg.value,205);
  cc.setSignals(appSignals(m),false);
  assert.equal(cc.evaluate(0,true).outputs.posg.value,205,'reprise sans saut');
  const resumed=cc.evaluate(.5,true).outputs.posg.value;
  assert.ok(resumed<205&&resumed>204,'la chaîne reprend son action en pas/min');
});
