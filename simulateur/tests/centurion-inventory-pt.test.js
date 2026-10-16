const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine');
const energyRate=require('./helpers/primary-energy');
const {svgSurface}=require('./helpers/svg-surface');
const close=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const totalMass=s=>s.primaryMassKg+s.risTankRemainingKg+s.sumpKg
  +s.accumulatorsKg.reduce((a,b)=>a+b,0)
  +[...s.risPipe,...s.rcvPipe].reduce((n,p)=>n+p.massKg,0);

test('azote RIS : détente polytropique, racine de ΔP et continuité au démarrage',()=>{
  const c=E.C,m=c.accumulatorKgPerLoop,p=c.accumulatorPressureBar;
  close(E.accumulatorFlowKgS(p,m).flowKgS,0);
  close(E.accumulatorFlowKgS(p+1,m).flowKgS,0);
  const tiny=E.accumulatorFlowKgS(p-.001,m).flowKgS;
  close(E.accumulatorFlowKgS(p-1,m).flowKgS/tiny,Math.sqrt(1000),1e-7);
  assert.ok(tiny<30,'pas de marche de 400 kg/s au seuil');
  const half=E.accumulatorFlowKgS(1,m/2);
  close(half.nitrogenBar,p*(20/(47-13.5))**1.35);
  assert.ok(half.nitrogenBar<p);
  close(E.accumulatorFlowKgS(1,0).flowKgS,0);
});

test('accumulateur 10 pouces : 27 m³/20 m³ à 42 bar, inertie et pertes K/A² sans double section',()=>{
  const c=E.C,m=c.accumulatorKgPerLoop;
  close(m,27000);close(c.accumulatorVolumeM3-m/1000,20);
  close(c.accumulatorPressureBar,42);close(c.accumulatorResistanceM4,3050);
  const equilibrium=E.accumulatorFlowKgS(40,m).flowKgS;
  close(equilibrium,Math.sqrt(2*1000*200000/3050));
  assert.ok(equilibrium*3.6>1300&&equilibrium*3.6<1310,'débit volumique par accumulateur à 2 bar de ΔP');
  let q=0;
  for(let i=0;i<1000;i++){
    const next=E.accumulatorFlowKgS(40,m,q,.01).flowKgS;
    assert.ok(next>q&&next<=equilibrium);q=next;
  }
  close(q,equilibrium,.001);
  const area=Math.PI*.254**2/4,inertia=1.19/area**2;
  const decelerated=E.accumulatorFlowKgS(43,m,q,.01).flowKgS;
  close(inertia*(decelerated-q)/.01,
    -100000-3050*decelerated**2/(2*1000),1e-5);
  assert.ok(decelerated<q&&decelerated>0,'le clapet arrête le débit après décélération');
  close(E.accumulatorFlowKgS(43,m,q,2).flowKgS,0);
});

test('pompes RIS : montée en vitesse, HMT quadratique et redémarrage progressif',()=>{
  const m=E.make(),s=m.state,u=m.controls;
  u.protectionGraphMode=true;E.setRisOperation(m,'on');
  const hold=()=>{s.pressureBar=s.pzrThermalPressureBar=30;E.step(m,.1);};
  hold();close(s.risPumpSpeedFraction,.05);close(s.risMpKgS,0);close(s.risBpKgS,0);
  let lastMp=0,lastBp=0;
  for(let i=1;i<20;i++){
    hold();const r=s.risPumpSpeedFraction;
    close(s.risMpKgS,2*r*Math.max(0,120-30/r**2));
    close(s.risBpKgS,18*r*Math.max(0,40-30/r**2));
    assert.ok(s.risMpKgS>=lastMp&&s.risBpKgS>=lastBp);
    lastMp=s.risMpKgS;lastBp=s.risBpKgS;
  }
  close(s.risPumpSpeedFraction,1);close(s.risMpKgS,180);close(s.risBpKgS,180);
  s.pressureBar=s.pzrThermalPressureBar=40;E.step(m,.1);
  close(s.risMpKgS,160);close(s.risBpKgS,0);
  E.setRisOperation(m,'off');hold();close(s.risPumpSpeedFraction,0);
  close(s.risMpKgS,0);close(s.risBpKgS,0);
  E.setRisOperation(m,'on');hold();close(s.risPumpSpeedFraction,.05);close(s.risMpKgS,0);
});

test('inventaire CPP : conservation, vidange des capacités hautes et désamorçage progressif',()=>{
  const nominal=E.make().state.inventory;
  close(nominal.levelM,E.CPP_INITIAL_LEVEL_M,1e-6);
  close(nominal.components.pzr.fillPct,42);
  assert.deepEqual(nominal.loopPriming,[1,1,1,1]);
  const regulated=E.cppInventory(E.C.nominalPrimaryMassKg-3000);
  assert.ok(regulated.components.pzr.fillPct<35,'baisse du niveau PZR de fonctionnement courant');
  assert.deepEqual(regulated.loopPriming,[1,1,1,1],'les boucles restent pleines avec de l’eau dans le PZR');
  for(const i of [1,2,3,4])close(regulated.components[`gv${i}`].fillPct,100);
  for(const fraction of [1,.98,.95,.8,.6,.4,.2]){
    const mass=fraction*E.C.nominalPrimaryMassKg,inv=E.cppInventory(mass);
    close(Object.values(inv.components).reduce((sum,g)=>sum+g.massKg,0),mass,.0001);
    assert.ok(inv.levelM<=nominal.levelM+1e-8);
    for(const g of Object.values(inv.components))assert.ok(g.fillPct>=0&&g.fillPct<=100);
  }
  const medium=E.cppInventory(.95*E.C.nominalPrimaryMassKg);
  assert.ok(medium.components.pzr.fillPct<42);
  close(medium.components.vessel.fillPct,100);
  const low=E.cppInventory(.6*E.C.nominalPrimaryMassKg);
  assert.deepEqual(low.loopPriming,[0,0,0,0]);
  close(low.components.pzr.massKg,0);
  const full=E.cppInventory(1.3*E.C.nominalPrimaryMassKg);
  assert.ok(full.overfillKg>0);
  close(Object.values(full.components).reduce((sum,g)=>sum+g.massKg,0)+full.overfillKg,full.liquidMassKg);
});

test('brèche 300 cm² : températures bornées à Tsat, bilan massique global et RIS traversant le cœur',()=>{
  const m=E.make();E.initiate(m,'break',{areaCm2:300});
  let phase=false,risCore=false,unprimed=false,largestAccumulatorStep=0,peakAccumulator=0,last=0;
  for(let i=0;i<6000&&!m.state.endState;i++){
    const before=totalMass(m.state);E.step(m,.1);const s=m.state;
    close(totalMass(s)-before,(s.rcvChargeKgS-s.rcvLetdownKgS)*.1,1e-7);
    const sat=E.saturationTemperatureC(s.pressureBar);
    for(const t of [s.coldC,s.hotC,s.tRicC,s.tavgC,s.lidC,...s.axialCoolant32,
      ...s.loops.flatMap(l=>[l.hotC,l.coldC])])assert.ok(Number.isFinite(t)&&t>=20&&t<=sat+1e-8);
    if(s.circulatingVoidPct>.01){phase=true;close(s.hotC,sat);}
    if(s.risDeliveredKgS>0){risCore=true;close(s.coreFlowKgS,
      s.loops.reduce((sum,l)=>sum+l.flowKgS,0)+s.risCoreKgS);}
    if(s.inventory.loopPriming.some(p=>p===0)){
      unprimed=true;s.loops.forEach((l,i)=>{if(s.inventory.loopPriming[i]===0)close(l.naturalFlowKgS,0);});
    }
    largestAccumulatorStep=Math.max(largestAccumulatorStep,Math.abs(s.accumulatorKgS-last));last=s.accumulatorKgS;
    peakAccumulator=Math.max(peakAccumulator,s.accumulatorKgS);
  }
  assert.ok(phase,'la détente atteint effectivement le domaine diphasique');
  assert.ok(risCore&&unprimed);
  assert.ok(largestAccumulatorStep<=peakAccumulator*.1/E.C.accumulatorEndDrainTauS+.01,
    'variation par pas bornée par la vidange progressive, sans créneau');
  assert.ok(m.state.accumulatorsKg.every(m=>m>=0));
});

test('bilan d’enthalpie primaire : injections froides, sensible, latent et rejets sans énergie perdue au plafonnement',()=>{
  const m=E.make();E.initiate(m,'break',{areaCm2:300});
  let phaseSteps=0;
  let accumulatorCoolingSteps=0;
  for(let i=0;i<6000&&!m.state.endState;i++){
    const s=m.state,dt=.1,oldT=s.tavgC,p=s.pressureBar;
    const before=s.primaryEnergyJ;
    E.step(m,dt);
    const inflow=(s.rcvDeliveredKgS*s.flowProperties.charge.tempC
      +s.risDeliveredKgS*s.flowProperties.ris.tempC)*E.C.primaryCpJkgK*dt;
    const out=(s.breakKgS+s.rcvLetdownKgS+s.reliefKgS)*dt*E.C.primaryCpJkgK*oldT
      +(s.breakSteamKgS+s.reliefSteamKgS)*dt*E.latentHeatJkg(p);
    const expected=before+energyRate(E,s,p)*dt;
    close(s.primaryEnergyJ,expected,.01);
    if(s.circulatingVoidPct>.01)phaseSteps++;
    if(s.risDeliveredAccumulatorKgS>1&&s.phaseChangeKgS<0)accumulatorCoolingSteps++;
  }
  assert.ok(phaseSteps>100,'bilan vérifié pendant l’ébullition et la détente');
  assert.ok(accumulatorCoolingSteps>100,'bilan vérifié pendant la condensation avec les accumulateurs');
});

test('ASG : hystérésis 90/10, quatre commandes indépendantes et diesels malgré manque de tension',()=>{
  const m=E.make();E.initiate(m,'voltage');E.initiate(m,'asg',{source:'cc-protect'});E.advance(m,6);
  assert.equal(m.state.gv[0].asgKgS,0);assert.ok(m.state.gv[1].asgKgS>0);
  E.advance(m,10);assert.ok(m.state.gv.every(g=>g.asgKgS>0));
  const g=m.state.gv[0],setLevel=pct=>{g.waterKg=E.C.gvKgPerMetre*(12.5+4.5*pct/100);};
  setLevel(91);E.step(m,.1);assert.equal(g.asgRunning,false);
  setLevel(50);E.step(m,.1);assert.equal(g.asgRunning,false);
  setLevel(9);E.step(m,.1);assert.equal(g.asgRunning,true);
  m.controls.asgManual=true;m.controls.asgTrainEnabled=[false,true,false,true];
  E.advance(m,25);assert.ok(m.state.gv[0].asgKgS<.001&&m.state.gv[2].asgKgS<.001);
  assert.ok(m.state.gv[1].asgKgS>0&&m.state.gv[3].asgKgS>0);
  assert.ok(m.state.gv.every(g=>g.feedKgS===0),'ARE perdue après AAR');
});

test('RIS : arrêt manuel des pompes, accumulateurs passifs et recirculation à la température du puisard',()=>{
  const m=E.make();E.setRisOperation(m,'on');E.advance(m,3);
  m.state.pressureBar=80;m.state.risTankRemainingKg=0;
  m.state.sumpKg=1000;m.state.sumpTempC=60;m.state.sumpBoronPpm=3000;
  m.state.sumpEnergyJ=1000*E.C.primaryCpJkgK*60;m.state.sumpBoron=3e6;
  m.controls.risSourceMode='recirculation';E.step(m,.1);
  assert.ok(m.state.risMpKgS>0);assert.ok(m.state.sumpKg<1000);
  assert.equal(m.state.risTankRemainingKg,0);
  const parcel=m.state.risPipe.at(-1);close(parcel.tempC,60);close(parcel.boronPpm,3000);
  E.setRisOperation(m,'off');m.state.pressureBar=30;E.step(m,.1);
  assert.equal(m.state.risMpKgS,0);assert.equal(m.state.risBpKgS,0);
  assert.ok(m.state.accumulatorKgS>0,'arrêter les pompes n’isole pas les accumulateurs');
});

test('états RP / AN-GV / CIA : tolérance RP jusqu’à 307,5 °C et domaine non applicable en CIA',()=>{
  const s=E.make().state;
  assert.equal(E.reactorOperatingState(s).code,'RP');
  for(const pressure of [150,155,160]){s.pressureBar=pressure;assert.equal(E.isPtOutside(s),false);}
  for(const pressure of [149.99,160.01]){s.pressureBar=pressure;assert.equal(E.isPtOutside(s),true);}
  s.pressureBar=155;s.tavgC=320;assert.equal(E.isPtOutside(s),true,'température RP hors domaine');
  for(const temp of [306.5,307.3,307.5]){
    s.tavgC=temp;assert.equal(E.isPtOutside(s),false,'borne chaude RP incluse');
  }
  s.tavgC=307.5001;assert.equal(E.isPtOutside(s),true,'clignotement strictement au-dessus de 307,5 °C');
  s.tavgC=297.19;assert.equal(E.isPtOutside(s),true);
  Object.assign(s,{tavgC:227.2,powerPct:.001,reactivityPcm:-5500});
  assert.equal(E.reactorOperatingState(s).code,'AN/GV');
  assert.equal(E.isPtOutside(s),true,'cas fourni : cœur convergé, 227,2 °C et 155 bar');
  s.pressureBar=70;assert.equal(E.isPtOutside(s),false);
  s.tavgC=150;s.pressureBar=27;assert.equal(E.isPtOutside(s),false);
  s.pressureBar=32;assert.equal(E.isPtOutside(s),true);
  for(const reactivityPcm of [-5000,-1,-.001]){
    s.reactivityPcm=reactivityPcm;s.powerPct=.01;
    const state=E.reactorOperatingState(s);
    assert.equal(state.code,'AN/GV','cœur sous-critique et puissance quasi nulle, sans marge de 5 000 pcm');
    assert.equal(state.coreSubcritical,true);assert.equal(state.neutronPowerNearZero,true);
    assert.equal(E.isPtOutside(s),true,'domaine strict AN/GV appliqué à 150 °C / 32 bar');
  }
  for(const reactivityPcm of [0,1]){
    s.reactivityPcm=reactivityPcm;
    assert.equal(E.reactorOperatingState(s).code,'RP','la puissance seule ne signifie pas sous-criticité');
  }
  s.reactivityPcm=-1;s.powerPct=.01001;
  assert.equal(E.reactorOperatingState(s).code,'RP','puissance au-dessus du seuil quasi nul');
  s.powerPct=.001;
  for(const field of ['tripDemandAt','tripAt','risDemandAt','risAt']){
    s[field]=0;assert.equal(E.reactorOperatingState(s).code,'CIA');
    assert.equal(E.reactorOperatingState(s).standardApplicable,false);
    assert.equal(E.isPtOutside(s),false,'le domaine standard ne s’applique plus');s[field]=null;
  }
});

test('fins de partie : dénoyage ou PLIN >590, connexion RRA gardée par P–T et état réel du cœur',()=>{
  const dry=E.make();dry.state.primaryMassKg=.2*E.C.nominalPrimaryMassKg;E.step(dry,.1);
  assert.equal(dry.state.endState,null);assert.equal(dry.state.coreDamageWarning.remainingS,5);
  E.advance(dry,5);assert.equal(dry.state.endState,null,'strictement plus de cinq secondes');
  E.step(dry,.1);
  assert.equal(dry.state.endState,'melted');assert.match(dry.state.endReason,/Dénoyage/);
  const time=dry.state.time;E.advance(dry,5);close(dry.state.time,time);
  const high=E.make();high.controls.fxYUngraped=3;high.controls.protectionsEnabled=false;high.controls.risEnabled=false;
  E.advance(high,5.3);
  assert.equal(high.state.endState,'melted');assert.ok(high.state.peakLinearWcm>590);
  const safe=E.make();assert.equal(E.connectRra(safe),false);
  Object.assign(safe.state,{tavgC:150,pressureBar:27,powerPct:.001,reactivityPcm:-5500});
  assert.equal(E.rraConditions(safe.state).allowed,true);assert.equal(E.connectRra(safe),true);
  assert.equal(safe.state.endState,'safe');assert.equal(safe.state.rraConnected,true);
  assert.equal(safe.state.tripAt,null);assert.equal(safe.state.tripDemandAt,null);
  assert.equal(safe.state.risDemandAt,null);assert.equal(safe.state.risAt,null);
  assert.equal(E.reactorOperatingState(safe.state).code,'AN/GV','la connexion ne déclenche pas de CIA');
  for(const [temperature,pressure] of [[181,27],[150,32],[89,27],[150,24]]){
    const m=E.make();Object.assign(m.state,{tavgC:temperature,pressureBar:pressure,powerPct:.001,reactivityPcm:-5500});
    assert.equal(E.connectRra(m),false);
  }
});

test('RRA : aucun critère de réactivité ni AAR préalable, puissance quasi nulle et cœur couvert requis',()=>{
  for(const tripAt of [null,0]){
    for(const [temperature,pressure] of [[90,25],[180,31]]){
      const m=E.make(),s=m.state;
      Object.assign(s,{tripAt,tavgC:temperature,pressureBar:pressure,powerPct:.01});
      for(const reactivityPcm of [-5500,-1,0,500]){
        s.reactivityPcm=reactivityPcm;
        assert.equal(E.rraConditions(s).allowed,true,'bornes P–T et puissance incluses ; réactivité libre');
        assert.deepEqual(E.rraConditions(s).reasons,[]);
        const connect=E.make();Object.assign(connect.state,{tripAt,tavgC:temperature,
          pressureBar:pressure,powerPct:.01,reactivityPcm});
        assert.equal(E.connectRra(connect),true);
        assert.equal(connect.state.endState,'safe');
        assert.equal(connect.state.tripAt,tripAt,'la connexion n’ajoute pas d’AAR');
        assert.equal(connect.state.tripDemandAt,null);assert.equal(connect.state.risDemandAt,null);
      }
      s.powerPct=.01001;
      assert.equal(E.connectRra(m),false,'la puissance neutronique reste un critère');
      assert.match(E.rraConditions(s).reasons.join(' '),/puissance neutronique/);
      Object.assign(s,{powerPct:.001,reactivityPcm:500});
      s.inventory.levelM=E.CPP_CORE_TOP_M-.01;
      assert.equal(E.connectRra(m),false);assert.ok(E.rraConditions(s).reasons.includes('cœur couvert'));
      s.inventory.levelM=E.CPP_CORE_TOP_M;s.endState='melted';
      assert.equal(E.connectRra(m),false);
    }
  }
});

test('SVG inventaire et P–T : vraies liaisons temps réel, remplissages, point et trace historique',()=>{
  const m=E.make(),inv=svgSurface('CPP-inventaire.svg'),pt=svgSurface('Diagramme-PT.svg');
  let snapshot=E.instrumentSnapshot(m);inv.update(snapshot);
  for(const node of inv.root.querySelectorAll('[data-value]'))
    assert.equal(node.getAttribute('data-available'),'true');
  const water=inv.root.querySelectorAll('[data-level-value]');assert.equal(water.length,9);
  const initialHeights=water.map(n=>Number(n.getAttribute('height')));
  m.state.primaryMassKg=.8*E.C.nominalPrimaryMassKg;E.step(m,.1);snapshot=E.instrumentSnapshot(m);inv.update(snapshot);
  assert.equal(Number(water.at(-1).getAttribute('height'))>0,true);
  assert.ok(water.some((n,i)=>Number(n.getAttribute('height'))<initialHeights[i]),'le remplissage suit la baisse de masse');
  const marker=inv.get('cpp-waterline');
  assert.ok(marker.getAttribute('d').includes(String(Number(marker.getAttribute('data-metres-zero'))
    -Number(marker.getAttribute('data-metres-scale'))*snapshot.inventory.levelM)));
  const data={...snapshot,ptCurves:{lower:[[10,5],[300,140]],upper:[[10,31],[300,155]],saturation:[[100,1],[300,85]]},
    ptHistory:[{tavg:306.5,pressure:155},{tavg:200,pressure:50}]};
  pt.update(data);close(Number(pt.get('pt-point').getAttribute('cx')),105+snapshot.tavgC/370*1060);
  const tolerance=pt.get('pt-production-tolerance');
  close(Number(tolerance.getAttribute('x'))+Number(tolerance.getAttribute('width')),105+307.5/370*1060);
  assert.equal(pt.root.querySelector('[data-text-value="operatingState.code"]').textContent,snapshot.operatingState.code);
  assert.match(pt.get('pt-trace').getAttribute('d'),/L/);assert.match(pt.get('pt-domain').getAttribute('d'),/Z$/);
  pt.update({...data,alarms:{...data.alarms,pt:true}});assert.equal(pt.get('pt-point').getAttribute('data-flow-alarm'),'true');
  Object.assign(m.state,{tavgC:227.2,pressureBar:155,powerPct:.01,reactivityPcm:-1});
  snapshot=E.instrumentSnapshot(m);pt.update({...data,...snapshot});
  assert.equal(snapshot.operatingState.code,'AN/GV');
  assert.equal(snapshot.alarms.pt,true);
  assert.equal(pt.root.querySelector('[data-text-value="operatingState.code"]').textContent,'AN/GV');
  assert.equal(pt.get('pt-point').getAttribute('data-flow-alarm'),'true','l’alarme suit le domaine AN/GV strict');
  m.state.tripDemandAt=0;snapshot=E.instrumentSnapshot(m);pt.update({...data,...snapshot});
  assert.equal(pt.root.querySelector('[data-text-value="operatingState.code"]').textContent,'CIA');
  assert.equal(pt.get('pt-point').getAttribute('data-flow-alarm'),'false','CIA reste prioritaire');
});
