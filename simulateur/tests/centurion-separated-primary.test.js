const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine'),State=require('../centurion-state');
const energyRate=require('./helpers/primary-energy');
const near=(a,b,t=1e-5)=>assert.ok(Math.abs(a-b)<=t,`${a} ≠ ${b}`);

function saturatedPlant(alpha=0,heater=2160,p=80){
  const m=E.make(),s=m.state,u=m.controls,t=E.saturationTemperatureC(p),density=E.saturatedWaterDensities(t);
  density.liquid=E.liquidWaterDensityKgM3(t,p);
  const volume=s.inventory.capacityM3,raw=E.CPP_GEOMETRY.reduce((n,g)=>n+g.volume,0);
  const vp=volume*40/raw,vb=volume-vp;
  const bulkMass=vb*((1-alpha)*density.liquid+alpha*density.vapor);
  const mp=vp*(.4*density.liquid+.6*density.vapor);
  Object.assign(s,{primaryMassKg:bulkMass+mp,pressureBar:p,tavgC:t,hotC:t,coldC:t,tRicC:t,
    fuelC:t,pzrLevelPct:40,powerPct:1e-6,precursors:s.precursors.map(()=>0),rcvPipe:[],risPipe:[],
    vaporMassKg:vb*alpha*density.vapor+vp*.6*density.vapor,primaryPumpsStopped:true,
    turbinePct:0,demandPct:0});
  s.primaryEnergyJ=s.primaryMassKg*E.C.primaryCpJkgK*t+s.vaporMassKg*E.latentHeatJkg(p);
  s.boronInventory=(s.primaryMassKg-s.vaporMassKg)*1200;
  s.gv.forEach(g=>Object.assign(g,{tempC:t,pressureBar:p,feedKgS:0}));
  s.loops.forEach(l=>Object.assign(l,{hotC:t,coldC:t,flowKgS:0,forcedFlowKgS:0,naturalFlowKgS:0}));
  Object.assign(u,{protectionsEnabled:false,protectionGraphMode:true,demandPct:0,
    manualHeaterKW:heater,rcvChargeM3h:0,rcvLetdownOrifices:[false,false,false],
    gvManualFeedPct:[0,0,0,0],gctAOpeningPressureBar:180});
  E.initializePrimaryThermalState(s);return m;
}

test('vapeur circulante : zéro au nominal malgré la bulle PZR, et alpha volumique distinct du titre massique',()=>{
  const nominal=E.make().state;
  near(nominal.circulatingVoidPct,0);assert.ok(nominal.pzrVaporMassKg>2000);
  near(nominal.pzrLevelPct,42,1e-5);
  for(const alpha of [.01,.1,.5]){
    const s=saturatedPlant(alpha).state;
    near(s.circulatingVoidPct,100*alpha,1e-7);
    assert.ok(s.circulatingVaporMassKg/(s.primaryMassKg-s.thermalNodes.pzrMassKg)<alpha);
    near(s.vaporMassKg,s.circulatingVaporMassKg+s.pzrVaporMassKg);
  }
});

test('PZR séparé : chauffage après saturation, hausse de pression et température PZR distincte du CPP',()=>{
  const off=saturatedPlant(0,0),on=saturatedPlant(0,2160);
  E.advance(off,120);E.advance(on,120);
  assert.ok(on.state.pressureBar>off.state.pressureBar+1,'pression sensible au chauffage local');
  assert.ok(on.state.pzrTempC>on.state.tavgC+.5,'le PZR peut chauffer sans imposer Tsat à TMOY');
  assert.ok(Math.abs(on.state.tavgC-off.state.tavgC)<1);
  assert.equal(on.state.heaterKW,2160);assert.equal(on.state.endState,null);
});

test('échange cœur : effet du vide et de la marge critique, sans modifier les 10 MW/°C nominaux',()=>{
  const wet=saturatedPlant(.01,0,30),voided=saturatedPlant(.5,0,30);
  for(const m of [wet,voided]){m.state.fuelC=m.state.tavgC+100;m.state.dnbr=.5;}
  const before=voided.state.fuelC;
  E.step(wet,.1);E.step(voided,.1);
  assert.ok(voided.state.coreExchangeMWC<wet.state.coreExchangeMWC*.5);
  assert.ok(voided.state.fuelC>wet.state.fuelC);
  near((voided.state.fuelC-before)*E.C.fuelHeatCapacityJk,
    (voided.state.thermalPowerMW-voided.state.coreTransferMW)*1e6*.1,.001);
  const nominal=E.make();E.step(nominal,.1);near(nominal.state.coreExchangeMWC,10);
});

test('aspersion : réponse du modèle séparé voisine de −0,15 bar/s et bilan global conservé',()=>{
  const m=E.make();m.controls.manualSprayPct=100;E.advance(m,15);
  const s=m.state,p=s.pressureBar,u=s.primaryEnergyJ;E.step(m,.1);
  near((s.pressureBar-p)/.1,-.15,.025);
  near(s.primaryEnergyJ-u,energyRate(E,s,p)*.1,.002);
});

test('brèche : masse/énergie conservées avec phases séparées et inventaire sans double comptage',()=>{
  const m=E.make();E.initiate(m,'break',{areaCm2:300});let boiling=0;
  for(let i=0;i<3000&&!m.state.endState;i++){
    const s=m.state,p=s.pressureBar,u=s.primaryEnergyJ,mass=s.primaryMassKg;
    E.step(m,.1);const b=E.primaryMassBalance(s);
    near(s.primaryMassKg-mass,b.netKgS*.1,1e-7);
    near(s.primaryEnergyJ-u,energyRate(E,s,p)*.1,.002);
    near(Object.values(s.inventory.components).reduce((n,g)=>n+g.massKg,0),s.primaryMassKg-s.vaporMassKg,.001);
    near(s.circulatingVaporMassKg+s.pzrVaporMassKg,s.vaporMassKg);
    assert.ok(s.circulatingVoidPct>=0&&s.circulatingVoidPct<=100);
    assert.ok(s.coreExchangeMWC>0&&s.coreExchangeMWC<=10);
    if(s.circulatingVoidPct>.01)boiling++;
  }
  assert.ok(boiling>100);
});

test('mesures : tableau de bord, graphiques et CC partagent vide et échange effectif',()=>{
  const History=require('../centurion-history'),m=saturatedPlant(.1),v=E.instrumentSnapshot(m);
  near(v.circulatingVoidPct,10);near(E.controlSignals(m).voidSignal[0],10);
  const point=E.historyPoint(m),defs=History.catalog(E,m);
  near(defs.find(d=>d.id==='circulatingVoidPct').value(point),10);
  assert.equal(E.controlSignals(m).voidSignal[1],'% vol.');
});

test('sauvegarde : migration v12, énergie totale conservée et reprise déterministe des nœuds',()=>{
  const m=E.make(),editor=mode=>({mode,enabled:false,graph:{format:'SimuREP-Regulation',version:1,nodes:[],links:[]},runtime:[]});
  const ui={speed:200,diagram:'pzr',selectedGv:1,activeView:'synoptiques',historyFollowing:true,historyEndS:null,
    historyWindow:'1800',traceSet:'flows',coreTrailWindow:'300',ptTrailWindow:'14400',alarmLimits:{}};
  E.advance(m,1);const raw=State.write(E,m,{regul:editor('regul'),protect:editor('protect')},ui,null);
  const restored=State.read(E,raw).model;E.step(m,.1);E.step(restored,.1);assert.deepEqual(restored,m);
  const old=structuredClone(raw);old.engineRevision='20261016-pzr-energy-v12';
  const s=old.model.state;delete s.thermalNodes;s.pzrEnergyOffsetJ=-5e6;
  for(const k of ['circulatingVoidPct','circulatingVaporMassKg','pzrVaporMassKg','coreExchangeMWC','coreExchangeFactor','pzrTempC'])delete s[k];
  const energy=s.primaryEnergyJ+s.pzrEnergyOffsetJ,loaded=State.read(E,old).model.state;
  near(loaded.primaryEnergyJ+loaded.pzrEnergyOffsetJ,energy,.001);
  assert.equal(loaded.primaryMassKg,s.primaryMassKg);assert.equal(loaded.pressureBar,s.pressureBar);
  assert.ok(loaded.thermalNodes);near(loaded.circulatingVoidPct,0);
});
