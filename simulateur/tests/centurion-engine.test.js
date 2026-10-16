const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../centurion-engine.js');

test('point nominal : inventaire primaire commun et quatre GV stationnaires', () => {
  const m = E.make();
  E.advance(m, 120);
  const s = m.state;
  assert.equal(s.loops.length, 4);
  assert.equal(s.gv.length, 4);
  assert.ok(Math.abs(s.loops.reduce((sum, l) => sum + l.flowKgS, 0)
    - E.C.nominalPrimaryFlowKgS) < 0.01);
  assert.ok(Math.abs(s.primaryMassKg - E.C.nominalPrimaryMassKg) < 0.01);
  assert.ok(Math.abs(s.pressureBar - 155) < 0.1);
  assert.ok(s.gv.every(g => Math.abs(g.levelPct - 55) < 0.1));
  assert.equal(s.tripAt, null);
  assert.ok(Math.abs(s.coldC-288.4)<0.1);
  assert.ok(Math.abs(s.hotC-324.6)<0.1);
  assert.ok(Math.abs(s.tRicC-326.9)<0.1);
  assert.equal(E.C.coreConductanceMWC,10);
  assert.ok(Math.abs(s.fuelC-688.2)<0.1);
  assert.ok(s.tRicC>s.hotC);
  const mixedHot=(1-E.C.coreBypassFraction)*s.tRicC
    +E.C.coreBypassFraction*s.coldC;
  assert.ok(Math.abs(mixedHot-s.hotC)<0.5);
});

test('échange des crayons à K fixe : bilan identique sans débit ou avec dénoyage', () => {
  for(const [stopped,massFraction] of [[false,1],[true,1],[true,0.6]]){
    const m=E.make();
    m.state.fuelC+=20;
    m.state.primaryMassKg*=massFraction;
    if(stopped){
      m.controls.naturalCirculationKgSPerLoop=0;
      m.state.primaryPumpsStopped=true;
      m.state.loops.forEach(loop=>{loop.flowKgS=0;loop.forcedFlowKgS=0;});
    }
    const initialFuel=m.state.fuelC,initialWater=m.state.tavgC;
    E.step(m,0.1);
    const expected=initialFuel+(m.state.thermalPowerMW
      -10*(initialFuel-initialWater))*1e6*0.1/E.C.fuelHeatCapacityJk;
    assert.ok(Math.abs(m.state.fuelC-expected)<1e-9);
    if(stopped)assert.equal(m.state.coreFlowFraction,0);
  }
});

test('après AAR et arrêt des GMPP, un cœur noyé conserve son échange thermique', () => {
  const m=E.make();
  E.initiate(m,'ris');
  E.tripPrimaryPumps(m);
  E.advance(m,180);
  assert.ok(m.state.coreFlowFraction>0&&m.state.coreFlowFraction<.1);
  assert.equal(m.state.coveragePct,100);
  assert.ok(m.state.fuelC-m.state.tavgC<25);
  assert.ok(Math.abs(10*(m.state.fuelC-m.state.tavgC)-m.state.thermalPowerMW)<10);
});

test('G3 et recouvrements : G1 commence seul puis entraîne G2, N1 et N2', () => {
  assert.equal(E.g3Target(100, 'debut'), 780);
  assert.equal(E.g3Target(90, 'debut'), 600);
  assert.deepEqual(E.gcpPositions(780), [260, 260, 260, 260]);
  assert.deepEqual(E.gcpPositions(600), [80, 260, 260, 260]);
  assert.deepEqual(E.gcpPositions(700), [180, 260, 260, 260]);
  assert.deepEqual(E.gcpPositions(704), [184, 260, 260, 260]);
  assert.deepEqual(E.gcpPositions(705), [185, 260, 260, 260]);
  assert.deepEqual(E.gcpPositions(704.5), [184.5, 260, 260, 260]);
  assert.deepEqual(E.gcpPositions(500), [0, 165, 260, 260]);
  assert.deepEqual(E.gcpPositions(210), [0, 0, 50, 205]);
});

test('poids initiaux des neuf groupes choisis pour l’étude : réponse à 85 % PN', () => {
  assert.deepEqual(E.ROD_WORTH_PCM,{
    R:1500,G1:200,G2:480,N1:750,N2:1200,
    SA:500,SB:700,SC:900,SD:300
  });
  const m=E.make(),u=m.controls;
  u.protectionsEnabled=false;
  u.rMode='graph';
  // Correcteur de température de comparaison ; le graphe CC-RÉGUL n'est pas rejoué ici.
  for(let second=0;second<600;second++){
    u.demandPct=100-15*Math.min(1,second/180);
    u.g3GraphTarget=E.g3Target(u.demandPct,'debut');
    const error=m.state.trefC-m.state.tavgC;
    if(Math.abs(error)>0.83)u.rGraphPas=Math.max(0,Math.min(260,
      u.rGraphPas+Math.max(-1.2,Math.min(1.2,error*62/60))));
    E.advance(m,1);
  }
  assert.equal(m.state.rods.G1,47.5);
  assert.ok(m.state.rods.R>=233&&m.state.rods.R<=260,
    `R à ${m.state.rods.R.toFixed(1)} pas`);
});

test('le poids R réglé est appliqué au bilan de réactivité après déplacement', () => {
  const m=E.make();
  assert.equal(m.controls.rodWorthPcm.R,1500);
  m.controls.rManualPas=240;
  E.advance(m,20);
  assert.equal(m.state.rods.R,240);
  const relativeIntegral=E.rodIntegral(240)-E.rodIntegral(233);
  assert.ok(Math.abs(m.state.reactivityParts.rod-1500*relativeIntegral)<1e-9);
  m.controls.rodWorthPcm.R=1000;
  E.advance(m,0.1);
  assert.ok(Math.abs(m.state.reactivityParts.rod-1000*relativeIntegral)<1e-9);
});

test('IL R varie avec la puissance et la moitié du cycle', () => {
  assert.equal(E.rInsertionLimit(0, 'premiere'), 202);
  assert.equal(E.rInsertionLimit(100, 'premiere'), 186);
  assert.equal(E.rInsertionLimit(0, 'seconde'), 211);
  assert.equal(E.rInsertionLimit(100, 'seconde'), 198);
});

test('IL R : le graphe peut insérer sous la limite, signalée sans blocage',()=>{
  const m=E.make();m.controls.protectionsEnabled=false;
  m.controls.protectionGraphMode=true;
  m.controls.rMode='graph';m.controls.rGraphPas=100;
  E.advance(m,120);
  assert.equal(m.state.rods.R,100);
  assert.ok(m.state.rods.R<m.state.rLimitPas);
  assert.equal(m.state.signals.rBelowLimit,true);
  E.initiate(m,'trip');E.advance(m,1);
  assert.equal(m.state.signals.rBelowLimit,false,'pas d’alarme IL pendant l’AAR');
});

test('RCV : dilution manuelle livrée après le délai de conduite', () => {
  const m = E.make();
  E.prepareRcvTank(m, 0, 0);
  E.advance(m, 7);
  assert.ok(Math.abs(m.state.boronPpm - 1200) < 1e-6);
  E.advance(m, 25);
  assert.ok(m.state.boronPpm < 1200);
  assert.equal(m.state.rcvChargeM3h,36);
  assert.ok(Math.abs(m.state.rcvSealKgS-m.state.rcvChargeKgS/6)<1e-12);
  assert.ok(Math.abs(E.instrumentSnapshot(m).letdownM3h-36)<.001);
});

test('RCV : le graphe peut régler la charge sans modifier la décharge fixe', () => {
  const m = E.make();
  m.controls.rcvChargeM3h = 8;
  m.controls.rcvChargeGraphM3h = 22;
  E.advance(m, 1);
  assert.equal(m.state.rcvChargeM3h,22);
  assert.ok(Math.abs(E.instrumentSnapshot(m).letdownM3h-36)<.001);
  m.controls.rcvChargeGraphM3h = null;
  E.advance(m, 1);
  assert.equal(m.state.rcvChargeM3h,8);
  m.controls.rcvChargeM3h=0;
  E.advance(m,1);
  assert.equal(m.state.rcvChargeKgS,0);
});

test('hors CC-REGUL aucune commande automatique ne déplace R ou G3', () => {
  const m = E.make();
  m.controls.demandPct = 90;
  E.advance(m, 5);
  assert.equal(m.state.rods.R, 233);
  assert.equal(m.state.g3Count, 780);
  assert.equal(m.state.sprayPct, E.C.nominalSprayPct);
});

test('pressuriseur nominal : vannes fermées et aspersion continue équilibrée', () => {
  const m = E.make();
  E.advance(m, 120);
  assert.equal(m.state.heaterKW, 288);
  assert.equal(m.state.sprayPct, 0);
  assert.ok(Math.abs(m.state.sprayContinuousM3h-0.46)<0.001);
  assert.equal(m.state.sprayValveM3h, 0);
  assert.ok(Math.abs(m.state.sprayFlowM3h-0.46)<0.001);
  assert.ok(Math.abs(m.state.pressureBar-155)<0.02);
});

test('graphe CC-RÉGUL initial : chaufferettes et aspersion suivent les seuils REF-01', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','centurion-cc-regul.html'),'utf8');
  const raw=html.match(/<script type="application\/json" id="solutionDataComplete">([^<]+)<\/script>/);
  assert.ok(raw);
  const model=JSON.parse(raw[1]);
  const start=html.indexOf('    function migrateCenturionRegulation(model) {');
  const end=html.indexOf('    function applyRegState(',start);
  assert.ok(start>=0 && end>start);
  const migrate=Function('CENTURION_EDITOR_MODE','window',
    `${html.slice(start,end)};return migrateCenturionRegulation;`)('regul',
      {CenturionPzrCommands:require('../centurion-cc-pzr')});
  migrate(model);
  const pid=model.nodes.find(n=>n.type==='pid'&&n.label==='PID pression');
  const heater=model.nodes.find(n=>n.params.curveRole==='heater');
  const spray=model.nodes.find(n=>n.params.curveRole==='spray');
  assert.deepEqual([pid.params.kp,pid.params.ki,pid.params.kd],[1,0,0]);
  assert.equal(heater.params.xUnit,'bar');
  assert.equal(spray.params.xUnit,'bar');
  const curve=(points,x)=>{
    for(let i=1;i<points.length;i++)if(x<=points[i].x){
      const a=points[i-1],b=points[i];
      return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);
    }
    return points.at(-1).y;
  };
  assert.equal(curve(heater.params.points,0),288);
  assert.equal(curve(heater.params.points,-1),576);
  assert.equal(curve(spray.params.points,0),0);
  assert.equal(curve(spray.params.points,2),0);
  assert.equal(curve(spray.params.points,5.2),100);
});

test('aspersion ouverte : le débit et le refroidissement abaissent la pression', () => {
  const m = E.make();
  m.controls.manualSprayPct = 100;
  E.advance(m, 1);
  assert.ok(Math.abs(m.state.sprayPct-50)<0.1);
  E.advance(m, 1);
  assert.ok(Math.abs(m.state.sprayPct-100)<0.1);
  const pressureAtFullOpening=m.state.pressureBar;
  E.advance(m, 1);
  // Course physique 2 s, puis réponse du PZR séparé et des parois chaudes.
  const firstDrop=pressureAtFullOpening-m.state.pressureBar;
  assert.ok(firstDrop>.02&&firstDrop<.2,'baisse progressive sans saut de pression');
  E.advance(m,12);
  const settled=m.state.pressureBar;E.advance(m,1);
  assert.ok(Math.abs(m.state.pressureBar-settled+.15)<.02,'gradient établi proche de −0,15 bar/s');
  E.advance(m, 14);
  assert.ok(m.state.pressureBar < 155);
  assert.ok(m.state.pressureBar > 149);
  assert.equal(m.state.sprayPct, 100);
  assert.ok(Math.abs(m.state.sprayValveM3h-250)<0.5);
  assert.ok(Math.abs(m.state.sprayContinuousM3h-0.46)<0.001);
  assert.ok(Math.abs(m.state.sprayFlowM3h-250.46)<0.5);
});

test('une GMPP arrêtée fait décroître son débit et divise son apport à l’aspersion', () => {
  const m = E.make();
  assert.ok(Math.abs(m.state.loops[0].pumpHeadHotBar-7)<1e-9);
  assert.ok(Math.abs(m.state.loops[0].vesselDeltaBar-3.5)<1e-9);
  assert.ok(Math.abs(m.state.loops[0].gvDeltaBar-3.5)<1e-9);
  m.controls.manualSprayPct = 100;
  m.state.loops[0].pumpStopped = true;
  E.advance(m, 60);
  assert.equal(m.state.loops[0].forcedFlowKgS, 0);
  assert.ok(m.state.loops[0].naturalFlowKgS>0);
  assert.ok(Math.abs(m.state.sprayFlowM3h-125.23)<1);
  assert.ok(Math.abs(m.state.sprayDriveBar-1.75)<0.1);
});

test('brèche : baisse de pression, AAR puis IS et arrivée retardée du RIS', () => {
  const m = E.make();
  E.initiate(m, 'break', { areaCm2: 300, loop: 2, branch: 'chaude' });
  E.advance(m, 60);
  const s = m.state;
  assert.equal(s.breakLoop, 2);
  assert.equal(s.breakBranch, 'chaude');
  assert.ok(s.primaryMassKg < E.C.nominalPrimaryMassKg);
  assert.ok(s.pressureBar < 120);
  assert.ok(s.tripAt !== null && s.risAt !== null);
  assert.ok(s.tripAt < s.risAt);
  assert.ok(s.risMpKgS > 0 && s.risDeliveredKgS > 0);
  assert.ok(s.boronPpm > 1200);
});

test('RIS MP puis BP suivent leur domaine de pression', () => {
  const high = E.make();
  require('./helpers/liquid-primary-point')(E,high,100);
  E.initiate(high, 'ris');
  const hold=(m,p,n)=>{for(let i=0;i<n*10;i++){
    m.state.pressureBar=p;m.state.pzrThermalPressureBar=p;E.step(m,.1);
  }};
  hold(high,100,4.1); // Délai IS 2 s, puis montée en vitesse 2 s.
  assert.ok(high.state.risMpKgS > 0);
  assert.equal(high.state.risBpKgS, 0);
  assert.equal(high.state.risDeliveredKgS, 0);
  hold(high,100,4);
  assert.ok(high.state.risDeliveredKgS > 0);
  const low = E.make();
  require('./helpers/liquid-primary-point')(E,low,20);
  E.initiate(low, 'ris');
  hold(low,20,4.1);
  assert.ok(low.state.risBpKgS > 0);
  assert.ok(low.state.accumulatorKgS > 0);
});

test('au démarrage R répond en manuel sans activer la régulation', () => {
  const m = E.make();
  assert.equal(m.controls.rMode, 'manual');
  m.controls.rManualPas = 260;
  E.advance(m, 5);
  assert.ok(m.state.rods.R > 220);
  assert.ok(m.state.powerPct > 100);
});

test('la demande IS entraîne AAR, sans déclencher les GMPP', () => {
  const m = E.make();
  E.initiate(m, 'ris');
  assert.notEqual(m.state.risDemandAt, null);
  assert.notEqual(m.state.tripDemandAt, null);
  assert.equal(m.state.primaryPumpsStopped, false);
  E.advance(m, 60);
  assert.notEqual(m.state.tripAt, null);
  assert.equal(m.state.coreFlowFraction,1);
  assert.ok(m.state.sprayFlowPct>0);
  assert.equal(m.state.pumpHeatMW,24);
  assert.ok(m.state.loops.every(loop => loop.forcedFlowKgS===E.C.nominalPrimaryFlowKgS/4));
});

test('un défaut ARE sur GV1 baisse son niveau sans vider les trois autres', () => {
  const m = E.make();
  m.controls.gvManualFeedPct[0] = 0;
  E.advance(m, 60);
  assert.ok(m.state.gv[0].levelPct < 45);
  // Le primaire commun modifie légèrement les pressions et les débits vapeur
  // des GV sains, même avec leurs vannes ARE inchangées en manuel.
  assert.ok(m.state.gv.slice(1).every(g => g.levelPct>50&&g.levelPct<60
    &&g.waterKg>.95*E.C.gvNominalWaterKg));
});

test('saturation secondaire : points IAPWS-IF97 et consigne GCT-A initiale à 88,6 bar', () => {
  for (const [kelvin, bar] of [[300,0.0353658941],[500,26.3889776],[600,123.443146]])
    assert.ok(Math.abs(E.saturationPressureBar(kelvin-273.15)-bar)<5e-7);
  assert.equal(E.C.gctAPressureBar,88.6);
  assert.equal(E.make().controls.gctAOpeningPressureBar,88.6);
  assert.ok(Math.abs(E.saturationPressureBar(E.C.gctATempC)-88.6)<1e-8);
  assert.ok(Math.abs(E.saturationTemperatureC(65)-280.858851)<1e-6);
});

test('GL et GE mesurent la même hauteur : plaque tubulaire, bas GE et point nominal', () => {
  assert.deepEqual(E.gvLevels(0),{levelMetres:0,levelWidePct:0,levelPct:0});
  const low=E.gvLevels(12.5*E.C.gvKgPerMetre);
  assert.equal(low.levelPct,0);
  assert.ok(Math.abs(low.levelWidePct-100*12.5/17)<1e-9);
  const nominal=E.gvLevels(E.C.gvNominalWaterKg);
  assert.ok(Math.abs(nominal.levelMetres-14.975)<1e-9);
  assert.ok(Math.abs(nominal.levelPct-55)<1e-9);
  assert.ok(Math.abs(nominal.levelWidePct-88.0882352941)<1e-9);
  const high=E.gvLevels(17*E.C.gvKgPerMetre);
  assert.equal(high.levelPct,100);
  assert.equal(high.levelWidePct,100);
});

test('VVP : fermer puis rouvrir GV2 coupe puis rétablit son seul débit turbine', () => {
  const m=E.make();m.controls.protectionsEnabled=false;
  m.controls.gvSteamValvePct[1]=0;
  E.advance(m,2.1);
  assert.equal(m.state.gv[1].steamValvePct,0);
  assert.equal(m.state.gv[1].steamKgS,0);
  assert.ok(m.state.gv.filter((g,i)=>i!==1).every(g=>g.steamValvePct===100&&g.steamKgS>500));
  assert.ok(m.state.electricMW<1000);
  m.controls.gvSteamValvePct[1]=100;
  E.advance(m,2.1);
  assert.equal(m.state.gv[1].steamValvePct,100);
  assert.ok(m.state.gv[1].steamKgS>500);
  assert.ok(m.state.electricMW>1200);
});

test('GCT-A : fermé sous le seuil, vapeur retirée des bilans au dépassement', () => {
  const m=E.make();m.controls.protectionsEnabled=false;
  const g=m.state.gv[0];
  m.controls.gvSteamValvePct[0]=0;g.steamValvePct=0;
  g.tempC=E.C.gctATempC-1;g.pressureBar=E.saturationPressureBar(g.tempC);
  E.step(m,0.1);
  assert.equal(g.gctAValvePct,0);
  assert.equal(g.dumpKgS,0);
  g.tempC=E.C.gctATempC+1;g.pressureBar=E.saturationPressureBar(g.tempC);
  const previousWater=g.waterKg,previousTemp=g.tempC;
  E.step(m,0.1);
  assert.ok(g.gctAValvePct>0&&g.dumpKgS>0);
  assert.equal(g.turbineSteamKgS,0);
  assert.equal(g.steamKgS,g.dumpKgS);
  assert.ok(Math.abs(g.waterKg-previousWater-(g.feedKgS-g.dumpKgS)*0.1)<1e-8);
  const expectedHeat=g.heatMW-g.dumpKgS*g.steamLatentJkg/1e6-g.areCoolingMW-g.asgCoolingMW;
  assert.ok(Math.abs((g.tempC-previousTemp)*g.thermalCapacityJk/1e6/0.1-expectedHeat)<1e-6);
  E.advance(m,90);
  assert.ok(g.pressureBar>E.C.gctAPressureBar);
  assert.ok(g.pressureBar<E.C.gctAPressureBar+1);
  assert.ok(g.dumpKgS>0);
});

test('vapeur mesurée : turbine + GCT-A, avec des bilans conservatifs et une puissance électrique distincte', () => {
  const m=E.make();m.controls.protectionsEnabled=false;
  const g=m.state.gv[2];
  g.tempC=E.C.gctATempC+1;g.pressureBar=E.saturationPressureBar(g.tempC);
  const previousWater=g.waterKg,previousTemp=g.tempC;
  E.step(m,0.1);
  assert.ok(g.turbineSteamKgS>0&&g.dumpKgS>0);
  assert.equal(g.steamKgS,g.turbineSteamKgS+g.dumpKgS);
  assert.equal(m.state.totalSteamKgS,m.state.gv.reduce((q,gv)=>q+gv.steamKgS,0));
  assert.equal(m.state.totalTurbineSteamKgS,m.state.gv.reduce((q,gv)=>q+gv.turbineSteamKgS,0));
  assert.ok(m.state.totalSteamKgS>m.state.totalTurbineSteamKgS);
  assert.ok(Math.abs(m.state.electricMW-E.C.nominalElectricMW*m.state.totalTurbineSteamKgS
    /(4*E.C.nominalSteamKgSPerGV))<1e-9);
  assert.ok(Math.abs(g.waterKg-previousWater-(g.feedKgS-g.steamKgS)*0.1)<1e-8);
  const expectedHeat=g.heatMW-g.steamKgS*g.steamLatentJkg/1e6-g.areCoolingMW-g.asgCoolingMW;
  assert.ok(Math.abs((g.tempC-previousTemp)*g.thermalCapacityJk/1e6/0.1-expectedHeat)<1e-6);

  m.controls.demandPct=0;m.state.turbinePct=0;
  E.step(m,0.1);
  assert.equal(m.state.totalTurbineSteamKgS,0);
  assert.equal(m.state.electricMW,0);
  assert.ok(m.state.totalSteamKgS>0);
});

test('le limiteur turbine maintient la puissance réseau demandée malgré une surpuissance du cœur', () => {
  for(const demandPct of [100,80]){
    const m=E.make();
    m.controls.protectionsEnabled=false;
    m.controls.demandPct=demandPct;
    m.controls.rManualPas=186;
    m.state.rods.R=186;
    // Avec le Doppler renforcé, 150 ppm de dilution produisent la surpuissance d'essai.
    m.state.boronPpm=1050;
    m.state.boronInventory=1050*m.state.primaryMassKg;
    E.advance(m,60);
    assert.ok(m.state.powerPct>130);
    assert.equal(m.state.rods.R,186);
    assert.ok(m.state.gv.every(g=>g.pressureBar>E.C.steamPressureBar));
    assert.ok(Math.abs(m.state.electricMW-13*demandPct)<1e-6);
    assert.ok(m.state.electricMW<=E.C.nominalElectricMW);
    assert.ok(Math.abs(m.state.totalTurbineSteamKgS
      -4*E.C.nominalSteamKgSPerGV*demandPct/100)<1e-6);
    assert.ok(m.state.gv.every(g=>g.steamKgS===g.turbineSteamKgS+g.dumpKgS));
  }
});

test('une consigne turbine supérieure à 100 % reste limitée à 1 300 MWe', () => {
  const m=E.make();
  m.controls.protectionsEnabled=false;
  m.controls.demandPct=110;
  m.state.gv.forEach(g=>{g.tempC=290;g.pressureBar=E.saturationPressureBar(290);});
  E.advance(m,1);
  assert.equal(m.state.turbinePct,100);
  assert.ok(m.state.electricMW<=E.C.nominalElectricMW);
});

test('en mode graphe la surveillance reçoit la variation filtrée de CC-PROTECT', () => {
  const m=E.make();
  m.controls.protectionGraphMode=true;
  m.controls.protectionGraphFluxRatePctS=-6;
  E.step(m,0.1);
  assert.equal(m.state.fluxRatePctS,-6);
  assert.equal(m.state.signals.rapidFluxFall,true);
  assert.equal(m.state.signals.rapidFluxRise,false);
  assert.equal(m.state.tripDemandAt,null); // Seule la sortie AAR du graphe peut l'engager.
});

test('initiateurs éjection et perte de tension donnent des ordres de protection', () => {
  for (const [name, details] of [['ejection', { worthPcm: 300 }], ['voltage', {}]]) {
    const m = E.make();
    E.initiate(m, name, details);
    E.advance(m, 20);
    assert.ok(m.state.tripAt !== null, name);
    if(m.state.endState) {
      assert.equal(m.state.endState,'melted');
      assert.ok(m.state.peakLinearWcm>590,'la fin pédagogique peut précéder la fin de la chute');
    }else assert.ok(m.state.rods.SA < 1 && m.state.rods.R < 1, name);
    assert.ok(Number.isFinite(m.state.powerPct));
  }
});

test('le cœur axial conserve POW1 et initialise le DPAX à environ −1 % PN', () => {
  const m = E.make();
  E.advance(m, 3);
  const s=m.state;
  assert.equal(s.axialShape32.length, 32);
  assert.equal(s.axialZonePowerPctPn32.length, 32);
  assert.equal(s.iodine32.length, 32);
  assert.equal(s.xenon32.length, 32);
  assert.ok(Math.abs(s.axialShape32.reduce((a,b)=>a+b,0)-32)<1e-8);
  assert.ok(Math.abs(s.axialZonePowerPctPn32.reduce((a,b)=>a+b,0)-s.powerPct)<1e-8);
  assert.equal(s.axialShape6.length, 6);
  assert.equal(s.axialZonePowerPctPn6.length, 6);
  assert.ok(Math.abs(s.axialShape6.reduce((a,b)=>a+b,0)-6)<1e-8);
  assert.ok(Math.abs(s.axialZonePowerPctPn6.reduce((a,b)=>a+b,0)-s.powerPct)<1e-8);
  const lower=s.axialZonePowerPctPn6.slice(0,3).reduce((a,b)=>a+b,0);
  const upper=s.axialZonePowerPctPn6.slice(3).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(s.dpaxPctPn-(upper-lower))<1e-9);
  assert.ok(s.dpaxPctPn>-1.2&&s.dpaxPctPn<-0.8);
  assert.equal(m.state.axialFlux32.length, 32);
  assert.equal(m.state.fluxDetectors6.length, 6);
  assert.ok(m.state.axialFlux32.every(Number.isFinite));
  assert.ok(m.state.peakLinearWcm > 0);
  assert.ok(Math.abs(s.peakLinearWcm-E.C.nominalAverageLinearWcm
    *(s.thermalPowerMW/E.C.nominalThermalMW)
    *Math.max(...s.axialShape32)*m.controls.fxYUngraped)<1e-8);
  assert.ok(Number.isFinite(s.history.at(-1).dpax));
  assert.ok(Math.abs(s.history.at(-1).dpax-s.dpaxPctPn)<0.05);
});

test('G3 crée les bosses de G1 puis G2, et rend N1 visible à basse puissance', () => {
  const m=E.make(),rods={...m.state.rods},xenon=m.state.xenon32;
  const noTemperature=Array(32).fill(0);
  const dpaxAt=power=>{
    const [G1,G2,N1,N2]=E.gcpPositions(E.g3Target(power,'debut'));
    const shape=E.solveAxialShape({...rods,G1,G2,N1,N2},xenon,noTemperature);
    return power*(shape.slice(16).reduce((a,b)=>a+b,0)
      -shape.slice(0,16).reduce((a,b)=>a+b,0))/32;
  };
  const g1Minimum=Math.min(...Array.from({length:41},(_,i)=>dpaxAt(80+i/2)));
  assert.ok(g1Minimum<-5,'bosse G1 sur 80–100 % PN');
  assert.ok(dpaxAt(85)>g1Minimum+2,'retour après G1');
  assert.ok(dpaxAt(65)<dpaxAt(85)-4,'bosse G2 vers 65 % PN');
  assert.ok(dpaxAt(45)>dpaxAt(65)+4,'retour après G2');
  const [G1,G2,N1,N2]=E.gcpPositions(E.g3Target(15,'debut'));
  const withoutN1=E.solveAxialShape({...rods,G1,G2,N1,N2},xenon,noTemperature,
    undefined,{...E.AXIAL_ROD_ABSORPTION,N1:0});
  const dpaxWithoutN1=15*(withoutN1.slice(16).reduce((a,b)=>a+b,0)
    -withoutN1.slice(0,16).reduce((a,b)=>a+b,0))/32;
  assert.ok(dpaxAt(15)<dpaxWithoutN1-1,'déformation de N1 à basse puissance');
});

test('xénon axial : une baisse maintenue puis le retour de charge donnent une oscillation DPAX',()=>{
  const m=E.make(),s=m.state,initialR=s.rods.R;
  const noTemperature=Array(32).fill(0),points={};
  const dpax=power=>power*(s.axialShape32.slice(16).reduce((a,b)=>a+b,0)
    -s.axialShape32.slice(0,16).reduce((a,b)=>a+b,0))/32;
  for(let minute=0;minute<=24*60;minute++){
    const power=minute<=20?100-2*minute:minute<=440?60
      :minute<=470?60+40*(minute-440)/30:100;
    s.powerPct=power;s.rods.R=initialR;
    [s.rods.G1,s.rods.G2,s.rods.N1,s.rods.N2]=
      E.gcpPositions(E.g3Target(power,'debut'));
    s.axialShape32=E.solveAxialShape(s.rods,s.xenon32,noTemperature,s.axialShape32);
    E.evolveAxialPoisons(s,60);
    s.axialShape32=E.solveAxialShape(s.rods,s.xenon32,noTemperature,s.axialShape32);
    if([0,20,440,470,900,1440].includes(minute))points[minute]=dpax(power);
  }
  assert.ok(points[440]<points[20]-2,'dérive xénon pendant sept heures à 60 %');
  assert.ok(points[900]>0,'dépassement du DPAX de référence après remontée');
  assert.ok(points[1440]<points[900],'retour après le premier dépassement');
  assert.ok(s.xenonTop!==s.xenonBottom,'répartition du xénon non uniforme');
});

test('le calage axial modifie le DPAX sans ajouter de réactivité globale', () => {
  const m=E.make();
  m.state.rods.G1=130;
  E.refreshAxial(m);
  const withG1=m.state.dpaxPctPn;
  const reactivity=m.state.reactivityPcm;
  m.controls.axialRodAbsorption.G1=0;
  E.refreshAxial(m);
  assert.ok(m.state.dpaxPctPn>withG1+1.5);
  assert.equal(m.state.reactivityPcm,reactivity);
  assert.equal(m.state.powerPct,100);
});

test('xénon : −3 000 pcm à 100 % stabilisé, compensés au nominal puis variables', () => {
  const m=E.make(),s=m.state;
  assert.equal(s.xenonWorthPcm,-3000);
  assert.equal(s.reactivityParts.coreReference,3000);
  assert.equal(s.reactivityPcm,0);
  E.advance(m,60);
  assert.ok(Math.abs(s.xenonWorthPcm+3000)<0.01);
  s.xenon32.fill(1.1);
  s.xenonTop=1.1;s.xenonBottom=1.1;
  E.advance(m,0.1);
  assert.ok(Math.abs(s.xenonWorthPcm+3300)<0.1);
  assert.ok(s.reactivityPcm<-299);
  assert.ok(s.powerPct<100);
});

test('programme de pilotage : rampe 100 → 10 % à 5 % PN/min', () => {
  assert.equal(E.transientDemand('pilotage',0),100);
  assert.equal(E.transientDemand('pilotage',60),95);
  assert.equal(E.transientDemand('pilotage',1080),10);
  assert.equal(E.transientDemand('pilotage',1800),10);
});

test('les six programmes de charge restent numériques sans graphes CC', () => {
  for (const name of ['temperature', 'down', 'frequency', 'step', 'lowstep', 'pilotage']) {
    const m = E.make();
    E.startTransient(m, name);
    E.advance(m, E.TRANSIENTS[name].duration);
    assert.ok(Number.isFinite(m.state.powerPct), name);
    assert.ok(m.state.gv.every(g => Number.isFinite(g.levelPct)), name);
  }
});

test('le programme rejoint son point initial puis revient à 100 % sans saut', () => {
  const m=E.make();
  E.startTransient(m,'lowstep');
  assert.equal(m.controls.transientPhase,'approach');
  E.advance(m,60);
  assert.ok(Math.abs(m.state.demandPct-80)<0.1);
  assert.equal(m.controls.transientPhase,'approach');
  E.advance(m,165);
  assert.ok(Math.abs(m.state.demandPct-25)<0.1);
  assert.equal(m.controls.transientPhase,'run');
  E.startTransient(m,'off');
  assert.equal(m.controls.transientPhase,'return');
  E.advance(m,60);
  assert.ok(Math.abs(m.state.demandPct-45)<0.1);
  E.advance(m,165);
  assert.ok(Math.abs(m.state.demandPct-100)<0.1);
  assert.equal(m.controls.transientPhase,'off');
});

test('page et ressources de la nouvelle application sont autonomes', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'centurion.html'), 'utf8');
  for (const file of ['centurion.css', 'centurion-engine.js', 'centurion-app.js',
    'centurion-svg-bridge.js']) assert.ok(fs.existsSync(path.join(root, file)), file);
  for (const file of ['synoptique-RCP-1300.svg', 'synoptique-RCPGV-1300.svg',
    'synoptique-RCPPZR-1300.svg', 'synoptique-RCPGRAPPES-1300.svg']) {
    const svg = fs.readFileSync(path.join(root, 'synoptiques', file), 'utf8');
    assert.match(svg, /centurion-svg-bridge\.js/);
  }
  assert.match(html, /centurion-engine\.js/);
  assert.match(html, /view-protection/);
  assert.match(html, /view-initiateurs/);
});
