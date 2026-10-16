const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine.js');
const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

function stoppedPlant(naturalFlow=250) {
  const model=E.make();
  model.controls.risEnabled=false;
  model.controls.asgAvailable=false; // Isoler ici le seul échange primaire–GV.
  model.controls.gctAOpeningPressureBar=65; // Maintenir une source froide par rejet vapeur.
  model.controls.naturalCirculationKgSPerLoop=naturalFlow;
  E.initiate(model,'ris');
  E.tripPrimaryPumps(model);
  return model;
}

test('GMPP : 6 MW par entraînement en service, ajoutés uniquement au bilan primaire',()=>{
  for(const running of [4,3,0]){
    const m=E.make(),s=m.state,dt=.1;m.controls.protectionsEnabled=false;
    s.loops.forEach((loop,i)=>{loop.pumpStopped=i>=running;});
    // Annuler l'échange GV pendant ce seul pas pour mesurer l'énergie déposée.
    s.gv.forEach(g=>{g.tempC=s.tavgC;g.pressureBar=E.saturationPressureBar(g.tempC);});
    const oldEnergy=s.primaryEnergyJ,oldFuel=s.fuelC,oldMass=s.primaryMassKg;
    E.step(m,dt);
    close(s.pumpHeatMW,running*6);close(s.totalGvMW,0);close(s.primaryMassKg,oldMass);
    close((s.primaryEnergyJ-oldEnergy)/1e6,(s.coreTransferMW+running*6+s.pzrHeatToPrimaryMW)*dt,1e-6);
    close((s.fuelC-oldFuel)*E.C.fuelHeatCapacityJk/1e6,
      (s.thermalPowerMW-s.coreTransferMW)*dt);
    close(s.thermalPowerMW,E.C.nominalThermalMW);
    close(E.instrumentSnapshot(m).pumpHeatMW,running*6);
    close(E.primaryFlowDiagnostics(m).pumpHeatMW,running*6);
    close(s.history[0].pumpHeatMW,running*6);
  }
});

test('GMPP : permanent initial équilibré, arrêt électrique distinct de l’inertie et du thermosiphon',()=>{
  const m=E.make(),s=m.state;
  close(s.pumpHeatMW,24);close(s.totalGvMW,E.C.nominalPrimaryHeatMW);
  close(s.totalGvMW,s.coreTransferMW+s.pumpHeatMW+s.pzrHeatToPrimaryMW);
  E.step(m,.1);close(s.tavgC,E.C.primaryMeanC,1e-9);
  close(s.gv[0].tempC,E.C.steamTempC,1e-9);
  E.advance(m,60);assert.ok(Math.abs(s.tavgC-E.C.primaryMeanC)<.1);
  close(s.pumpHeatMW,24);close(s.electricMW,1300,1e-6); // précision de 1 W électrique
  m.controls.demandPct=80;E.advance(m,1);close(s.pumpHeatMW,24);
  E.initiate(m,'trip');assert.equal(s.pumpHeatMW,24,'un AAR seul laisse les GMPP alimentées');
  E.step(m,.1);close(s.pumpHeatMW,24);
  E.initiate(m,'voltage');close(s.pumpHeatMW,0);
  E.step(m,.1);close(s.pumpHeatMW,0);
  assert.ok(s.loops.every(l=>l.forcedFlowKgS>0&&l.pumpHeatMW===0));
  E.advance(m,70);close(s.pumpHeatMW,0);
  assert.ok(s.loops.some(l=>l.naturalFlowKgS>0),'le thermosiphon ne crée pas un apport électrique');
});

test('thermosiphon : après ralentissement, 200–300 kg/s par boucle évacuent la puissance vers les GV',()=>{
  const model=stoppedPlant(),noCirculation=stoppedPlant(0);
  E.advance(model,180);E.advance(noCirculation,180);
  const s=model.state;
  for(const loop of s.loops) {
    assert.equal(loop.forcedFlowKgS,0);
    assert.ok(loop.naturalFlowKgS>=200&&loop.naturalFlowKgS<=300);
    assert.equal(loop.flowKgS,loop.naturalFlowKgS);
    assert.equal(loop.pumpHeadColdBar,0);assert.equal(loop.vesselDeltaBar,0);
  }
  close(s.coreFlowFraction,s.loops.reduce((sum,loop)=>sum+loop.flowKgS,0)/E.C.nominalPrimaryFlowKgS);
  assert.equal(s.sprayFlowM3h,0,'le thermosiphon ne crée pas de pression motrice d’aspersion');
  assert.ok(s.totalGvMW>100);assert.ok(s.gv.every(g=>g.heatMW>0));
  assert.equal(noCirculation.state.coreFlowFraction,0);
  assert.equal(noCirculation.state.totalGvMW,0);
  assert.ok(s.tavgC<noCirculation.state.tavgC-5);
  assert.ok(s.fuelC<noCirculation.state.fuelC-5);
  E.advance(model,420);
  assert.ok(s.loops.every(loop=>loop.flowKgS>=200&&loop.flowKgS<=300));
});

test('thermosiphon : disparaît sans écart thermique, sans eau au GV ou sans inventaire primaire disponible',()=>{
  const model=stoppedPlant();E.advance(model,60);
  const s=model.state;
  s.gv[0].tempC=s.tavgC;s.gv[1].waterKg=0;
  E.step(model,.1);
  assert.equal(s.loops[0].naturalFlowKgS,0);assert.equal(s.gv[0].heatMW,0);
  assert.equal(s.loops[1].naturalFlowKgS,0);assert.equal(s.gv[1].heatMW,0);
  assert.ok(s.loops[2].naturalFlowKgS>0);
  s.primaryMassKg=.4*E.C.nominalPrimaryMassKg;E.step(model,.1);
  assert.equal(s.coreFlowFraction,0);assert.equal(s.totalGvMW,0);
});

test('bilan thermique en thermosiphon : même échange retiré du combustible, transféré au primaire puis aux GV',()=>{
  const model=stoppedPlant();E.advance(model,180);
  const s=model.state,oldFuel=s.fuelC,oldWater=s.tavgC,oldMass=s.primaryMassKg,oldReserve=s.pzrEnergyOffsetJ;
  // Isoler ce bilan thermique du transit RCV régénéré, testé séparément.
  s.rcvPipe.forEach(parcel=>{parcel.tempC=oldWater;});
  const oldGv=s.gv.map(g=>({tempC:g.tempC,energyJ:E.gvThermalCapacityJk(g.waterKg)*g.tempC})),dt=.1;
  E.step(model,dt);
  const fuelMJ=(s.fuelC-oldFuel)*E.C.fuelHeatCapacityJk/1e6;
  const waterMJ=(s.tavgC-oldWater)*oldMass*E.C.primaryCpJkgK/1e6;
  const gvMJ=s.gv.reduce((sum,g,i)=>sum+(g.thermalEnergyJ-oldGv[i].energyJ)/1e6,0);
  const secondaryExternalMW=s.gv.reduce((sum,g,i)=>sum
    +(g.feedKgS*E.C.secondaryCpJkgK*E.C.areFeedTempC
      +g.asgKgS*E.C.secondaryCpJkgK*E.C.asgFeedTempC
      -g.steamKgS*(E.C.secondaryCpJkgK*oldGv[i].tempC+g.steamLatentJkg))/1e6,0);
  close(fuelMJ,(s.thermalPowerMW-s.coreTransferMW)*dt);
  close(waterMJ,(s.coreTransferMW-s.totalGvMW+s.pzrHeatToPrimaryMW)*dt);
  close(gvMJ,(s.totalGvMW+secondaryExternalMW)*dt);
  close(fuelMJ+waterMJ+gvMJ+(s.pzrEnergyOffsetJ-oldReserve)/1e6,
    (s.thermalPowerMW+secondaryExternalMW+(s.heaterKW-E.C.pzrPassiveTransferKW)/1000)*dt);
});

test('RIS : eau à 20 °C et 2 500 ppm, bilan de mélange et refroidissement transmis au combustible',()=>{
  const model=E.make(),reference=E.make(),s=model.state;
  assert.equal(model.controls.risBoronPpm,2500);assert.equal(E.C.risInjectionTempC,20);
  const mass=s.primaryMassKg,temp=s.tavgC,boron=s.boronPpm,injectedKg=10,dt=.1;
  s.risPipe.push({at:0,massKg:injectedKg,boronPpm:model.controls.risBoronPpm});
  E.step(model,dt);E.step(reference,dt);
  close(s.risCoolingMW,injectedKg/dt*E.C.primaryCpJkgK*(temp-20)/1e6);
  close(reference.state.tavgC-s.tavgC,injectedKg/(mass+injectedKg)*(temp-20));
  close(s.primaryMassKg,mass+injectedKg);
  close(s.boronPpm,(mass*boron+injectedKg*2500)/(mass+injectedKg));
  E.advance(model,5);E.advance(reference,5);
  assert.ok(s.tavgC<reference.state.tavgC);
  assert.ok(s.fuelC<reference.state.fuelC);
});

test('RIS : réserve finie, signalement unique de son épuisement et fin du débit après transit',()=>{
  const m=E.make(),s=m.state;E.initiate(m,'ris');E.advance(m,3);
  s.pressureBar=80;s.risTankRemainingKg=100;
  for(let i=0;i<100;i++){
    s.pressureBar=80;s.pzrThermalPressureBar=80;E.step(m,.1);
  }
  assert.equal(s.risTankRemainingKg,0);assert.equal(s.risDeliveredKgS,0);
  assert.equal(s.risMpKgS,0);assert.equal(s.risBpKgS,0);assert.equal(s.risEnabled,true);
  assert.equal(s.events.filter(e=>/Réserve RIS épuisée/.test(e.text)).length,1);
  E.advance(m,10);
  assert.equal(s.events.filter(e=>/Réserve RIS épuisée/.test(e.text)).length,1);
});

test('éjection modérée puis AAR : la fission chute, la chaleur résiduelle continue de chauffer le cœur',()=>{
  const m=E.make();E.initiate(m,'ejection',{worthPcm:50});E.initiate(m,'trip');
  E.advance(m,.5);
  assert.ok(m.state.tripAt!==null);
  assert.ok(m.state.decayMW/E.C.nominalThermalMW>0.065);
  E.advance(m,3.5);
  E.advance(m,56);
  const s=m.state,previousDecay=s.decayMW;
  assert.ok(s.powerPct<5);assert.ok(previousDecay>100);
  close(s.thermalPowerMW,s.fissionMW+s.decayMW);
  const fuel=s.fuelC;E.step(m,.1);
  close((s.fuelC-fuel)*E.C.fuelHeatCapacityJk/1e6,
    (s.fissionMW+s.decayMW-s.coreTransferMW)*.1);
  E.advance(m,540);
  assert.ok(s.decayMW>50&&s.decayMW<previousDecay);
});

test('GCT-A manuel : abaisser la pression d’ouverture refroidit effectivement les GV sous 150 °C',()=>{
  const reference=E.make(),cooled=E.make();
  for(const m of [reference,cooled]) {
    m.controls.protectionsEnabled=false;m.controls.risEnabled=false;
    m.controls.asgAvailable=false;
    E.initiate(m,'trip');E.advance(m,10);
    m.state.tavgC=140;m.state.fuelC=150;
    // Une température froide exige plus de masse pour le même niveau réel.
    const inv=E.cppInventory(E.C.nominalPrimaryMassKg);
    m.state.primaryMassKg=inv.liquidVolumeM3*E.liquidWaterDensityKgM3(140,m.state.pressureBar);
    m.state.vaporMassKg=0;m.state.vaporEnergyJ=0;
    // Isoler le refroidissement secondaire d'un éventuel retour en criticité.
    m.state.boronPpm=2500;m.state.boronInventory=2500*m.state.primaryMassKg;
    m.controls.rcvTankBoronPpm=2500;
    for(const g of m.state.gv){g.tempC=140;g.pressureBar=E.saturationPressureBar(140);}
  }
  cooled.controls.gctAOpeningPressureBar=E.saturationPressureBar(120);
  E.advance(reference,1800);E.advance(cooled,1800);
  assert.ok(reference.state.gv.every(g=>g.dumpKgS===0));
  assert.ok(cooled.state.gv.every(g=>g.dumpKgS>0&&g.tempC<122&&g.tempC>119));
  assert.ok(cooled.state.tavgC<reference.state.tavgC-20);
  assert.ok(cooled.state.totalSteamKgS>0);assert.equal(cooled.state.electricMW,0);
});

test('GCT-A à 10 bar depuis le nominal : coup de froid primaire avant vidange des GV',()=>{
  const reference=E.make(),cooled=E.make();
  cooled.controls.gctAOpeningPressureBar=10;
  E.advance(reference,30);E.advance(cooled,30);
  const s=cooled.state;
  assert.ok(Math.abs(reference.state.tavgC-306.5)<.1,'permanent nominal conservé');
  assert.ok(s.tavgC<285&&s.coldC<280,'plus de 20 °C de refroidissement primaire en 30 s');
  assert.ok(s.gv.every(g=>g.pressureBar<40&&g.waterKg>20000),'GV refroidis, encore en eau');
  assert.ok(s.totalGvMW>1000,'évacuation primaire–secondaire maintenue');
  assert.ok(s.tripAt!==null,'la hausse de réactivité due au refroidissement reste protégée');
  assert.notEqual(s.risAt,null,'la baisse de pression finit par solliciter l’IS');
  assert.equal(s.primaryPumpsStopped,false,'les GMPP continuent à fonctionner sur IS');
});

test('GV : conservation masse/énergie à 10, 65 et 88,6 bar, alimentations et vapeur distinctes',()=>{
  for(const pressure of [10,65,88.6]){
    const m=E.make(),g=m.state.gv[0];m.controls.protectionsEnabled=false;
    m.controls.gctAOpeningPressureBar=1;
    m.controls.asgManual=true;m.controls.asgTrainEnabled[0]=true;
    g.tempC=E.saturationTemperatureC(pressure);g.pressureBar=pressure;g.gctAValvePct=100;
    const temp=g.tempC,mass=g.waterKg,energy=E.gvThermalCapacityJk(mass)*temp,dt=.1;
    E.step(m,dt);
    close(g.waterKg-mass,(g.feedKgS+g.asgKgS-g.steamKgS)*dt);
    const incoming=(g.feedKgS*E.C.secondaryCpJkgK*E.C.areFeedTempC
      +g.asgKgS*E.C.secondaryCpJkgK*E.C.asgFeedTempC)*dt;
    const outgoing=g.steamKgS*(E.C.secondaryCpJkgK*temp+g.steamLatentJkg)*dt;
    close((g.thermalEnergyJ-energy)/1e6,g.heatMW*dt+(incoming-outgoing)/1e6,1e-6);
    assert.ok(g.asgCoolingMW>0);
    if(pressure===10)assert.ok(g.areCoolingMW<0,'ARE à 245 °C réchauffe un GV à 180 °C');
  }
});

test('GV à sec : aucun débit vapeur fictif, et débit limité à la dernière eau disponible',()=>{
  for(const waterKg of [0,.1]){
    const m=E.make(),g=m.state.gv[0];m.controls.protectionsEnabled=false;
    m.controls.gctAOpeningPressureBar=10;m.controls.gvManualFeedPct[0]=0;
    g.waterKg=waterKg;g.feedKgS=0;g.gctAValvePct=100;
    const energy=E.gvThermalCapacityJk(waterKg)*g.tempC,temp=g.tempC;
    E.step(m,.1);
    close(g.waterKg,0);close(g.steamKgS,waterKg/.1);
    if(waterKg===0)assert.equal(g.heatMW,0);
    close((g.thermalEnergyJ-energy)/1e6,
      g.heatMW*.1-waterKg*(E.C.secondaryCpJkgK*temp+g.steamLatentJkg)/1e6,1e-6);
  }
});

// Arrêt normal, GV à 100 % GE, ARE/VPU/GCT-A fermés : reproduire le cas
// sans confondre eau froide injectée et refroidissement par sortie vapeur.
function fullGvAtShutdown(manual=false,cia=false){
  const m=E.make(),s=m.state,u=m.controls,temp=E.saturationTemperatureC(40);
  u.protectionGraphMode=true;u.demandPct=0;s.turbinePct=0;
  u.gvSteamValvePct.fill(0);u.gvManualFeedPct.fill(0);
  u.rManualPas=0;u.allRodsTargetPas=0;s.g3Count=0;
  Object.keys(s.rods).forEach(name=>{s.rods[name]=0;});
  s.powerPct=.000001;s.precursors.fill(0);
  s.boronPpm=2500;s.boronInventory=2500*s.primaryMassKg;u.rcvTankBoronPpm=2500;
  s.rcvPipe.forEach(p=>{p.boronPpm=2500;p.tempC=temp;});
  s.time=600;s.normalShutdownAt=0;s.tavgC=temp;s.fuelC=temp+7;
  s.primaryEnergyJ=s.primaryMassKg*E.C.primaryCpJkgK*temp;
  for(const g of s.gv){g.feedKgS=0;g.steamValvePct=0;
    g.waterKg=E.C.gvKgPerMetre*17;g.tempC=temp;g.pressureBar=40;}
  if(cia)s.tripAt=0;
  u.asgManual=manual;u.asgTrainEnabled.fill(manual);
  E.initiate(m,'asg');return m;
}

test('GV à 100 % GE sans vapeur : coupure immédiate ASG en automatique et en manuel, masse conservée',()=>{
  for(const manual of [false,true])for(const cia of [false,true]){
    const m=fullGvAtShutdown(manual,cia),mass=m.state.gv[0].waterKg;
    // Débit déjà établi avant le haut niveau : aucun apport résiduel admis.
    m.state.gv.forEach(g=>{g.asgKgS=E.asgFlowKgS(40);});
    E.step(m,.1);assert.equal(m.state.totalAsgKgS,0);
    E.advance(m,6);assert.notEqual(m.state.asgAt,null);
    assert.ok(m.state.gv.every(g=>!g.asgRunning&&g.asgKgS===0));
    E.advance(m,20);
    assert.equal(m.state.totalAsgKgS,0);
    for(const g of m.state.gv){
      assert.equal(g.asgKgS,0);assert.equal(g.asgCoolingMW,0);
      assert.equal(g.steamKgS,0);assert.equal(g.feedKgS,0);
      assert.ok(g.levelPct>=100);close(g.waterKg,mass);
    }
    const pressures=m.state.gv.map(g=>g.pressureBar),masses=m.state.gv.map(g=>g.waterKg);
    E.advance(m,10);
    m.state.gv.forEach((g,i)=>{
      close(g.waterKg,masses[i]);assert.ok(g.pressureBar>=pressures[i]);
    });
    assert.equal(E.reactorOperatingState(m.state).code,cia?'CIA':'AN/GV');
  }
});

test('ASG manuelle : bilan masse/énergie de la coupure à 91 % GE sans exutoire',()=>{
  const m=fullGvAtShutdown(true),g=m.state.gv[0];
  m.state.gv.forEach(g=>{g.waterKg=E.C.gvKgPerMetre*(12.5+4.5*.8);});
  E.advance(m,16);assert.ok(g.asgKgS*3.6>150);assert.equal(g.steamKgS,0);
  g.waterKg=E.C.gvKgPerMetre*(12.5+4.5*.91);
  const oldTemp=g.tempC,oldMass=g.waterKg;
  const oldEnergy=E.gvThermalCapacityJk(oldMass)*oldTemp,dt=.1;
  E.step(m,dt);
  assert.equal(g.asgKgS,0);assert.equal(g.asgCoolingMW,0);
  assert.equal(m.controls.asgTrainEnabled[0],false);close(g.waterKg,oldMass);
  close((g.thermalEnergyJ-oldEnergy)/1e6,
    g.heatMW*dt,1e-6);
});

test('iode axial : production locale immédiate, stock retardé avec demi-vie de 6,6 h',()=>{
  const s=E.make().state;s.iodine32.fill(1);s.xenon32.fill(1);
  s.axialShape32=Array.from({length:32},(_,i)=>i<16?.5:1.5);
  E.evolveAxialPoisons(s,60);
  assert.ok(s.iodine32[0]<1&&s.iodine32[31]>1);
  assert.ok(Math.abs(s.iodine32[0]-1)<.001,'une minute ne redistribue pas tout le stock');
  for(let i=1;i<396;i++)E.evolveAxialPoisons(s,60);
  close(s.iodine32[0],.75,.001);close(s.iodine32[31],1.25,.001);
});
