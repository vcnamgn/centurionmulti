const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine');
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} ≠ ${b}`);

test('densité liquide : points de vérification IF97 R1 et contraction au refroidissement',()=>{
  near(1/E.liquidWaterDensityKgM3(300-273.15,30),.00100215168,1e-11);
  near(1/E.liquidWaterDensityKgM3(300-273.15,800),.000971180894,1e-11);
  near(1/E.liquidWaterDensityKgM3(500-273.15,30),.00120241800,1e-11);
  const hot=E.cppInventory(288919.9433620741,306.5,129.3965);
  const saved=E.cppInventory(288919.9433620741,235.447155,129.3965);
  assert.ok(hot.overfillKg>3000);near(saved.overfillKg,0);
  assert.ok(saved.densityKgM3>820&&saved.densityKgM3<840);
  assert.ok(saved.liquidVolumeM3<saved.capacityM3-40);
  near(Object.values(saved.components).reduce((n,c)=>n+c.massKg,0),saved.liquidMassKg,.001);
});

test('pompe RCV : 44 m³/h à 177 bar, diminution continue, aucun débit forcé à 180 bar',()=>{
  near(E.rcvPumpCapacityM3h(177),44);near(E.rcvPumpCapacityM3h(180),0);
  near(E.rcvPumpCapacityM3h(190),0);near(E.rcvPumpCapacityM3h(155),60);
  assert.ok(E.rcvPumpCapacityM3h(179)<E.rcvPumpCapacityM3h(178));
  const m=E.make();m.controls.rcvChargeM3h=60;
  m.state.pressureBar=177;m.state.pzrThermalPressureBar=177;
  E.step(m,.1);near(m.state.rcvChargeM3h,44);
  const blocked=E.make();blocked.controls.rcvChargeM3h=60;
  blocked.state.pressureBar=180;blocked.state.pzrThermalPressureBar=180;
  const pending=blocked.state.rcvPipe.reduce((n,p)=>n+p.massKg,0);
  E.step(blocked,.1);near(blocked.state.rcvChargeKgS,0);near(blocked.state.rcvDeliveredKgS,0);
  near(blocked.state.rcvPipe.reduce((n,p)=>n+p.massKg,0),pending);
});

test('équilibre PZR : gain thermique lié au flash, calage de pleine aspersion et aucune phase fictive à CPP plein',()=>{
  const s=E.make().state;
  const before={massKg:s.primaryMassKg,vaporKg:0,tempC:s.tavgC,pressureBar:s.pressureBar};
  const response=E.pzrEquilibriumResponse(before,s.inventory.steamSpaceM3,42);
  const sprayMW=250*E.liquidWaterDensityKgM3(288.4,155)/3600*6000
    *(E.saturationTemperatureC(155)-288.4)/1e6;
  near(response.heatGainBarPerMWs*sprayMW,.15,.001);
  assert.ok(response.complianceM3Bar>response.liquidCompliance+response.steamCompliance,
    'le flash ajoute une réserve de volume à la seule compressibilité');
  const low=E.pzrEquilibriumResponse(before,s.inventory.steamSpaceM3+10,20);
  assert.ok(low.heatGainBarPerMWs>response.heatGainBarPerMWs,
    'à volume libre plus grand et réserve chaude réduite, le chauffage adapte son gain');
  const full=E.pzrEquilibriumResponse(before,0,100);
  near(full.phaseCompliance,0);near(full.steamCompliance,0);near(full.heatGainBarPerMWs,0);
  near(full.complianceM3Bar,full.liquidCompliance);
});

test('piston : ajout de masse et réchauffement compriment la poche, puis la compressibilité de l’eau gouverne',()=>{
  const temp=235,pressure=155,rho=E.liquidWaterDensityKgM3(temp,pressure);
  const capacity=E.cppInventory(1,temp,pressure).capacityM3;
  const old={massKg:(capacity-20)*rho,vaporKg:0,tempC:temp,pressureBar:pressure};
  const mass=old.massKg+10;
  const p=E.solvePrimaryPressure(old,mass,mass*E.C.primaryCpJkgK*temp,0,.1);
  assert.ok(p>pressure);
  const warm=E.solvePrimaryPressure(old,old.massKg,old.massKg*E.C.primaryCpJkgK*(temp+.01),0,.1);
  assert.ok(warm>pressure);
  const full={...old,massKg:capacity*rho};
  const fullMass=full.massKg+10;
  const pFull=E.solvePrimaryPressure(full,fullMass,fullMass*E.C.primaryCpJkgK*temp,0,.1);
  assert.ok(pFull-pressure>2*(p-pressure),'réponse plus raide avec le CPP plein');
  const inventory=E.cppInventory(fullMass,temp,pFull);
  near(inventory.components.pzr.fillPct,100,.001);near(inventory.overfillKg,0);
  near(inventory.liquidVolumeM3,capacity,1e-8);
});

test('CPP plein : charge, pression, rejet liquide et bilan de bore cohérents sans effacer de masse',()=>{
  const m=E.make(),s=m.state,u=m.controls;
  u.protectionGraphMode=true;u.rcvLetdownOrifices=[false,false,false];u.rcvChargeM3h=60;
  const capacity=s.inventory.capacityM3;
  s.primaryMassKg=capacity*E.liquidWaterDensityKgM3(s.tavgC,s.pressureBar);
  s.boronInventory=s.primaryMassKg*s.boronPpm;
  let maximum=0,liquidRelief=0;
  for(let i=0;i<1200;i++){
    const old=s.primaryMassKg,bore=s.boronInventory,cb=s.boronPpm;
    E.step(m,.1);const b=E.primaryMassBalance(s);
    near(s.primaryMassKg-old,.1*b.netKgS,1e-7);
    near(s.boronInventory-bore,.1*(b.chargeKgS*b.chargeBoronPpm
      -(b.letdownKgS+b.breakLiquidKgS+b.reliefLiquidKgS)*cb),1e-4);
    near(s.inventory.overfillKg,0);
    maximum=Math.max(maximum,s.pressureBar);liquidRelief+=s.reliefLiquidKgS*.1;
  }
  assert.ok(maximum>166&&maximum<180);assert.ok(liquidRelief>100);
  assert.equal(s.tripAt,null,'une soupape ne crée pas un AAR');
});

test('PZR bas niveau : aucune dépressurisation spontanée à 4 %, ni rupture au seuil de 5 %',()=>{
  const rho=E.liquidWaterDensityKgM3(290,155),scale=E.make().state.inventory.capacityM3;
  const pzr=scale*40/E.CPP_GEOMETRY.reduce((n,g)=>n+g.volume,0),loops=scale-pzr;
  for(const level of [0,1,4,4.99,5,5.01,10]){
    const mass=(loops+pzr*level/100)*rho;
    let before={massKg:mass,vaporKg:0,tempC:290,pressureBar:155};
    for(let i=0;i<100;i++){
      const result=E.advancePrimaryPressure(before,mass,mass*6000*290,0,0,155,level,.1);
      near(result.pressureBar,155,1e-5);
      near(result.thermalPressureBar,result.pressureBar);
      before={...before,pressureBar:result.pressureBar};
    }
  }
});

test('fermeture historique PZR : réponse thermique finie, sans seconde intégration du piston',()=>{
  const s=E.make().state,before={massKg:s.primaryMassKg,vaporKg:0,tempC:s.tavgC,pressureBar:155};
  const sprayMW=250*E.liquidWaterDensityKgM3(288.4,155)/3600*6000
    *(E.saturationTemperatureC(155)-288.4)/1e6;
  const result=E.advancePrimaryPressure(before,before.massKg,before.massKg*6000*before.tempC,
    -sprayMW,0,155,42,.1);
  near((result.pressureBar-155)/.1,-.15,.015);
  near(result.thermalPressureBar,result.pressureBar);
});
