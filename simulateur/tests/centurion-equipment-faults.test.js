const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine'),State=require('../centurion-state');
const {editorSurface}=require('./helpers/editor-surface');
const manual=()=>{const m=E.make();m.controls.protectionsEnabled=false;return m;};

test('pannes : chaufferettes et aspersion échappent aux ordres CC, puis récupèrent leur commande',()=>{
  const m=manual(),u=m.controls,s=m.state;
  u.pressureGraphHeaterKW=2400;u.pressureGraphSprayPct=100;
  E.setEquipmentFault(m,'heater','off');E.setEquipmentFault(m,'spray','hold');
  E.advance(m,1);
  assert.equal(s.heaterKW,0);assert.equal(s.sprayPct,0);
  assert.equal(u.pressureGraphHeaterKW,2400);assert.equal(u.pressureGraphSprayPct,100);
  assert.equal(E.controlSignals(m).pchauffSignal[0],0);
  E.clearEquipmentFault(m,'heater');E.clearEquipmentFault(m,'spray');E.advance(m,.5);
  assert.equal(s.heaterKW,2400);assert.ok(s.sprayPct>0);
  assert.equal(s.tripDemandAt,null,'la panne ne génère aucun ordre AAR caché');
});

test('grappes : blocage mécanique persistant à l’AAR, mouvement intempestif subordonné à l’AAR',()=>{
  const m=manual(),s=m.state,u=m.controls;
  E.setEquipmentFault(m,'rod.R','hold');u.rManualPas=0;
  E.setEquipmentFault(m,'rod.G1','fall');
  E.advance(m,1);assert.equal(s.rods.R,233);assert.ok(s.rods.G1<260);
  const actual=s.rods.G1;
  E.setEquipmentFault(m,'rod.G1','rise');E.advance(m,.5);assert.ok(s.rods.G1>actual);
  E.initiate(m,'trip');E.advance(m,5);
  assert.notEqual(s.tripAt,null);assert.equal(s.rods.R,233);
  assert.equal(s.rods.G1,0);assert.equal(s.rods.SA,0);
  E.clearEquipmentFault(m,'rod.R');E.advance(m,5);assert.equal(s.rods.R,0);
});

test('GV : pannes locales, bilans vapeur cohérents et arrêt ASG conservé sur haut niveau',()=>{
  const m=manual(),s=m.state,u=m.controls;
  E.setEquipmentFault(m,'vvp.1','off');E.setEquipmentFault(m,'gcta.2','on');
  E.setEquipmentFault(m,'are.3','off');E.setEquipmentFault(m,'asg.4','on');
  E.advance(m,4);
  assert.equal(s.gv[0].steamValvePct,0);assert.equal(u.gvSteamValvePct[0],100);
  assert.equal(s.gv[1].gctAValvePct,100);assert.ok(s.gv[1].dumpKgS>0);
  assert.ok(s.gv[2].feedKgS<s.gv[0].feedKgS);
  assert.ok(s.gv[3].asgKgS>0);
  assert.equal(E.equipmentValue(m,'asg.4'),1,'l’état ASG reflète le débit réalisé malgré la commande normale HS');
  for(const gv of s.gv)assert.ok(Math.abs(gv.steamKgS-gv.turbineSteamKgS-gv.dumpKgS-gv.secondaryBreakKgS)<1e-7);
  s.gv[3].waterKg=E.C.gvNominalWaterKg*1.3;
  E.step(m,.1);assert.ok(s.gv[3].levelPct>90);assert.equal(s.gv[3].asgKgS,0);
  const beforeTrip=s.gv[2].feedKgS;
  E.initiate(m,'trip');E.advance(m,4);assert.notEqual(s.tripAt,null);
  assert.ok(s.gv[2].feedKgS<beforeTrip*.05,'ARE en extinction après la perte de son alimentation à l’AAR');
});

test('RCV : fermeture/ouverture réellement subies et charge plafonnée par la contre-pression',()=>{
  const m=manual(),u=m.controls;
  E.setEquipmentFault(m,'orifice.1','on');u.rcvLetdownCloseGraph=true;
  assert.equal(E.rcvLetdownM3h(m),18,'orifice mécaniquement ouvert malgré la fermeture CC');
  assert.equal(E.equipmentValue(m,'orifice.1'),1);
  E.clearEquipmentFault(m,'orifice.1');assert.equal(E.rcvLetdownM3h(m),0);
  E.setEquipmentFault(m,'charge','on');u.rcvChargeGraphM3h=0;
  E.step(m,.1);assert.equal(m.state.rcvChargeM3h,60);assert.equal(u.rcvChargeGraphM3h,0);
  E.setEquipmentFault(m,'charge','off');E.advance(m,.2);assert.equal(m.state.rcvChargeM3h,0);
});

test('GMPP : perte locale de débit et de chaleur, sans déclenchement des autres pompes',()=>{
  const m=manual();E.setEquipmentFault(m,'gmpp.1','off');E.advance(m,1);
  assert.equal(m.state.pumpHeatMW,18);assert.ok(m.state.loops[0].flowKgS<m.state.loops[1].flowKgS);
  const v=E.instrumentSnapshot(m);assert.equal(v.loops[0].pumpStopped,true);
  assert.equal(v.loops[1].pumpStopped,false);assert.equal(m.state.primaryPumpsStopped,false);
  E.clearEquipmentFault(m,'gmpp.1');E.step(m,.1);assert.equal(m.state.pumpHeatMW,24);
});

test('bibliothèques : toutes les entrées sont communes, évaluées sur les mesures réelles et placées avant les opérateurs',()=>{
  const m=manual();m.state.rods.G2=178;m.state.dpaxPctPn=-3.2;m.state.gv[2].pressureBar=47;
  const readings=E.controlSignals(m);
  for(const mode of ['regul','protect']){
    const ui=editorSurface(mode),groups=ui.query('.reg-palette').querySelectorAll('.palette-group');
    const headings=groups.map(g=>g.querySelector('h3').textContent);
    assert.ok(headings.indexOf('Positions des grappes')===headings.indexOf('Signaux calculés')+1);
    assert.ok(headings.indexOf('Mesures des GV')<headings.indexOf('Opérateurs paramétrables'));
    assert.equal(headings.some(h=>h.includes('RGL et')),false);
    const sensors=ui.queryAll('[data-block-type]').filter(b=>b.dataset.role==='sensor');
    const types=[...new Set(sensors.map(b=>b.dataset.blockType))];
    for(const type of types){
      assert.ok(readings[type]&&Number.isFinite(readings[type][0]),`${mode} : ${type} fourni par le moteur`);
      const button=sensors.find(b=>b.dataset.blockType===type);
      assert.equal(button.classList.contains('regul-only'),false);
      assert.equal(button.parentElement.parentElement.classList.contains('regul-only'),false);
    }
    const saved={format:'SimuREP-Regulation',version:1,name:'Mesures communes',nodeCounter:types.length,
      viewport:{x:0,y:0,zoom:1},nodes:types.map((type,i)=>({id:'M'+i,type,x:i*160,y:0,params:{}})),links:[]};
    const live=editorSurface(mode,{saved});live.bridge.receive({type:'centurion-editor-enable',enabled:true});
    live.bridge.receive({type:'centurion-editor-tick',dt:.1,signals:readings});
    const values=live.state().signals;
    types.forEach((type,i)=>{assert.equal(values.get('M'+i).value,readings[type][0],`${mode} : ${type}`);
      assert.equal(values.get('M'+i).unit,readings[type][1]);});
  }
});

test('état JSON : reprise identique des pannes, migration v10 et rejet des pannes invalides',()=>{
  const m=manual();E.setEquipmentFault(m,'rod.G2','hold');E.setEquipmentFault(m,'spray','on');E.advance(m,.2);
  const editor=mode=>({mode,enabled:false,graph:{format:'SimuREP-Regulation',version:1,nodes:[],links:[]},runtime:[]});
  const ui={speed:20,diagram:'rcp',selectedGv:1,activeView:'initiateurs',historyFollowing:true,historyEndS:null,
    historyWindow:'1800',traceSet:'flows',coreTrailWindow:'300',ptTrailWindow:'14400',alarmLimits:{}};
  const raw=State.write(E,m,{regul:editor('regul'),protect:editor('protect')},ui,null);
  const loaded=State.read(E,JSON.stringify(raw));E.step(m,.1);E.step(loaded.model,.1);
  assert.deepEqual(loaded.model,m);
  const old=structuredClone(raw);old.engineRevision='20261009-charge-v10';delete old.model.controls.equipmentFaults;
  assert.deepEqual(State.read(E,old).model.controls.equipmentFaults,{});
  const invalid=structuredClone(raw);invalid.model.controls.equipmentFaults['rod.G2'].mode='execute';
  assert.throws(()=>State.read(E,invalid),/Défaillance/);
  assert.throws(()=>E.setEquipmentFault(m,'unknown','on'),/invalide/);
  assert.deepEqual(E.make().controls.equipmentFaults,{});
});
