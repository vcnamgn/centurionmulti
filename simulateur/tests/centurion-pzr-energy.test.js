const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine'),State=require('../centurion-state');
const near=(a,b,t=.002)=>assert.ok(Math.abs(a-b)<=t,`${a} ≠ ${b}`);
const totalEnergy=s=>s.primaryEnergyJ+s.pzrEnergyOffsetJ;

function isolatedPlant(p=30,heater=0,fullLiquid=false){
  const m=E.make(),s=m.state,u=m.controls;
  const T=fullLiquid?180:E.saturationTemperatureC(p),total=s.inventory.capacityM3;
  const pzr=total*E.CPP_GEOMETRY.find(g=>g.id==='pzr').volume/E.CPP_GEOMETRY.reduce((n,g)=>n+g.volume,0);
  const vaporVolume=fullLiquid?0:.6*pzr,liquidVolume=total-vaporVolume;
  const liquid=liquidVolume*E.liquidWaterDensityKgM3(T,p);
  const vapor=vaporVolume*E.saturatedWaterDensities(T).vapor;
  Object.assign(s,{pressureBar:p,tavgC:T,fuelC:T,powerPct:1e-6,precursors:s.precursors.map(()=>0),
    primaryMassKg:liquid+vapor,vaporMassKg:vapor,vaporEnergyJ:vapor*E.latentHeatJkg(p),
    pzrThermalPressureBar:p,heaterKW:heater,primaryPumpsStopped:true,turbinePct:0,demandPct:0,
    pzrLevelPct:fullLiquid?100:40,saturationC:E.saturationTemperatureC(p),
    boronInventory:(liquid+vapor)*1200,rcvPipe:[],risPipe:[]});
  s.primaryEnergyJ=s.primaryMassKg*E.C.primaryCpJkgK*T+s.vaporEnergyJ;
  s.inventory=E.cppInventory(liquid,T,p);
  s.loops.forEach(l=>Object.assign(l,{flowKgS:0,forcedFlowKgS:0,naturalFlowKgS:0,coldC:T,hotC:T,vesselDeltaBar:0}));
  s.gv.forEach(g=>Object.assign(g,{tempC:T,pressureBar:E.saturationPressureBar(T),feedKgS:0}));
  Object.assign(u,{protectionsEnabled:false,protectionGraphMode:true,rcvChargeM3h:0,
    rcvLetdownOrifices:[false,false,false],demandPct:0,gvManualFeedPct:[0,0,0,0],manualHeaterKW:heater,
    manualSprayPct:0,gctAOpeningPressureBar:180});
  return m;
}

test('chaufferettes en diphasique à 30/80/155 bar : les 250 kJ sont conservés et la pression réagit',()=>{
  for(const p of [30,80,155]){
    const off=isolatedPlant(p),on=isolatedPlant(p,2500),initial=totalEnergy(on.state);
    E.step(off,.1);E.step(on,.1);
    const s=on.state;
    assert.equal(E.instrumentSnapshot(on).heaterImmersionPct,100);
    assert.equal(s.heaterKW,2500);assert.ok(s.pressureBar>off.state.pressureBar);
    near(s.primaryEnergyJ-off.state.primaryEnergyJ,250000);
    near(totalEnergy(s)-totalEnergy(off.state),250000);
    near(totalEnergy(s)-initial,
      (s.coreTransferMW+s.pumpHeatMW-s.totalGvMW+(2500-E.C.pzrPassiveTransferKW)/1000)*1e6*.1);
    near(s.pzrHeatToPrimaryMW,(2500-E.C.pzrPassiveTransferKW)/1000,1e-10);
    near(s.pzrHeatReserveMW,0,1e-10);
    near(s.tavgC,E.saturationTemperatureC(s.pressureBar),1e-9);
  }
});

test('CPP plein de liquide : la chaleur augmente l’énergie et la pression, sans poche artificielle',()=>{
  const off=isolatedPlant(30,0,true),on=isolatedPlant(30,2500,true);
  E.step(off,.1);E.step(on,.1);
  near(on.state.primaryEnergyJ-off.state.primaryEnergyJ,250000);
  assert.ok(on.state.pressureBar>off.state.pressureBar);
  assert.equal(on.state.vaporMassKg,0);near(on.state.pzrHeatReserveMW,0);
  near(on.state.inventory.overfillKg,0);
});

test('transition poche PZR → vapeur suivie : chaleur répartie une seule fois et sans seuil de saturation',()=>{
  const p=80,T=E.saturationTemperatureC(p),total=E.make().state.inventory.capacityM3;
  const rho=E.liquidWaterDensityKgM3(T,p),rhoV=E.saturatedWaterDensities(T).vapor;
  for(const vaporVolume of [0,1,12,23.59,23.6,23.61,23.999,24]){
    const vaporKg=vaporVolume*rhoV,massKg=(total-24)*rho+vaporKg;
    const energy=massKg*E.C.primaryCpJkgK*T+vaporKg*E.latentHeatJkg(p);
    const before={massKg,vaporKg,tempC:T,pressureBar:p};
    const r=E.advancePrimaryPressure(before,massKg,energy,2.5,0,p,40,.1);
    near(r.bulkHeatMW,2.5*(1-(24-vaporVolume)/24*Math.min(1,(24-vaporVolume)/.4)),1e-10);
    near(r.bulkHeatMW+r.reserveHeatMW,2.5,1e-10);
    near(r.energyJ-energy+r.reserveHeatMW*1e6*.1,250000);
    assert.ok(r.pressureBar>p);
  }
});

test('fin de remplissage liquide : transfert continu vers le liquide sur les derniers 0,4 m³',()=>{
  const p=80,T=180,total=E.make().state.inventory.capacityM3,rho=E.liquidWaterDensityKgM3(T,p);
  for(const free of [.401,.4,.399,.2,.001,.0000001,0]){
    const massKg=(total-free)*rho,energy=massKg*E.C.primaryCpJkgK*T;
    const r=E.advancePrimaryPressure({massKg,vaporKg:0,tempC:T,pressureBar:p},massKg,energy,2.5,0,p,100,.1);
    near(r.reserveHeatMW,2.5*Math.min(1,free/.4),1e-6);
    near(r.energyJ-energy+r.reserveHeatMW*1e6*.1,250000);
    assert.ok(r.pressureBar>p);
  }
});

test('aspersion BF/auxiliaire : transfert interne, bilan global égal à chaufferettes moins pertes effectives',()=>{
  for(const auxiliary of [false,true]){
    const m=E.make(),s=m.state,u=m.controls;
    u.protectionsEnabled=false;u.manualHeaterKW=0;
    if(auxiliary)u.manualAuxiliarySprayM3h=8;else u.manualSprayPct=100;
    const old=totalEnergy(s);E.step(m,.1);
    assert.ok(s.pzrHeatToPrimaryMW>0);assert.ok(s.pzrHeatReserveMW<0);
    near(totalEnergy(s)-old,
      (s.coreTransferMW+s.pumpHeatMW-s.totalGvMW-E.C.pzrPassiveTransferKW/1000)*1e6*.1);
    near(s.pzrHeatToPrimaryMW+s.pzrHeatReserveMW,-E.C.pzrPassiveTransferKW/1000,1e-10);
  }
});

test('panne des chaufferettes : la chaleur suit la puissance réellement réalisée',()=>{
  const off=isolatedPlant(30),failed=isolatedPlant(30,2500);
  E.setEquipmentFault(failed,'heater','off');E.step(off,.1);E.step(failed,.1);
  assert.equal(failed.state.heaterKW,0);near(totalEnergy(failed.state),totalEnergy(off.state));
});

test('commande issue de CC-RÉGUL en saturation : la puissance de sortie entre dans le bilan',()=>{
  const off=isolatedPlant(80),on=isolatedPlant(80);
  on.controls.pressureGraphHeaterKW=2160;
  E.step(off,.1);E.step(on,.1);
  assert.equal(on.state.heaterKW,2160);
  near(on.state.primaryEnergyJ-off.state.primaryEnergyJ,216000);
  assert.ok(on.state.pressureBar>off.state.pressureBar);
});

test('sauvegarde v12 : réserve thermique reprise ; migration v11 sans altérer l’état physique',()=>{
  const m=E.make();m.controls.manualSprayPct=100;E.advance(m,1);
  const editor=mode=>({mode,enabled:false,graph:{format:'SimuREP-Regulation',version:1,nodes:[],links:[]},runtime:[]});
  const ui={speed:200,diagram:'pzr',selectedGv:1,activeView:'synoptiques',historyFollowing:true,historyEndS:null,
    historyWindow:'1800',traceSet:'flows',coreTrailWindow:'300',ptTrailWindow:'14400',alarmLimits:{}};
  const raw=State.write(E,m,{regul:editor('regul'),protect:editor('protect')},ui,null);
  const loaded=State.read(E,JSON.stringify(raw));E.step(m,.1);E.step(loaded.model,.1);
  assert.deepEqual(loaded.model,m);
  const old=structuredClone(raw);old.engineRevision='20261015-equipment-faults-v11';
  for(const key of ['pzrEnergyOffsetJ','pzrHeatToPrimaryMW','pzrHeatReserveMW','sprayCoolingKW'])delete old.model.state[key];
  const migrated=State.read(E,old);
  assert.equal(migrated.model.state.pzrEnergyOffsetJ,0);
  for(const key of ['primaryEnergyJ','primaryMassKg','vaporEnergyJ','pressureBar','tavgC'])
    assert.equal(migrated.model.state[key],raw.model.state[key]);
  assert.deepEqual(migrated.model.state.history,raw.model.state.history);
  E.step(migrated.model,.1);assert.ok(Number.isFinite(migrated.model.state.primaryEnergyJ));
  const invalid=structuredClone(raw);delete invalid.model.state.pzrEnergyOffsetJ;
  assert.throws(()=>State.read(E,invalid),/pzrEnergyOffsetJ/);
});
