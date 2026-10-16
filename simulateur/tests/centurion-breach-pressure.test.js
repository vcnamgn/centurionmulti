const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} ≠ ${b}`);
const totalMass=s=>s.primaryMassKg+s.risTankRemainingKg+s.sumpKg
  +s.accumulatorsKg.reduce((a,b)=>a+b,0)
  +[...s.risPipe,...s.rcvPipe].reduce((a,p)=>a+p.massKg,0);
function coldPlant(temp=90,full=true,dt=.1){
  const m=E.make(),s=m.state,u=m.controls;
  E.initiate(m,'ris');s.tripAt=0;s.risAt=0;s.risPumpSpeedFraction=1;
  E.tripPrimaryPumps(m);
  s.powerPct=s.previousPowerPct=1e-6;s.precursors.fill(0);
  E.ROD_NAMES.forEach(n=>{s.rods[n]=0;});
  s.tavgC=s.hotC=s.coldC=s.tRicC=temp;
  s.pressureBar=s.pzrThermalPressureBar=31;
  s.primaryMassKg=(full?s.inventory.capacityM3*E.liquidWaterDensityKgM3(temp,31):120000);
  s.vaporMassKg=s.vaporEnergyJ=0;s.primaryEnergyJ=s.primaryMassKg*6000*temp;
  s.boronInventory=s.primaryMassKg*s.boronPpm;
  s.inventory=E.cppInventory(s.primaryMassKg,temp,31);s.pzrLevelPct=s.inventory.components.pzr.fillPct;
  s.fuelC=temp+.07*E.C.nominalThermalMW/10;
  s.accumulatorsKg.fill(0);s.rcvPipe=[];s.risPipe=[];
  s.loops.forEach(l=>{l.forcedFlowKgS=0;l.hotC=l.coldC=temp;});
  s.gv.forEach(g=>{g.tempC=temp;g.pressureBar=E.saturationPressureBar(temp);g.feedKgS=0;});
  u.breakAreaCm2=s.breakAreaCm2=300;
  u.manualHeaterKW=0;u.asgAvailable=false;
  for(let i=0;i<Math.round(4/dt);i++)for(const [source,q] of [['mp',178],['bp',162]])
    s.risPipe.push({at:i*dt,massKg:q*dt,boronPpm:2500,tempC:20,source});
  s.risPipe.sort((a,b)=>a.at-b.at);
  return m;
}

test('CPP froid plein : contre-pression RIS/brèche couplée, absence d’oscillation et convergence en dt',()=>{
  const results=[];
  for(const dt of [.1,.05]){
    const m=coldPlant(90,true,dt),s=m.state;let maxRate=0;
    for(let i=0;i<120/dt;i++){
      const p=s.pressureBar,mass=totalMass(s),old=s.primaryMassKg,boron=s.boronInventory,cb=s.boronPpm,T=s.tavgC;
      const energy=s.primaryEnergyJ;E.step(m,dt);const b=E.primaryMassBalance(s);
      near(totalMass(s)-mass,(s.rcvChargeKgS-s.rcvLetdownKgS)*dt,1e-7);
      near(s.primaryMassKg-old,b.netKgS*dt,1e-7);
      near(s.boronInventory-boron,dt*(s.rcvDeliveredKgS*b.chargeBoronPpm+s.risDeliveredKgS*b.risBoronPpm
        -(s.breakLiquidKgS+s.rcvLetdownKgS+s.reliefLiquidKgS)*cb),.0001);
      const input=(s.rcvDeliveredKgS*b.chargeTempC+s.risDeliveredKgS*b.risTempC)*6000*dt;
      near(s.primaryEnergyJ,energy+(s.coreTransferMW+s.pumpHeatMW-s.totalGvMW+s.pzrHeatToPrimaryMW)*1e6*dt
        +input-(s.breakKgS+s.rcvLetdownKgS+s.reliefKgS)*6000*T*dt,.002);
      if(i*dt>10)maxRate=Math.max(maxRate,Math.abs(s.pressureBar-p)/dt);
      assert.ok(s.tavgC<100&&s.vaporMassKg===0);
    }
    assert.ok(maxRate<.2,`variations sous 100 °C : ${maxRate} bar/s`);
    assert.ok(s.pressureBar>5&&s.pressureBar<10,'équilibre froid avec un orifice liquide, sans plafond diphasique');
    const b=E.primaryMassBalance(s);
    assert.ok(b.netKgS>0&&b.netKgS<30,'la contraction de l’eau demande encore une faible admission nette');
    near(s.inventory.liquidVolumeM3,s.inventory.capacityM3,1e-6);
    assert.equal(s.endState,null);results.push(s);
  }
  near(results[0].pressureBar,results[1].pressureBar,.01);
  near(results[0].tavgC,results[1].tavgC,.03);
});

test('PZR vide et eau sous-refroidie : la poche vapeur équivalente se condense, pas de gaz fictif à 31 bar',()=>{
  const m=coldPlant(80,false),s=m.state;
  m.controls.risEnabled=false;m.controls.risPumpMode='off';s.risPipe=[];
  E.advance(m,20);
  assert.ok(s.inventory.steamSpaceM3>200);
  near(s.pressureBar,1,.001);
  assert.ok(s.tavgC<100);near(s.vaporMassKg,0);
});

test('RIS en ligne : admission bornée par la courbe courante, paquet retenu et autre source non bloquée',()=>{
  const m=coldPlant(90,true),s=m.state;
  s.pressureBar=s.pzrThermalPressureBar=80;
  s.primaryMassKg=s.inventory.capacityM3*E.liquidWaterDensityKgM3(s.tavgC,80);
  s.primaryEnergyJ=s.primaryMassKg*6000*s.tavgC;
  s.boronInventory=s.primaryMassKg*s.boronPpm;
  s.inventory=E.cppInventory(s.primaryMassKg,s.tavgC,80);
  s.risPipe=[{at:0,massKg:10,boronPpm:2500,tempC:20,source:'bp'},
    {at:0,massKg:10,boronPpm:2500,tempC:20,source:'mp'}];
  const mass=totalMass(s);E.step(m,.1);
  near(s.risDeliveredBpKgS,0);
  assert.ok(s.pressureBar>40);
  assert.ok(s.risDeliveredMpKgS>0&&s.risDeliveredMpKgS<=s.risMpKgS+1e-6);
  assert.equal(s.risPipe.find(p=>p.source==='bp').massKg,10);
  near(totalMass(s)-mass,(s.rcvChargeKgS-s.rcvLetdownKgS)*.1,1e-7);
});

test('brèche 300 cm² sur 20 min : accumulateurs continus, régime froid stable et stocks conservés',()=>{
  const m=E.make();E.initiate(m,'break',{areaCm2:300});
  let coldSteps=0,maxRate=0,accumulatorSteps=0,lastAccumulator=0,maxAccumulatorJump=0,peakAccumulator=0;
  for(let i=0;i<12000;i++){
    const s=m.state,p=s.pressureBar,mass=totalMass(s);E.step(m,.1);
    near(totalMass(s)-mass,(s.rcvChargeKgS-s.rcvLetdownKgS)*.1,1e-7);
    maxAccumulatorJump=Math.max(maxAccumulatorJump,Math.abs(s.accumulatorKgS-lastAccumulator));
    lastAccumulator=s.accumulatorKgS;if(s.risDeliveredAccumulatorKgS>1)accumulatorSteps++;
    peakAccumulator=Math.max(peakAccumulator,s.accumulatorKgS);
    if(s.time>900&&s.tavgC<100){coldSteps++;maxRate=Math.max(maxRate,Math.abs(s.pressureBar-p)/.1);}
    assert.ok(s.pressureBar>=1&&s.pressureBar<=220);
    assert.ok(s.tavgC<=E.saturationTemperatureC(s.pressureBar)+1e-8);
    assert.equal(s.endState,null);
  }
  assert.ok(accumulatorSteps>100&&maxAccumulatorJump<=peakAccumulator*.1/E.C.accumulatorEndDrainTauS+.01);
  assert.ok(coldSteps>1000&&maxRate<.01,`oscillations froides : ${maxRate} bar/s`);
  assert.ok(m.state.pressureBar>5&&m.state.pressureBar<10);
  const balance=E.primaryMassBalance(m.state);
  assert.ok(balance.netKgS>0&&balance.netKgS<100,'le surplus RIS remplit réellement le volume libre');
  near(m.state.inventory.liquidVolumeM3,m.state.inventory.capacityM3,1e-6);
  assert.ok(m.state.risPipe.length<500,'les reliquats arrivés ne créent pas des milliers de parcelles');
});

test('brèche immergée à 1 bar : fuite gravitaire liquide et conservation de masse, bore et énergie',()=>{
  const m=coldPlant(90,false),s=m.state;
  s.pressureBar=s.pzrThermalPressureBar=1;
  s.primaryMassKg=215000;s.vaporMassKg=s.vaporEnergyJ=0;
  s.boronInventory=s.primaryMassKg*2500;s.boronPpm=2500;
  s.primaryEnergyJ=s.primaryMassKg*6000*s.tavgC;
  s.inventory=E.cppInventory(s.primaryMassKg,s.tavgC,1);s.pzrLevelPct=0;
  m.controls.breakAreaCm2=s.breakAreaCm2=1000;
  const b=E.primaryBreakHydraulics(s);
  assert.equal(b.wetFraction,1);assert.ok(b.hydrostaticBar>0);
  near(b.flowKgS,.68*.1*b.density*Math.sqrt(2*9.80665*(s.inventory.levelM-b.elevationM)),1e-7);
  assert.ok(b.flowKgS>0,'la brèche n’est pas étanche à pression atmosphérique');
  const old=s.primaryMassKg,U=s.primaryEnergyJ,T=s.tavgC,boron=s.boronInventory,cb=s.boronPpm;
  E.step(m,.1);const flows=E.primaryMassBalance(s);
  assert.ok(s.breakKgS>0);near(s.breakSteamKgS,0);
  near(s.primaryMassKg-old,.1*flows.netKgS,1e-7);
  near(s.boronInventory-boron,.1*(s.risDeliveredKgS*flows.risBoronPpm
    +s.rcvDeliveredKgS*flows.chargeBoronPpm-(s.breakKgS+s.rcvLetdownKgS)*cb),1e-4);
  near(s.primaryEnergyJ,U+.1*((s.coreTransferMW+s.pumpHeatMW-s.totalGvMW+s.pzrHeatToPrimaryMW)*1e6
    +(s.risDeliveredKgS*flows.risTempC+s.rcvDeliveredKgS*flows.chargeTempC)*6000
    -(s.breakKgS+s.rcvLetdownKgS)*6000*T),.002);
});

test('brèche découverte : arrêt du prélèvement liquide sous son altitude, vapeur seulement si présente',()=>{
  const m=coldPlant(80,false),s=m.state;
  s.primaryMassKg=80000;s.pressureBar=1;
  s.inventory=E.cppInventory(s.primaryMassKg,80,1);
  const dry=E.primaryBreakHydraulics(s);
  assert.equal(dry.wetFraction,0);near(dry.flowKgS,0);
  s.vaporMassKg=50;s.pressureBar=2;
  s.inventory=E.cppInventory(s.primaryMassKg-s.vaporMassKg,80,2);
  const steam=E.primaryBreakHydraulics(s);
  near(steam.liquidKgS,0);assert.ok(steam.steamKgS>0);near(steam.steamFraction,1);
  s.vaporMassKg=.001;
  const limited=E.primaryBreakHydraulics(s,s.pressureBar,.1);
  near(limited.liquidKgS,0);near(limited.steamKgS,.01);
  assert.ok(limited.flowKgS*.1<=s.vaporMassKg,'la fuite découverte ne fabrique pas de vapeur');
});
