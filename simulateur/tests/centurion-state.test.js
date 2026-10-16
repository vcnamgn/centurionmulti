const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine'),State=require('../centurion-state'),Cert=require('../centurion-certificate');
const {editorSurface}=require('./helpers/editor-surface');
const ui={speed:200,diagram:'inventory',selectedGv:2,activeView:'synoptiques',historyFollowing:true,historyEndS:null,
  historyWindow:'1800',traceSet:'flows',coreTrailWindow:'300',ptTrailWindow:'14400',alarmLimits:{}};
const snapshot=editor=>editor.bridge.receive({type:'centurion-editor-save'}).saved;
const plain=value=>JSON.parse(JSON.stringify(value));

test('pression/brèche v8 : les archives v7 gardent les masses, états CC et historiques à la reprise',()=>{
  const m=E.make();E.initiate(m,'break',{areaCm2:300});E.advance(m,3);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,m,editors,ui,null);raw.engineRevision='20261008-gmpp-niveau-v7';
  const loaded=State.read(E,raw);
  assert.equal(loaded.engineRevision,State.REVISION);
  assert.deepEqual(loaded.model,plain(m));assert.deepEqual(loaded.editors,plain(editors));
  E.step(m,.1);E.step(loaded.model,.1);assert.deepEqual(loaded.model,m);
});

test('état GMPP v7 : ancienne v6 compatible, arrêt mémorisé et aspiration distincte du thermosiphon',()=>{
  const m=E.make();E.tripPrimaryPumps(m);E.advance(m,.5);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const archive=Cert.createArchive(E);archive.observe(m);
  const raw=State.write(E,m,editors,ui,archive.save()),loaded=State.read(E,raw);
  assert.deepEqual(loaded.model,plain(m));
  E.step(m,.1);E.step(loaded.model,.1);assert.deepEqual(loaded.model,m);
  const old=structuredClone(raw);old.engineRevision='20261008-ris-inertie-v6';
  for(const loop of old.model.state.loops)delete loop.forcedPrimingFraction;
  for(const r of old.certificateArchive?.records??[]){
    for(const loop of r.snapshot.loops)delete loop.forcedPrimingFraction;
    for(const loop of r.snapshot.primaryFlow.loops)delete loop.forcedPrimingFraction;
  }
  const migrated=State.read(E,old);
  assert.equal(migrated.model.state.primaryPumpsStopped,true);
  assert.deepEqual(migrated.model.state.loops,raw.model.state.loops);
  assert.deepEqual(migrated.certificateArchive,raw.certificateArchive);
  const invalid=structuredClone(raw);delete invalid.model.state.loops[0].forcedPrimingFraction;
  assert.throws(()=>State.read(E,invalid),/forcedPrimingFraction/);
});

test('état RIS v6 : montée en vitesse reprise, v5 migré sans perte de stocks ni parcelles',()=>{
  const m=E.make();m.controls.protectionGraphMode=true;E.setRisOperation(m,'on');E.advance(m,.6);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,m,editors,ui,null),loaded=State.read(E,raw);
  assert.equal(loaded.model.state.risPumpSpeedFraction,.3);
  E.step(m,.1);E.step(loaded.model,.1);assert.deepEqual(loaded.model,m);
  const old=structuredClone(raw);old.engineRevision='20261008-gv-breches-v5';
  delete old.model.state.risPumpSpeedFraction;
  const migrated=State.read(E,old);
  assert.equal(migrated.model.state.risPumpSpeedFraction,1);
  assert.deepEqual(migrated.model.state.accumulatorsKg,raw.model.state.accumulatorsKg);
  assert.deepEqual(migrated.model.state.risPipe,raw.model.state.risPipe);
  assert.equal(migrated.model.state.primaryMassKg,raw.model.state.primaryMassKg);
  const missing=structuredClone(raw);delete missing.model.state.risPumpSpeedFraction;
  assert.throws(()=>State.read(E,missing),/risPumpSpeedFraction/);
  const invalid=structuredClone(raw);invalid.model.state.risPumpSpeedFraction=1.1;
  assert.throws(()=>State.read(E,invalid),/Vitesse des pompes RIS/);
});

test('état PZR v3 : stocks et parcelles conservés à la reprise du couplage de pression',()=>{
  const m=E.make();E.initiate(m,'break',{areaCm2:300});E.advance(m,5);
  const raw=State.write(E,m,{regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))},ui,null);
  raw.engineRevision='20261008-pzr-v3';
  const loaded=State.read(E,raw);
  assert.equal(loaded.engineRevision,State.REVISION);assert.deepEqual(loaded.model,m);
  E.step(m,.1);E.step(loaded.model,.1);assert.deepEqual(loaded.model,m);
});

test('état JSON : pente PTUR et cible en cours reprises, anciens fichiers à 5 %/min',()=>{
  const m=E.make();m.controls.manualTurbineRatePctMin=2;
  E.setManualTurbineDemand(m,80);E.advance(m,10);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,m,editors,ui,null),loaded=State.read(E,JSON.stringify(raw));
  assert.equal(loaded.model.controls.manualTurbineRatePctMin,2);
  assert.equal(loaded.model.controls.manualTurbineTargetPct,80);
  E.advance(m,2);E.advance(loaded.model,2);
  assert.equal(loaded.model.state.demandPct,m.state.demandPct);
  const legacy=structuredClone(raw);
  delete legacy.model.controls.manualTurbineTargetPct;delete legacy.model.controls.manualTurbineRatePctMin;
  const migrated=State.read(E,legacy);
  assert.equal(migrated.model.controls.manualTurbineRatePctMin,5);
  assert.equal(migrated.model.controls.manualTurbineTargetPct,null);
  assert.equal(migrated.model.state.demandPct,raw.model.state.demandPct);
  for(const mutate of [r=>r.model.controls.manualTurbineRatePctMin=3,
    r=>r.model.controls.manualTurbineTargetPct=120]){
    const invalid=structuredClone(raw);mutate(invalid);assert.throws(()=>State.read(E,invalid));
  }
  const instant=structuredClone(raw);instant.model.controls.manualTurbineRatePctMin=null;
  const instantLoaded=State.read(E,JSON.stringify(instant));
  assert.equal(instantLoaded.model.controls.manualTurbineRatePctMin,null);
  E.step(instantLoaded.model,.1);assert.equal(instantLoaded.model.state.turbinePct,80);
});

test('état JSON : sélection de courbes, échelles, période et lecture figée conservées',async()=>{
  const {surface}=require('./helpers/history-surface');
  const model=E.make();E.advance(model,3);
  const h=surface(model.state);h.chart.draw();
  await h.set('traceSet','pressures');await h.add('rod.R');
  await h.set('historyMode0','fixed');await h.set('historyMin0','120','input');
  await h.set('historyMax0','175','input');
  h.get('historyShow1').checked=false;await h.get('historyShow1').fire('change');
  await h.get('historyPin').fire('click');
  const chart=h.chart.save(),editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const savedUi={...ui,traceSet:'custom',historyWindow:'custom',chart};
  const loaded=State.read(E,JSON.stringify(State.write(E,model,editors,savedUi,null)));
  assert.deepEqual(loaded.ui.chart,chart);
  const other=surface(loaded.model.state);other.chart.restore(loaded.ui.chart,loaded.ui);other.chart.draw();
  assert.deepEqual(other.chart.save(),chart);
  await other.get('historyCopy').fire('click');
  assert.match(other.copied[0],/Pression primaire.*155/);
  assert.doesNotMatch(other.copied[0],/Pression GV/,'la courbe masquée reste masquée');
  assert.match(other.copied[0],/Réactivité/);
});

test('état JSON : réglages de graphique corrompus rejetés et anciens fichiers compatibles',()=>{
  const {surface}=require('./helpers/history-surface'),model=E.make();E.advance(model,2);
  const chart=surface(model.state).chart.save();
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,model,editors,{...ui,chart},null);
  for(const mutate of [r=>r.ui.chart.traces[0].id='variable-inconnue',
    r=>r.ui.chart.traces[0].max=r.ui.chart.traces[0].min,
    r=>r.ui.chart.traces[0].color='javascript:invalid',
    r=>r.ui.chart.traces.push({...r.ui.chart.traces[0]}),
    r=>r.ui.chart.pinned={time:300,values:{power:100}},
    r=>r.ui.chart.reactivity.min=700]){
    const invalid=structuredClone(raw);mutate(invalid);assert.throws(()=>State.read(E,invalid));
  }
  delete raw.ui.chart;
  const legacy=State.read(E,raw);
  assert.equal(legacy.ui.traceSet,'flows');assert.deepEqual(legacy.model,plain(model));
});

test('migration état v1 : nouvelle densité sans perte de masse, puis reprise du piston',()=>{
  const m=E.make(),s=m.state;
  s.primaryMassKg=288919.9433620741;s.pressureBar=129.39650007044798;s.tavgC=235.44715534379134;
  s.boronInventory=s.primaryMassKg*s.boronPpm;
  E.initializePrimaryThermalState(s);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,m,editors,ui,null);
  raw.engineRevision='20261007-state-v1';
  delete raw.model.state.thermalNodes;
  for(const key of ['rcvChargeM3h','rcvDeliveredM3h','rcvDemandM3h','rcvCapacityM3h',
    'pzrThermalPressureBar','pzrPistonBarS','reliefSteamKgS','reliefLiquidKgS'])delete raw.model.state[key];
  for(const key of ['densityKgM3','liquidVolumeM3','capacityM3','steamSpaceM3','compressedLiquidKg'])
    delete raw.model.state.inventory[key];
  raw.model.state.inventory.overfillKg=3111.617;
  const migrated=State.read(E,raw);
  assert.equal(migrated.engineRevision,State.REVISION);
  assert.equal(migrated.model.state.primaryMassKg,s.primaryMassKg);
  assert.equal(migrated.model.state.pressureBar,s.pressureBar);
  assert.equal(migrated.model.state.inventory.overfillKg,0);
  assert.ok(migrated.model.state.inventory.densityKgM3>820);
  E.step(migrated.model,.1);
  assert.ok(Number.isFinite(migrated.model.state.pressureBar));
  assert.equal(raw.engineRevision,'20261007-state-v1','le fichier fourni reste intact');
});

test('état JSON : reprise identique de la brèche, des tuyaux, poisons et inventaires',()=>{
  const m=E.make();m.controls.protectionGraphMode=false;E.initiate(m,'break',{areaCm2:300,loop:2});
  E.setRcvInjection(m,'borication');E.advance(m,30);E.setRisOperation(m,'off');
  const archive=Cert.createArchive(E);archive.observe(m);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,m,editors,ui,archive.save());
  const loaded=State.read(E,JSON.stringify(raw));
  assert.deepEqual(loaded.model,m);assert.notEqual(loaded.model,m);
  E.advance(m,10);E.advance(loaded.model,10);
  assert.deepEqual(loaded.model,m,'le même moteur poursuit exactement la même trajectoire');
  assert.equal(loaded.model.controls.breakAreaCm2,300);assert.ok(loaded.model.state.breakKgS>0);
  assert.equal(loaded.model.controls.risPumpMode,'off');
});

test('état PZR v2 : stocks et pression thermique conservés avec le nouveau gain de phase',()=>{
  const model=E.make();E.advance(model,10);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,model,editors,ui,null);raw.engineRevision='20261008-pzr-v2';
  const restored=State.read(E,raw);
  assert.equal(restored.engineRevision,State.REVISION);
  assert.deepEqual(restored.model,model);
  assert.equal(raw.engineRevision,'20261008-pzr-v2','la sauvegarde source reste intacte');
  E.step(model,.1);E.step(restored.model,.1);assert.deepEqual(restored.model,model);
});

test('état JSON : graphe et mémoires des filtres, intégrateurs et dérivés restaurés',()=>{
  const graph={format:'SimuREP-Regulation',version:1,name:'Test dynamique',nodes:[
    {id:'N1',type:'constant',x:0,y:0,params:{value:2,unit:'pas/min'}},
    {id:'N2',type:'filter',x:150,y:0,params:{tau:60}},
    {id:'N3',type:'integrator',x:300,y:0,params:{min:0,max:260,outputUnit:'pas extraits'}},
    {id:'N4',type:'posg',x:450,y:0,params:{}},
    {id:'N5',type:'derivative',x:450,y:100,params:{tau:3}}],links:[
      {from:'N1',to:'N2',toPort:0},{from:'N2',to:'N3',toPort:0},{from:'N3',to:'N4',toPort:0},
      {from:'N2',to:'N5',toPort:0}]};
  const a=editorSurface('regul',{saved:graph}),b=editorSurface();
  const signals=E.controlSignals(E.make());a.bridge.receive({type:'centurion-editor-enable',enabled:true,signals});
  for(let i=0;i<100;i++)a.bridge.receive({type:'centurion-editor-tick',dt:.1,signals});
  const saved=snapshot(a);assert.ok(saved.runtime.length>0);
  assert.equal(b.bridge.receive({type:'centurion-editor-validate',saved}).error,undefined);
  assert.equal(b.bridge.receive({type:'centurion-editor-restore',saved}).error,undefined);
  assert.deepEqual(plain(snapshot(b).runtime),plain(saved.runtime));
  for(let i=0;i<100;i++){
    const tick={type:'centurion-editor-tick',dt:.1,signals};
    assert.deepEqual(plain(b.bridge.receive(tick).outputs),plain(a.bridge.receive(tick).outputs));
  }
});

test('état JSON : suppression de blocs CC sans mémoires orphelines ni perte des mémoires restantes',()=>{
  const graph={format:'SimuREP-Regulation',version:1,name:'Édition pendant le TP',nodes:[
    {id:'N1',type:'constant',x:0,y:0,params:{value:2,unit:'pas/min'}},
    {id:'N2',type:'filter',x:150,y:0,params:{tau:60}},
    {id:'N3',type:'integrator',x:300,y:0,params:{min:0,max:260,outputUnit:'pas extraits'}}],links:[
    {from:'N1',to:'N2',toPort:0},{from:'N2',to:'N3',toPort:0}]};
  for(const mode of ['regul','protect']){
    const editor=editorSurface(mode,{saved:graph});
    editor.bridge.receive({type:'centurion-editor-enable',enabled:true,signals:E.controlSignals(E.make())});
    editor.bridge.receive({type:'centurion-editor-tick',dt:1,signals:E.controlSignals(E.make())});
    const before=plain(snapshot(editor));
    assert.ok(before.runtime.some(([id])=>id==='N2'));
    editor.query('.logic-node[data-node-id="N2"]').fire('pointerdown',
      {button:0,shiftKey:true,stopPropagation(){}});
    editor.get('deleteRegNode').click();
    const saved=plain(snapshot(editor));
    assert.ok(!saved.graph.nodes.some(node=>node.id==='N2'));
    assert.ok(!saved.runtime.some(([id])=>id==='N2'),'un bloc supprimé ne doit plus bloquer la sauvegarde');
    assert.ok(!saved.lastSignals.some(([id])=>id==='N2'));
    assert.deepEqual(saved.runtime.find(([id])=>id==='N3'),before.runtime.find(([id])=>id==='N3'),
      'la mémoire de l’intégrateur conservé ne doit pas être remise à zéro');
    State.validateEditor(saved,mode);
    const restored=editorSurface(mode);
    assert.equal(restored.bridge.receive({type:'centurion-editor-restore',saved}).error,undefined);
    assert.deepEqual(plain(snapshot(restored).runtime),saved.runtime);
  }
});

test('état JSON : fichiers incompatibles ou corrompus rejetés avant remplacement',()=>{
  const raw=State.write(E,E.make(),{regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))},ui,null);
  for(const mutate of [r=>r.version=99,r=>r.model.state.loops.pop(),r=>r.model.controls.breakAreaCm2=300,
    r=>r.model.state.xenon32[0]='NaN',r=>r.model.state.precursors[0]=null,
    r=>r.ui.ptTrailWindow='100000',r=>r.model.controls.pressureGraphHeaterKW='chaud']){
    const invalid=structuredClone(raw);mutate(invalid);assert.throws(()=>State.read(E,invalid));
  }
  const invalid=JSON.parse(JSON.stringify(raw));invalid.model.state['__proto__']={bad:1};
  // Une clé propre issue du JSON est refusée, même sans fusion d'objets.
  assert.throws(()=>State.read(E,JSON.stringify(raw).replace('"state":{','"state":{"__proto__":{},')),/interdite/);
  assert.equal(raw.model.state.time,0);
});

test('état v4 avec certificat : nouvelles mesures GV ajoutées sans tronquer les archives',()=>{
  const m=E.make(),archive=Cert.createArchive(E);archive.observe(m);
  const raw=State.write(E,m,{regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))},ui,archive.save());
  raw.engineRevision='20261008-breche-v4';delete raw.model.controls.gvSecondaryBreakAreaCm2;
  const trim=g=>{for(const key of ['secondaryBreakAreaCm2','secondaryBreakKgS','secondaryBreakReleasedKg',
    'secondaryBreakEnergyJ','waterMassRateKgS'])delete g[key];};
  raw.model.state.gv.forEach(trim);
  raw.certificateArchive.records.forEach(r=>{r.snapshot.gvAll.forEach(trim);trim(r.snapshot.gvState);});
  const loaded=State.read(E,raw);assert.deepEqual(loaded.model,m);
  assert.deepEqual(loaded.certificateArchive,archive.save());
  const restored=Cert.createArchive(E);restored.restore(loaded.model,loaded.certificateArchive);
  assert.deepEqual(restored.getRecords(),archive.getRecords());
});

test('certificat : archive reprise avec ses événements et diagramme P–T autonome',()=>{
  const m=E.make(),archive=Cert.createArchive(E);archive.observe(m);E.initiate(m,'trip');E.advance(m,4);archive.observe(m);
  const other=Cert.createArchive(E);other.restore(m,archive.save());
  assert.deepEqual(other.getRecords(),archive.getRecords());
  const curves={lower:[[10,5],[300,125]],upper:[[10,31],[300,155]],saturation:[[0,0],[350,170]]};
  const svg=Cert.ptSvg(m,E,curves);
  assert.match(svg,/width="1280" height="850"/);assert.match(svg,/id="pt-trace" d="M/);
  assert.match(svg,/id="pt-point" cx="/);assert.doesNotMatch(svg,/<script/);
});

test('sauvegarde avec certificat : conditions RRA variables de zéro à cinq, reprise exacte',()=>{
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  for(let count=0;count<=5;count++){
    const m=E.make(),s=m.state;
    s.tavgC=count>=1?200:150;s.pressureBar=count>=2?155:28;s.powerPct=count>=3?100:0;
    if(count>=4){s.primaryMassKg=1000;s.inventory=E.cppInventory(1000,s.tavgC,s.pressureBar);}
    if(count===5)s.endState='melted';
    E.initializePrimaryThermalState(s);
    assert.equal(E.rraConditions(s).reasons.length,count);
    const archive=Cert.createArchive(E);archive.observe(m);
    const raw=State.write(E,m,editors,ui,archive.save());
    const loaded=State.read(E,JSON.stringify(raw));
    assert.deepEqual(loaded.model,m);
    assert.deepEqual(loaded.certificateArchive,archive.save());
    assert.equal(loaded.certificateArchive.records[0].snapshot.rra.reasons.length,count);
    const restored=Cert.createArchive(E);restored.restore(loaded.model,loaded.certificateArchive);
    assert.deepEqual(restored.getRecords(),archive.getRecords());
    E.step(m,.1);E.step(loaded.model,.1);assert.deepEqual(loaded.model,m);
  }
});

test('certificat sauvegardé : diagnostics RRA invalides et canaux physiques tronqués rejetés',()=>{
  const m=E.make(),archive=Cert.createArchive(E);archive.observe(m);
  const editors={regul:snapshot(editorSurface()),protect:snapshot(editorSurface('protect'))};
  const raw=State.write(E,m,editors,ui,archive.save());
  for(const mutate of [s=>s.rra.reasons=[42],s=>s.rra.reasons=[null],
    s=>s.rra.reasons=Array(6).fill('condition'),s=>s.rra.reasons={},
    s=>s.rra.allowed='oui',s=>s.gvAll.pop(),s=>s.loops.pop()]){
    const invalid=structuredClone(raw);mutate(invalid.certificateArchive.records[0].snapshot);
    assert.throws(()=>State.read(E,invalid));
  }
});
