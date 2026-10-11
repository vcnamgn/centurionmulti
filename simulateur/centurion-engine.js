/* Centurion — moteur pédagogique commun aux synoptiques et aux commandes.
 * Les constantes non sourcées sont des hypothèses d'exercice, jamais des valeurs de sûreté.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CenturionEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  // IAPWS-IF97, région 4, équation 30 : pression de saturation en bar absolus.
  function saturationPressureBar(tempC) {
    const t = clamp(tempC + 273.15, 273.15, 647.096);
    const theta = t - 0.23855557567849 / (t - 650.17534844798);
    const a = theta * theta + 1167.0521452767 * theta - 724213.16703206;
    const b = -17.073846940092 * theta * theta + 12020.824702470 * theta - 3232555.0322333;
    const c = 14.915108613530 * theta * theta - 4823.2657361591 * theta + 405113.40542057;
    return 10 * Math.pow(2 * c / (-b + Math.sqrt(b * b - 4 * a * c)), 4);
  }
  function saturationTemperatureC(pressureBar) {
    // IF97 région 4, équation 31 : inverse analytique, utile à ×200.
    const beta=Math.pow(clamp(pressureBar,.00611213,220.64)/10,.25);
    const e=beta*beta-17.073846940092*beta+14.915108613530;
    const f=1167.0521452767*beta*beta+12020.824702470*beta-4823.2657361591;
    const g=-724213.16703206*beta*beta-3232555.0322333*beta+405113.40542057;
    const d=2*g/(-f-Math.sqrt(f*f-4*e*g));
    return (650.17534844798+d-Math.sqrt((650.17534844798+d)**2
      -4*(-.23855557567849+650.17534844798*d)))/2-273.15;
  }
  // IF97 région 1, équation 7 / tableau 2. Seuls les termes I≠0
  // contribuent à la dérivée en pression utilisée pour le volume spécifique.
  const WATER_R1_TERMS=[
    [1,-9,.28319080123804e-3],[1,-7,-.60706301565874e-3],
    [1,-1,-.18990068218419e-1],[1,0,-.32529748770505e-1],
    [1,1,-.21841717175414e-1],[1,3,-.52838357969930e-4],
    [2,-3,-.47184321073267e-3],[2,0,-.30001780793026e-3],
    [2,1,.47661393906987e-4],[2,3,-.44141845330846e-5],
    [2,17,-.72694996297594e-15],[3,-4,-.31679644845054e-4],
    [3,0,-.28270797985312e-5],[3,6,-.85205128120103e-9],
    [4,-5,-.22425281908000e-5],[4,-2,-.65171222895601e-6],
    [4,10,-.14341729937924e-12],[5,-8,-.40516996860117e-6],
    [8,-11,-.12734301741641e-8],[8,-6,-.17424871230634e-9],
    [21,-29,-.68762131295531e-18],[23,-31,.14478307828521e-19],
    [29,-38,.26335781662795e-22],[30,-39,-.11947622640071e-22],
    [31,-40,.18228094581404e-23],[32,-41,-.93537087292458e-25]
  ];
  function saturatedWaterDensities(tempC) {
    // IAPWS SR1-86(1992), équations 2 et 3 ; kg/m³.
    const theta=1-clamp(tempC+273.15,273.16,647.096)/647.096;
    const liquid=322*(1+1.99274064*theta**(1/3)+1.09965342*theta**(2/3)
      -.510839303*theta**(5/3)-1.75493479*theta**(16/3)
      -45.5170352*theta**(43/3)-6.74694450e5*theta**(110/3));
    const vapor=322*Math.exp(-2.0315024*theta**(1/3)-2.6830294*theta**(2/3)
      -5.38626492*theta**(4/3)-17.2991605*theta**3
      -44.7586581*theta**(37/6)-63.9201063*theta**(71/6));
    return {liquid,vapor};
  }
  function liquidWaterDensityKgM3(tempC,pressureBar) {
    const t=clamp(tempC,0,saturationTemperatureC(pressureBar));
    if(t>350){
      // Au-delà du domaine R1 : densité saturée, correction compressible
      // d'étude. Ne pas présenter cette extension comme une région 3 IF97.
      return saturatedWaterDensities(t).liquid
        *Math.exp(.0003*Math.max(0,pressureBar-saturationPressureBar(t)));
    }
    const tk=t+273.15,pi=pressureBar/165.3,tau=1386/tk;
    let derivative=0;
    for(const [i,j,n] of WATER_R1_TERMS)
      derivative-=n*i*(7.1-pi)**(i-1)*(tau-1.222)**j;
    return 1/(461.526*tk/16.53e6*derivative);
  }
  const nominalSteamTempC = saturationTemperatureC(65);
  const gvWideTopM = 17, gvNarrowBottomM = 12.5;
  // REF-01, tableau 10, p. PDF 76 : 64,74 t d'eau à 60 % GE (GV 68/19).
  // La conversion hauteur–masse reste linéaire dans cette géométrie d'étude.
  const gvKgPerMetre = 64740 / (gvNarrowBottomM + 0.60 * (gvWideTopM - gvNarrowBottomM));
  const gvNominalWaterKg = gvKgPerMetre * (gvNarrowBottomM + 0.55 * (gvWideTopM - gvNarrowBottomM));
  const secondaryCpJkgK = 4200, areFeedTempC = 245;
  // Contribution métallique effective d'étude, sans compter une seconde fois
  // l'eau primaire, déjà incluse dans son propre bilan énergétique.
  const gvMetalHeatCapacityJk = 100e6;
  // Coefficient global combustible–primaire retenu pour l'étude : 10 MW/°C.
  const coreExchangeMWC = 10;
  const nominalCoreThermalMW = 3817, primaryPumpHeatMWPerUnit = 6;
  const nominalPrimaryHeatMW = nominalCoreThermalMW + 4*primaryPumpHeatMWPerUnit;
  // Garder le débit vapeur nominal ; son enthalpie effective inclut désormais
  // la chaleur des GMPP évacuée par les GV, en plus de celle du cœur.
  const nominalSteamKgSPerGV = nominalCoreThermalMW*1e6/(4*1.8e6);
  const steamEnthalpyJkg = nominalPrimaryHeatMW*1e6/(4*nominalSteamKgSPerGV);
  const C = Object.freeze({
    nominalThermalMW: nominalCoreThermalMW, nominalElectricMW: 1300,
    primaryPumpHeatMWPerUnit, nominalPrimaryHeatMW,
    nominalPrimaryMassKg: 269064, nominalPrimaryFlowKgS: 17588,
    primaryCpJkgK: 6000, coreBypassFraction: 0.07,
    corePowerFraction: 0.99, fuelHeatCapacityJk: 45e6,
    primaryPressureBar: 155, primaryMeanC: 306.5,
    fuelC: 306.5 + nominalCoreThermalMW / coreExchangeMWC,
    steamTempC: nominalSteamTempC, steamPressureBar: 65, steamEnthalpyJkg,
    pzrPolytropicExponent: 1.2, primaryPressureMaxBar: 220,
    // Capacité thermique effective d'étude du liquide chaud et des parois
    // participant au flash/à la condensation, au niveau nominal de 42 %.
    // Recalage du modèle réduit sur -0,15 bar/s à pleine aspersion :
    // eau chaude participante + parois, sans assimiler cette capacité
    // effective à la seule masse liquide géométrique du PZR.
    pzrPhaseHeatCapacityJk: 156e6,
    breakCriticalFluxKgM2S: 25000,
    primaryDensityKgM3: 720, risWaterDensityKgM3: 1000,
    risInjectionTempC: 20, risBoronPpm: 2500, risTankVolumeM3: 2315,
    easSumpMaxTempC: 89.9,
    minPrimaryMassFraction: 0.20,
    pumpHeadHotBar: 7, pumpHeadColdBar: 10,
    sprayDriveNominalBar: 3.5,
    sprayFullM3hPerValve: 125, sprayContinuousM3hPerValve: 0.230,
    sprayStrokePctPerS: 50,
    auxiliarySprayMaxM3h: 8, coreDamageDelayS: 5,
    // REF-01, §4.8 : hystérésis de chaque groupe de soupapes PZR.
    reliefOpenBar: [166,170,172], reliefCloseBar: [160,164,166],
    reliefDelayS: 0.3, reliefStrokeS: 1.5,
    nominalSprayPct: 0, nominalHeaterKW: 288,
    // À 155 bar, 288 kW de chaufferettes compensent l'échange passif et
    // le refroidissement des deux lignes d'aspersion continue (0,46 m³/h).
    pzrPassiveTransferKW: 288-0.46*liquidWaterDensityKgM3(288.4,155)/3600*6000
      *(saturationTemperatureC(155)-288.4)/1000,
    // Calage sur le gradient documenté de -0,15 bar/s à pleine aspersion.
    pressureHeatGainBarPerMWs: 0.15/(250*liquidWaterDensityKgM3(288.4,155)/3600*6000
      *(saturationTemperatureC(155)-288.4)/1e6),
    pumpCoastdownTauS: 15,
    // Seuil pédagogique de risque de cavitation, distinct de l'amorçage
    // du thermosiphon au sommet des faisceaux. Pas de calcul NPSH local.
    primaryPumpLowLevelM: 11, primaryPumpLowLevelBandM: 0.5,
    naturalCirculationKgSPerLoop: 250, naturalCirculationMaxKgSPerLoop: 300,
    naturalCirculationReferenceDeltaC: 10,
    boronInitialPpm: 1200, boronWorthPcmPpm: -7,
    coolantWorthPcmC: -30, dopplerWorthPcmC: -2.6,
    promptGenerationS: 0.1, beta: 0.0065,
    betaGroups: [0.00025, 0.00125, 0.0012, 0.0026, 0.0009, 0.0003],
    lambdaGroups: [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01],
    rodStroke: 260, rodSpeedPasS: 1.2, dropTimeS: 2.24,
    coreConductanceMWC: coreExchangeMWC,
    gvConductanceMWCPerUnit: nominalPrimaryHeatMW / (4 * (306.5 - nominalSteamTempC)),
    gvNominalWaterKg, gvKgPerMetre, gvWideTopM, gvNarrowBottomM,
    gvNominalLevelPct: 55, gvMetalHeatCapacityJk,
    gvHeatCapacityJk: gvMetalHeatCapacityJk + gvNominalWaterKg*secondaryCpJkgK,
    areFeedTempC,
    // Lv effectif calé pour conserver 530,14 kg/s avec 960,25 MW/GV au nominal.
    // Sa variation suit la table Lv(P) ; ce n'est pas une EOS secondaire complète.
    gvLatentHeatNominalJkg: steamEnthalpyJkg-secondaryCpJkgK*(nominalSteamTempC-areFeedTempC),
    steamValveStrokePctPerS: 50,
    gctATempC: saturationTemperatureC(88.6), gctAPressureBar: 88.6,
    // Hypothèses d'étude pour la modulation et la capacité du GCT-A par GV.
    gctABandBar: 1, gctAFullKgSPerGV: 600, gctAStrokePctPerS: 50,
    // ASG : table symétrique utilisateur, avec hystérésis opérateur 10/90 % GE.
    asgStartDelayS: 5,
    asgFeedTempC: 20, secondaryCpJkgK,
    nominalSteamKgSPerGV,
    rcvNominalM3h: 36, rcvSealM3h: 6, rcvLetdownM3h: 36,
    // Point fourni : 44 m³/h à 177 bar. Courbe parabolique d'étude,
    // hauteur à débit nul fixée à 180 bar ; plafond de commande 60 m³/h.
    rcvMaxCommandM3h: 60, rcvPumpShutoffBar: 180,
    rcvPumpReferenceBar: 177, rcvPumpReferenceM3h: 44,
    rcvTransitS: 8, risTransitS: 4,
    rcvOrificeM3h: 18, reaBoronPpm: 7000,
    // Réglage utilisateur dans les plages REF-01, §4.11 : 27 m³ d'eau,
    // 20 m³ d'azote à 42 bar. K/A² est déjà rapporté à la section.
    accumulatorTransitS: 1, accumulatorKgPerLoop: 27000,
    accumulatorVolumeM3: 47, accumulatorPressureBar: 42,
    accumulatorPolytropicExponent: 1.35, accumulatorResistanceM4: 3050,
    accumulatorPipeDiameterM: .254, accumulatorLineWaterM3: 1.19,
    accumulatorEndDrainTauS: 3,
    // Montée en vitesse d'étude, faute de courbe de démarrage constructeur.
    risPumpStartS: 2,
    tripLowPressureBar: 130, risLowPressureBar: 120,
    tripHighFluxPct: 109, fluxPrealarmPct: 102,
    tripFluxRatePctS: 5, tripActuationS: 0.35,
    risActuationS: 2, dieselStartS: 10,
    axialNodes: 32, axialZones: 32, axialDetectors: 6,
    nominalAverageLinearWcm: 170.23, activeFuelHeightM: 4.2672,
    tripLinearWcm: 435,
    axialCoupling: 1, axialModeratorAbsorptionPerC: 0.001,
    axialXenonAbsorption: 0.6, xenonEquilibriumWorthPcm: 3000,
    iodineHalfLifeH: 6.6, xenonHalfLifeH: 9.1,
    xenonNominalCapturePerH: 0.2,
    dpaxReferencePctPn: -1
  });

  // Capacités équivalentes d'étude. Les altitudes suivent le croquis fourni,
  // rapportées au fond de cuve ; les volumes sont une répartition schématique
  // de l'inventaire nominal existant, pas une géométrie qualifiée REP 1300.
  const CPP_GEOMETRY = Object.freeze([
    {id:"vessel",label:"Cuve",bottom:0,top:10.63,volume:90},
    {id:"hot",label:"Branches chaudes · 4",bottom:8.0,top:9.4,volume:36},
    {id:"cold",label:"Branches froides · 4",bottom:8.0,top:9.4,volume:40},
    {id:"u",label:"Branches en U · 4",bottom:5.3,top:8.7,volume:30},
    ...[1,2,3,4].map(i=>({id:`gv${i}`,label:`Faisceau GV${i}`,
      bottom:9.2,top:22.1+(i-1)*0.06,volume:40})),
    {id:"pzr",label:"Pressuriseur",bottom:18.1,top:30.1,volume:40}
  ]);
  const CPP_INITIAL_LEVEL_M=18.1+12*0.42;
  const CPP_CORE_BOTTOM_M=3.4, CPP_CORE_TOP_M=CPP_CORE_BOTTOM_M+C.activeFuelHeightM;
  const geometryFill=(g,h)=>clamp((h-g.bottom)/(g.top-g.bottom),0,1);
  const CPP_NOMINAL_DENSITY=liquidWaterDensityKgM3(C.primaryMeanC,C.primaryPressureBar);
  const CPP_VOLUME_SCALE=C.nominalPrimaryMassKg/CPP_NOMINAL_DENSITY
    /CPP_GEOMETRY.reduce((sum,g)=>sum+g.volume*geometryFill(g,CPP_INITIAL_LEVEL_M),0);
  const CPP_LOOP_CAPACITIES=CPP_GEOMETRY.filter(g=>g.id!=="pzr");
  const CPP_LOOP_VOLUME=CPP_LOOP_CAPACITIES.reduce((sum,g)=>sum+g.volume*CPP_VOLUME_SCALE,0);
  const CPP_LOOP_TOP_M=Math.max(...CPP_LOOP_CAPACITIES.map(g=>g.top));
  const CPP_PZR_GEOMETRY=CPP_GEOMETRY.find(g=>g.id==="pzr");
  const CPP_PZR_VOLUME=CPP_PZR_GEOMETRY.volume*CPP_VOLUME_SCALE;
  const CPP_TOTAL_VOLUME=CPP_LOOP_VOLUME+CPP_PZR_VOLUME;
  function cppInventory(liquidMassKg,tempC=C.primaryMeanC,pressureBar=C.primaryPressureBar) {
    const densityKgM3=liquidWaterDensityKgM3(tempC,pressureBar);
    const volume=Math.max(0,liquidMassKg)/densityKgM3;
    // Le PZR absorbe d'abord les variations normales d'inventaire : son niveau
    // libre ne constitue pas une surface libre commune aux boucles pressurisées.
    const pzrVolume=clamp(volume-CPP_LOOP_VOLUME,0,CPP_PZR_VOLUME);
    let loopLevelM=CPP_LOOP_TOP_M;
    if(volume<CPP_LOOP_VOLUME){
      let lo=0,hi=CPP_LOOP_TOP_M;
      for(let n=0;n<36;n++) {
        const mid=(lo+hi)/2;
        const contained=CPP_LOOP_CAPACITIES.reduce((sum,g)=>sum+g.volume*CPP_VOLUME_SCALE*geometryFill(g,mid),0);
        if(contained<volume)lo=mid;else hi=mid;
      }
      loopLevelM=(lo+hi)/2;
    }
    const pzrLevelM=pzrVolume>0?CPP_PZR_GEOMETRY.bottom
      +(CPP_PZR_GEOMETRY.top-CPP_PZR_GEOMETRY.bottom)*pzrVolume/CPP_PZR_VOLUME:0;
    const levelM=Math.max(loopLevelM,pzrLevelM),components={};
    for(const g of CPP_GEOMETRY){
      const fill=g.id==="pzr"?pzrVolume/CPP_PZR_VOLUME:geometryFill(g,loopLevelM);
      components[g.id]={massKg:g.volume*CPP_VOLUME_SCALE*fill*densityKgM3,
        fillPct:100*fill,bottomM:g.bottom,topM:g.top};
    }
    const residualMass=liquidMassKg-Object.values(components).reduce((sum,g)=>sum+g.massKg,0);
    const overfillKg=residualMass>.001?residualMass:0;
    return {levelM,liquidMassKg:Math.max(0,liquidMassKg),components,
      densityKgM3,liquidVolumeM3:volume,capacityM3:CPP_TOTAL_VOLUME,
      steamSpaceM3:Math.max(0,CPP_TOTAL_VOLUME-volume),
      compressedLiquidKg:Math.max(0,liquidMassKg-volume
        *liquidWaterDensityKgM3(tempC,Math.max(1,saturationPressureBar(tempC)))),
      overfillKg,loopLevelM,pzrLevelM,
      coreTopM:CPP_CORE_TOP_M,coreBottomM:CPP_CORE_BOTTOM_M,
      coveragePct:100*clamp((levelM-CPP_CORE_BOTTOM_M)/C.activeFuelHeightM,0,1),
      loopPriming:[1,2,3,4].map(i=>clamp((loopLevelM-components[`gv${i}`].topM+0.3)/0.3,0,1))};
  }
  function rcvPumpCapacityM3h(pressureBar) {
    return Math.min(C.rcvMaxCommandM3h,C.rcvPumpReferenceM3h*Math.sqrt(
      Math.max(0,C.rcvPumpShutoffBar-pressureBar)
      /(C.rcvPumpShutoffBar-C.rcvPumpReferenceBar)));
  }
  function primaryPhaseAt(massKg,energyJ,pressureBar) {
    const satC=saturationTemperatureC(pressureBar),latent=latentHeatJkg(pressureBar);
    const tempC=Math.min(satC,Math.max(20,energyJ/(massKg*C.primaryCpJkgK)));
    const vaporKg=clamp((energyJ-massKg*C.primaryCpJkgK*satC)/latent,0,massKg-1);
    const rho=liquidWaterDensityKgM3(tempC,pressureBar);
    const steamDensity=saturatedWaterDensities(satC).vapor;
    return {tempC,vaporKg,latent,satC,rho,
      volumeM3:(massKg-vaporKg)/rho+vaporKg/steamDensity};
  }
  function primaryPressureEquation(oldState,massKg,energyJ,pzrHeatMW,dt,thermalPressureBar=null) {
    // Volume fini : compression polytropique de la poche équivalente,
    // compressibilité du liquide et volume de la vapeur de détente.
    const oldRho=liquidWaterDensityKgM3(oldState.tempC,oldState.pressureBar);
    const oldVaporDensity=saturatedWaterDensities(saturationTemperatureC(oldState.pressureBar)).vapor;
    const oldVolume=(oldState.massKg-oldState.vaporKg)/oldRho+oldState.vaporKg/oldVaporDensity;
    // La tolérance du solveur ne constitue pas une bulle de vapeur : un
    // résidu de volume microscopique dans un CPP plein ne doit pas activer
    // artificiellement la réserve thermique diphasique au pas suivant.
    const free=CPP_TOTAL_VOLUME-oldVolume>1e-6?CPP_TOTAL_VOLUME-oldVolume:0;
    const pzrLiquidM3=clamp((oldState.massKg-oldState.vaporKg)/oldRho-CPP_LOOP_VOLUME,0,CPP_PZR_VOLUME);
    const levelPct=100*pzrLiquidM3/CPP_PZR_VOLUME;
    const response=pzrEquilibriumResponse(oldState,free,levelPct);
    // Une seule fermeture P/M/U/V : le piston n'est plus intégré dans une
    // seconde pression puis ajouté encore par compression de la poche.
    // La vapeur saturée flashe/condense ; sa souplesse n'est pas celle d'un
    // gaz non condensable. La dérivée totale retrouve C_eq au point courant.
    const fastCompliance=free/(C.pzrPolytropicExponent*oldState.pressureBar);
    const phaseCompliance=Math.max(0,response.complianceM3Bar
      -response.liquidCompliance-fastCompliance);
    const heatVolume=response.complianceM3Bar*response.heatGainBarPerMWs*pzrHeatMW*dt;
    // La poche équivalente appartient au PZR : sa réserve ne disparaît pas
    // sur un seuil de niveau ou une horloge. Quand les boucles se vident,
    // leur volume découvert doit être rempli par la vapeur du bilan M/U/V,
    // et non par un gaz fictif qui s'étendrait dans tout le CPP.
    const pocket=Math.min(free,CPP_PZR_VOLUME);
    const pocketAvailability=free>0?pocket/free:0;
    const referencePressure=oldState.pressureBar;
    return p=>primaryPhaseAt(massKg,energyJ,p).volumeM3
      +Math.max(0,pocket*(referencePressure/p)**(1/C.pzrPolytropicExponent)
        +pocketAvailability*phaseCompliance*(referencePressure-p)+heatVolume)-CPP_TOTAL_VOLUME;
  }
  function solvePrimaryPressure(oldState,massKg,energyJ,pzrHeatMW,dt,thermalPressureBar=null) {
    const residual=primaryPressureEquation(oldState,massKg,energyJ,pzrHeatMW,dt,thermalPressureBar);
    let lo=1,hi=C.primaryPressureMaxBar;
    if(residual(lo)<=0)return lo;
    if(residual(hi)>=0)return hi;
    let p=clamp(oldState.pressureBar,lo,hi);
    for(let i=0;i<32;i++){
      const value=residual(p);
      if(Math.abs(value)<1e-9)return p;
      if(value>0)lo=p;else hi=p;
      const probe=clamp(p+(p+.01<hi?.01:-.01),lo,hi);
      const slope=probe!==p?(residual(probe)-value)/(probe-p):0;
      const next=slope<0?p-value/slope:NaN;
      p=Number.isFinite(next)&&next>lo&&next<hi?next:(lo+hi)/2;
    }
    return (lo+hi)/2;
  }
  function pzrEquilibriumResponse(oldState,freeM3,levelPct) {
    // Compliance saturée utilisée dans la même fermeture implicite que le
    // déplacement d'eau, la compression et les apports de chaleur.
    const p=oldState.pressureBar,probe=Math.min(C.primaryPressureMaxBar,p+.01);
    const dp=probe-p||.01;
    const sat=saturationTemperatureC(p),nextSat=saturationTemperatureC(p+dp);
    const density=saturatedWaterDensities(sat),nextDensity=saturatedWaterDensities(nextSat);
    const phaseAvailability=clamp(freeM3/.4,0,1);
    const liquidCompliance=(oldState.massKg-oldState.vaporKg)
      *(1/liquidWaterDensityKgM3(oldState.tempC,p)
        -1/liquidWaterDensityKgM3(oldState.tempC,p+dp))/dp;
    // À saturation, la masse volumique de vapeur change avec P et Tsat.
    // V/(nP) décrit la compression rapide ; il ne convient pas à cette
    // réponse d'équilibre et sous-estimait sa souplesse.
    const steamCompliance=Math.max(0,freeM3)*(nextDensity.vapor-density.vapor)/(dp*density.vapor);
    const hotWaterExpansion=-CPP_PZR_VOLUME*clamp(levelPct,0,100)/100*density.liquid
      *(1/nextDensity.liquid-1/density.liquid)/dp*phaseAvailability;
    const phaseCapacity=C.pzrPhaseHeatCapacityJk*clamp(levelPct/42,.1,2.38)*phaseAvailability;
    const latentVolume=1/density.vapor-1/density.liquid;
    const phaseCompliance=phaseCapacity*(nextSat-sat)/dp/latentHeatJkg(p)*latentVolume;
    const complianceM3Bar=Math.max(.001,liquidCompliance+steamCompliance+hotWaterExpansion+phaseCompliance);
    return {complianceM3Bar,
      heatGainBarPerMWs:phaseAvailability*latentVolume*1e6/latentHeatJkg(p)/complianceM3Bar,
      liquidCompliance,steamCompliance,hotWaterExpansion,phaseCompliance,phaseCapacityJk:phaseCapacity};
  }
  function advancePrimaryPressure(before,massKg,energyJ,pzrHeatMW,reliefSteamKgS,thermalPressureBar,levelPct,dt,trialPressureBar=null) {
    const oldVolume=(before.massKg-before.vaporKg)/liquidWaterDensityKgM3(before.tempC,before.pressureBar)
      +before.vaporKg/saturatedWaterDensities(saturationTemperatureC(before.pressureBar)).vapor;
    const displacementM3=primaryPhaseAt(massKg,energyJ,before.pressureBar).volumeM3-oldVolume;
    const response=pzrEquilibriumResponse(before,Math.max(0,CPP_TOTAL_VOLUME-oldVolume),levelPct);
    const effectiveHeatMW=pzrHeatMW-reliefSteamKgS*latentHeatJkg(before.pressureBar)/1e6;
    const volumeResidualM3=trialPressureBar===null?null
      :primaryPressureEquation(before,massKg,energyJ,effectiveHeatMW,dt)(trialPressureBar);
    const pressureBar=trialPressureBar??solvePrimaryPressure(before,massKg,energyJ,effectiveHeatMW,dt);
    return {pressureBar,
      volumeResidualM3,
      thermalPressureBar:pressureBar,displacementM3,response};
  }
  // Chaleur latente : interpolation de valeurs vapeur saturée (kJ/kg).
  // Cp effectif reste celui du modèle nominal ; ce n'est pas une EOS diphasique.
  function latentHeatJkg(p) {
    return 1000*interpolation([[1,2257],[5,2108],[10,2015],[20,1889],
      [40,1714],[70,1505],[100,1318],[155,966],[180,777]],clamp(p,1,180));
  }
  function gvThermalCapacityJk(waterKg) {
    return C.gvMetalHeatCapacityJk+Math.max(0,waterKg)*C.secondaryCpJkgK;
  }
  function gvLatentHeatJkg(pressureBar) {
    return C.gvLatentHeatNominalJkg*latentHeatJkg(pressureBar)/latentHeatJkg(C.steamPressureBar);
  }
  function accumulatorFlowKgS(pressureBar,waterKg,previousFlowKgS=null,dt=0) {
    const gas0=C.accumulatorVolumeM3-C.accumulatorKgPerLoop/C.risWaterDensityKgM3;
    const gas=Math.max(gas0,C.accumulatorVolumeM3-Math.max(0,waterKg)/C.risWaterDensityKgM3);
    const nitrogenBar=C.accumulatorPressureBar*(gas0/gas)**C.accumulatorPolytropicExponent;
    const deltaPa=(nitrogenBar-pressureBar)*1e5;
    let flow=waterKg>0?Math.sqrt(2*Math.max(0,deltaPa)
      *C.risWaterDensityKgM3/C.accumulatorResistanceM4):0;
    if(waterKg>0&&previousFlowKgS!==null&&dt>0){
      // (L/A) dq/dt = ΔP − (K/A²) q|q|/(2ρ), q massique en kg/s.
      // Longueur équivalente déduite du volume de ligne et du diamètre.
      // Pas implicite : stable même lorsque la contre-pression augmente.
      const area=Math.PI*C.accumulatorPipeDiameterM**2/4;
      const inertia=C.accumulatorLineWaterM3/(area*area);
      const a=dt*C.accumulatorResistanceM4/(2*C.risWaterDensityKgM3);
      const rhs=Math.max(0,inertia*Math.max(0,previousFlowKgS)+dt*deltaPa);
      flow=2*rhs/(inertia+Math.sqrt(inertia*inertia+4*a*rhs));
    }
    return {nitrogenBar,flowKgS:flow};
  }
  function ptLimits(tempC) {
    const t=clamp(tempC,0,373.9);
    // Reprise du tracé fourni : limite chaude TSAT−30, limite froide TSAT−110
    // puis PSAT+110 ; domaine bas API/AN-RRA.
    const npshMargin=8*clamp((220-t)/40,0,1);
    const lower=t<=70?5:t<=160?25:t<=180?27:t>297.2?155
      :saturationPressureBar(Math.min(373.9,t+30))+npshMargin;
    const upper=t<=160?31:Math.min(155,saturationPressureBar(Math.min(373.9,t+110)),saturationPressureBar(t)+110);
    return {lowerBar:lower,upperBar:upper,inside:t>=10&&t<=306.501&&lower<=upper};
  }
  function reactorOperatingState(s) {
    const antireactivityPcm=Math.max(0,-s.reactivityPcm);
    // La cinétique conserve un plancher numérique : 0,01 % PN représente ici 0 %.
    const neutronPowerNearZero=s.powerPct<=0.01;
    const coreSubcritical=s.reactivityPcm<0;
    const coreConverged=neutronPowerNearZero&&coreSubcritical;
    const cia=[s.tripDemandAt,s.tripAt,s.risDemandAt,s.risAt].some(t=>t!==null&&t!==undefined);
    const code=cia?"CIA":coreConverged?"AN/GV":"RP";
    const label=cia?"Conduite incidentelle ou accidentelle":coreConverged?"Arrêt normal sur GV":"Réacteur en production";
    return {code,label,caption:`${code} · ${label}`,coreConverged,coreSubcritical,neutronPowerNearZero,antireactivityPcm,
      standardApplicable:!cia,
      ptRule:cia?"CIA · domaine standard non applicable":coreConverged?
        "AN/GV · limites du diagramme P–T":"RP · 297,2–307,5 °C · 150–160 bar"};
  }
  function isPtOutside(s) {
    const state=reactorOperatingState(s);
    if(!state.standardApplicable)return false;
    // Tolérance d'affichage RP : température haute à 307,5 °C et 150–160 bar.
    if(state.code==="RP")return s.tavgC<297.199||s.tavgC>307.5||s.pressureBar<150||s.pressureBar>160;
    const limits=ptLimits(s.tavgC);
    return s.tavgC>297.201||!limits.inside||s.pressureBar<limits.lowerBar-0.1||s.pressureBar>limits.upperBar+0.1;
  }
  function rraConditions(s) {
    const reasons=[];
    if(s.tavgC<90||s.tavgC>180)reasons.push("90 ≤ TMOY ≤ 180 °C");
    if(s.pressureBar<25||s.pressureBar>31)reasons.push("25 ≤ P ≤ 31 bar abs.");
    if(!reactorOperatingState(s).neutronPowerNearZero)
      reasons.push("puissance neutronique ≤ 0,01 % PN");
    if(s.inventory.levelM<CPP_CORE_TOP_M)reasons.push("cœur couvert");
    if(s.endState==="melted")reasons.push("cœur endommagé");
    return {allowed:reasons.length===0,reasons};
  }
  function connectRra(model) {
    const s=model.state;
    if(!rraConditions(s).allowed)return false;
    s.rraConnected=true;s.rraFlowKgS=200;s.endState="safe";
    s.endReason="RRA connecté : puissance neutronique quasi nulle, cœur couvert, température et pression dans le domaine de connexion.";
    addEvent(s,"system","Cœur sain et sauf · connexion du RRA");return true;
  }
  function setRisOperation(model,mode) {
    if(!["auto","on","off"].includes(mode))return;
    model.controls.risPumpMode=mode;
    if(mode==="on")requestRis(model.state,"RIS : démarrage manuel");
    addEvent(model.state,"action",`Pompes RIS : ${mode==="off"?"arrêt manuel":mode==="on"?"marche manuelle":"demande IS"}`);
  }

  // Numérisation d'étude de la figure 7.14, ancrée à 780 pas extraits à 100 %.
  const G3 = Object.freeze({
    debut: [[0,260],[10,290],[20,315],[30,340],[40,355],[50,390],[60,440],[70,482],[80,535],[90,600],[100,780]],
    milieu: [[0,230],[10,260],[20,295],[30,330],[40,355],[50,380],[60,405],[70,480],[80,535],[90,610],[100,780]],
    fin: [[0,210],[10,225],[20,240],[30,290],[40,330],[50,360],[60,385],[70,455],[80,527],[90,580],[100,780]]
  });
  const ROD_NAMES = Object.freeze(["R", "G1", "G2", "N1", "N2", "SA", "SB", "SC", "SD"]);
  // Valeurs d'étude choisies par l'utilisateur, distinctes des mesures
  // REP 1300 de 2006 : Exploitation des cœurs REP, tableaux 6.7–6.9.
  // La forme axiale et la somme des groupes restent pédagogiques.
  const ROD_WORTH_PCM = Object.freeze({
    R: 1500, G1: 200, G2: 480, N1: 750, N2: 1200,
    SA: 500, SB: 700, SC: 900, SD: 300
  });
  // Absorption axiale homogénéisée : paramètres de forme d'étude distincts
  // des efficacités intégrales en pcm. À recaler sur des cartes de flux/RPN.
  const AXIAL_ROD_ABSORPTION = Object.freeze({
    R: 0.70, G1: 0.10, G2: 0.25, N1: 0.35, N2: 0.020
  });
  const OVERLAP_OFFSETS = Object.freeze([0, 185, 360, 515]);

  function axialInsertionFraction(position, zone) {
    // Mailles numérotées du bas vers le haut ; insertion par le haut.
    const insertedZones=C.axialZones*(C.rodStroke-clamp(position,0,C.rodStroke))/C.rodStroke;
    return clamp(insertedZones-(C.axialZones-1-zone),0,1);
  }

  function axialCoolantTemperatures(coldC, thermalMW, flowFraction, shape) {
    const zoneTemperatures=[];
    const coreFlow=flowFraction*C.nominalPrimaryFlowKgS*(1-C.coreBypassFraction);
    // Le bilan diphasique a déjà séparé le sensible et le latent dans step.
    // Cette lecture axiale n'extrapole pas un Q/(débit Cp) au débit nul.
    const rise=coreFlow>1 ? Math.max(0,thermalMW)*C.corePowerFraction*1e6
      /(coreFlow*C.primaryCpJkgK) : 0;
    let inlet=coldC;
    for(const value of shape) {
      const zoneRise=rise*value/C.axialZones;
      zoneTemperatures.push(inlet+zoneRise/2);
      inlet+=zoneRise;
    }
    return zoneTemperatures;
  }

  function solveAxialShape(rods, xenon, temperatureOffset, initial,
    coefficients=AXIAL_ROD_ABSORPTION,xenonAbsorption=C.axialXenonAbsorption) {
    // Plus petite valeur propre du bilan diffusion/absorption 1D.
    // L'itération inverse et la résolution tridiagonale restent O(N).
    const n=C.axialZones,c=C.axialCoupling*(n/6)**2;
    let shape=initial?.length===n ? [...initial] :
      Array.from({length:n},(_,i)=>Math.sin(Math.PI*(i+0.5)/n));
    const absorption=Array.from({length:n},(_,i)=>{
      let value=xenonAbsorption*((xenon?.[i]??1)-1);
      value+=C.axialModeratorAbsorptionPerC*(temperatureOffset?.[i]??0);
      for(const [name,strength] of Object.entries(coefficients))
        value+=strength*axialInsertionFraction(rods[name],i);
      return value;
    });
    // Décalage uniforme : mêmes vecteurs propres, opérateur positif.
    // L'itération inverse conserve ainsi le mode fondamental positif,
    // même avec un poids élevé et une faible concentration de xénon.
    const shift=0.2-Math.min(...absorption);
    const diag=absorption.map((value,i)=>{
      // Flux nul aux limites ; nœud fantôme opposé au nœud de bord.
      return (i===0||i===n-1 ? 3 : 2)*c+shift+value;
    });
    for(let iteration=0;iteration<60;iteration++) {
      const pivot=Array(n),rhs=Array(n);
      pivot[0]=diag[0];rhs[0]=shape[0];
      for(let i=1;i<n;i++) {
        const factor=-c/pivot[i-1];
        pivot[i]=diag[i]+c*factor;
        rhs[i]=shape[i]-factor*rhs[i-1];
      }
      const next=Array(n);
      next[n-1]=rhs[n-1]/pivot[n-1];
      for(let i=n-2;i>=0;i--)next[i]=(rhs[i]+c*next[i+1])/pivot[i];
      const mean=next.reduce((sum,value)=>sum+value,0)/n;
      let change=0;
      for(let i=0;i<n;i++) {
        next[i]/=mean;
        change=Math.max(change,Math.abs(next[i]-shape[i]));
      }
      shape=next;
      if(change<1e-9)break;
    }
    return shape;
  }

  function detectorMeans(shape) {
    // Intégration exacte des recouvrements entre 32 mailles et six sections.
    const n=shape.length,m=C.axialDetectors;
    return Array.from({length:m},(_,j)=>{
      let integral=0;
      for(let i=0;i<n;i++) {
        const overlap=Math.max(0,Math.min((i+1)/n,(j+1)/m)
          -Math.max(i/n,j/m));
        integral+=overlap*shape[i];
      }
      return m*integral;
    });
  }

  function smoothAxialProfile(shape, z) {
    // Interpolation cubique préservant les extrema ; elle ne crée pas de
    // puissance supplémentaire entre les valeurs de calcul.
    const xs=[0,...shape.map((_,i)=>(i+0.5)/shape.length),1];
    const ys=[0,...shape,0];
    const slopes=xs.slice(1).map((x,i)=>(ys[i+1]-ys[i])/(x-xs[i]));
    const derivatives=ys.map((_,i)=>{
      if(i===0)return slopes[0];
      if(i===ys.length-1)return slopes.at(-1);
      const left=slopes[i-1],right=slopes[i];
      if(left*right<=0)return 0;
      const h0=xs[i]-xs[i-1],h1=xs[i+1]-xs[i];
      const w0=2*h1+h0,w1=h1+2*h0;
      return (w0+w1)/(w0/left+w1/right);
    });
    let interval=0;
    while(interval<xs.length-2 && z>xs[interval+1])interval++;
    const h=xs[interval+1]-xs[interval];
    const t=clamp((z-xs[interval])/h,0,1);
    return Math.max(0,(2*t**3-3*t*t+1)*ys[interval]
      +(t**3-2*t*t+t)*h*derivatives[interval]
      +(-2*t**3+3*t*t)*ys[interval+1]
      +(t**3-t*t)*h*derivatives[interval+1]);
  }

  const IODINE_DECAY_S=Math.LN2/(C.iodineHalfLifeH*3600);
  const XENON_DECAY_S=Math.LN2/(C.xenonHalfLifeH*3600);
  const XENON_CAPTURE_S=C.xenonNominalCapturePerH/3600;
  const INITIAL_RODS={R:233,G1:260,G2:260,N1:260,N2:260};
  const INITIAL_AXIAL_EQUILIBRIUM=(()=>{
    // Production d'iode proportionnelle au flux local ; destruction du Xe
    // par décroissance et capture. La concentration moyenne nominale vaut 1.
    let shape=solveAxialShape(INITIAL_RODS,Array(C.axialZones).fill(1),
      Array(C.axialZones).fill(0));
    let xenon=Array(C.axialZones).fill(1),productionScale=1;
    for(let iteration=0;iteration<40;iteration++) {
      const raw=shape.map(flux=>(XENON_DECAY_S+XENON_CAPTURE_S)*flux
        /(XENON_DECAY_S+XENON_CAPTURE_S*flux));
      productionScale=C.axialZones/raw.reduce((a,b)=>a+b,0);
      xenon=raw.map(value=>productionScale*value);
      const next=solveAxialShape(INITIAL_RODS,xenon,
        Array(C.axialZones).fill(0),shape);
      const change=Math.max(...next.map((value,i)=>Math.abs(value-shape[i])));
      shape=next;
      if(change<1e-10)break;
    }
    return {shape,xenon,iodine:[...shape],productionScale};
  })();
  const INITIAL_AXIAL_SHAPE=INITIAL_AXIAL_EQUILIBRIUM.shape;
  const INITIAL_XENON32=INITIAL_AXIAL_EQUILIBRIUM.xenon;
  const INITIAL_IODINE32=INITIAL_AXIAL_EQUILIBRIUM.iodine;
  const XENON_PRODUCTION_SCALE=INITIAL_AXIAL_EQUILIBRIUM.productionScale;
  const INITIAL_AXIAL_COOLANT=axialCoolantTemperatures(288.4,C.nominalThermalMW,1,
    INITIAL_AXIAL_SHAPE);

  function interpolation(points, x) {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i][0]) {
        const [xa, ya] = points[i-1], [xb, yb] = points[i];
        return lerp(ya, yb, (x - xa) / (xb - xa));
      }
    }
    return points[points.length-1][1];
  }
  function g3Target(powerPct, campaign) {
    return interpolation(G3[campaign] || G3.debut, clamp(powerPct, 0, 100));
  }
  function gcpPositions(counter) {
    const q = counter - 520;
    return OVERLAP_OFFSETS.map(offset => clamp(q + offset, 0, C.rodStroke));
  }
  function rInsertionLimit(powerPct, halfCycle) {
    const p = clamp(powerPct, 0, 100);
    return halfCycle === "seconde" ? 211 - 0.13 * p : 202 - 0.16 * p;
  }
  function dpaxRightLimit(powerPct) {
    const p=clamp(Number(powerPct)||0,0,100);
    return p<=15 ? p : 15-(p-15)*9/85;
  }
  function isDpaxRightExceeded(s) {
    return s.dpaxPctPn>dpaxRightLimit(s.powerPct)+1e-6;
  }
  function rcvLetdownM3h(model) {
    return model.controls.rcvLetdownCloseGraph===true?0
      :C.rcvOrificeM3h*model.controls.rcvLetdownOrifices.filter(Boolean).length;
  }
  function rcvChargeBoronPpm(model) {
    const u=model.controls;
    const mode=rcvInjectionMode(model);
    return mode==="dilution" ? 0 : mode==="borication"
      ? C.reaBoronPpm : clamp(Number(u.rcvTankBoronPpm)||0,0,C.reaBoronPpm);
  }
  function rcvInjectionMode(model) {
    return model.controls.rcvInjectionGraphMode??model.controls.rcvInjectionMode;
  }
  function setRcvGraphInjection(model,borication,dilution) {
    const u=model.controls,s=model.state;
    const controlled=Number.isFinite(borication)||Number.isFinite(dilution);
    const b=Number.isFinite(borication)&&borication>=.5,d=Number.isFinite(dilution)&&dilution>=.5;
    // Deux ordres simultanés sont contradictoires : ni dilution ni borication.
    const mode=controlled?(b===d?"off":b?"borication":"dilution"):null;
    if(mode!==u.rcvInjectionGraphMode||Boolean(u.rcvInjectionGraphConflict)!==Boolean(b&&d)){
      if(controlled)u.rcvInjectionMode="off";
      u.rcvInjectionGraphMode=mode;
      u.rcvInjectionGraphConflict=Boolean(b&&d);
      addEvent(s,b&&d?"alarm":"action",b&&d?"CC RCV : ordres de dilution et borication simultanés · apport suspendu"
        :mode===null?"RCV : retour à la commande manuelle"
        :`CC RCV : ${mode==="off"?"arrêt dilution/borication":mode}`);
    }
    s.rcvTankBoronPpm=rcvChargeBoronPpm(model);
  }
  function rodIntegral(position) {
    return (1 - Math.cos(Math.PI * clamp(position, 0, 260) / 260)) / 2;
  }
  function rodsReactivityPcm(rods, ejectedWorthPcm, worth = ROD_WORTH_PCM) {
    const baseline = { R: 233, G1: 260, G2: 260, N1: 260, N2: 260,
      SA: 260, SB: 260, SC: 260, SD: 260 };
    return ROD_NAMES.reduce((sum, name) => sum + worth[name]
      * (rodIntegral(rods[name]) - rodIntegral(baseline[name])), ejectedWorthPcm);
  }
  function addEvent(s, kind, text) {
    s.events.push({ time: s.time, kind, text });
    if (s.events.length > 240) s.events.shift();
  }
  function gvLevels(waterKg) {
    const levelMetres = Math.max(0, waterKg) / C.gvKgPerMetre;
    return {
      levelMetres,
      levelWidePct: clamp(100 * levelMetres / C.gvWideTopM, 0, 100),
      levelPct: clamp(100 * (levelMetres - C.gvNarrowBottomM)
        / (C.gvWideTopM - C.gvNarrowBottomM), 0, 100)
    };
  }
  function asgFlowKgS(pressureBar) {
    // Table symétrique fournie, débit par GV : 2 TPS + 2 MPS au total.
    // Hors 30–80 bar : maintien aux valeurs extrêmes, sans extrapolation.
    return interpolation([[30,157],[40,152],[60,140],[80,127]],clamp(pressureBar,30,80))
      *C.risWaterDensityKgM3/3600;
  }
  function nominalGv() {
    return Array.from({length:4}, (_, i) => ({
      index: i + 1, waterKg: C.gvNominalWaterKg,
      ...gvLevels(C.gvNominalWaterKg), feedKgS: C.nominalSteamKgSPerGV,
      feedValvePct: 100 * C.nominalSteamKgSPerGV / 950,
      asgKgS: 0, asgCoolingMW: 0, asgRunning: false,
      asgType: i%2===0?"MPS":"TPS",
      steamValvePct: 100, gctAValvePct: 0,
      turbineSteamKgS: C.nominalSteamKgSPerGV,
      steamKgS: C.nominalSteamKgSPerGV, dumpKgS: 0,
      secondaryBreakAreaCm2: 0, secondaryBreakKgS: 0,
      secondaryBreakReleasedKg: 0, secondaryBreakEnergyJ: 0,
      waterMassRateKgS: 0,
      heatMW: C.nominalPrimaryHeatMW / 4,
      thermalCapacityJk: C.gvHeatCapacityJk,
      thermalEnergyJ: C.gvHeatCapacityJk*C.steamTempC,
      steamLatentJkg: C.gvLatentHeatNominalJkg,
      areCoolingMW: C.nominalSteamKgSPerGV*C.secondaryCpJkgK*(C.steamTempC-C.areFeedTempC)/1e6,
      tempC: C.steamTempC, pressureBar: C.steamPressureBar
    }));
  }
  function initialState() {
    const precursor = C.betaGroups.map((beta, i) => beta / (C.promptGenerationS * C.lambdaGroups[i]));
    const rods = Object.fromEntries(ROD_NAMES.map(name => [name, name === "R" ? 233 : 260]));
    const nominalFlow = C.nominalPrimaryFlowKgS / 4;
    return {
      time: 0, powerPct: 100, thermalPowerMW: C.nominalThermalMW,
      fissionMW: C.nominalThermalMW, decayMW: 0, coreTransferMW: C.nominalThermalMW,
      pumpHeatMW: 4*C.primaryPumpHeatMWPerUnit,
      electricMW: C.nominalElectricMW,
      turbinePct: 100, demandPct: 100, trefC: C.primaryMeanC, nrefPct: 41.8, prefBar: 155,
      precursors: precursor, reactivityPcm: 0,
      reactivityParts: {rod:0,boron:0,temp:0,doppler:0,
        coreReference:C.xenonEquilibriumWorthPcm,xenon:-C.xenonEquilibriumWorthPcm},
      xenonWorthPcm: -C.xenonEquilibriumWorthPcm,
      fuelC: C.fuelC, tavgC: C.primaryMeanC,
      hotC: 324.6, coldC: 288.4, tRicC: 326.9,
      pressureBar: C.primaryPressureBar, pzrLevelPct: 42,
      primaryMassKg: C.nominalPrimaryMassKg, coveragePct: 100,
      inventory:cppInventory(C.nominalPrimaryMassKg),
      vaporMassKg:0, vaporEnergyJ:0, vaporizationKgS:0, sensibleCoreMW:C.nominalThermalMW,
      primaryMassRateKgS:0,vaporMassRateKgS:0,phaseChangeKgS:0,
      primaryEnergyJ:C.nominalPrimaryMassKg*C.primaryCpJkgK*C.primaryMeanC,
      lidC:324.6, saturationC:saturationTemperatureC(C.primaryPressureBar),
      breakLiquidKgS:0,breakSteamKgS:0,risCoreKgS:0,coreFlowKgS:C.nominalPrimaryFlowKgS,
      sumpKg:0,sumpBoron:0,sumpEnergyJ:0,sumpTempC:20,sumpBoronPpm:C.risBoronPpm,easCoolingMW:0,
      flowProperties:{charge:{tempC:C.primaryMeanC,boronPpm:C.boronInitialPpm},
        risMp:{tempC:C.risInjectionTempC,boronPpm:C.risBoronPpm},
        risBp:{tempC:C.risInjectionTempC,boronPpm:C.risBoronPpm},
        accumulator:{tempC:C.risInjectionTempC,boronPpm:C.risBoronPpm},
        ris:{tempC:C.risInjectionTempC,boronPpm:C.risBoronPpm},
        letdown:{tempC:C.primaryMeanC,boronPpm:C.boronInitialPpm},
        breakLiquid:{tempC:C.primaryMeanC,boronPpm:C.boronInitialPpm},
        breakSteam:{tempC:saturationTemperatureC(C.primaryPressureBar),boronPpm:0},
        relief:{tempC:saturationTemperatureC(C.primaryPressureBar),boronPpm:0}},
      accumulatorFlowsKgS:Array(4).fill(0),accumulatorNitrogenBar:Array(4).fill(C.accumulatorPressureBar),
      rraConnected:false,rraFlowKgS:0,endState:null,endReason:"",ptOutside:false,
      coreDamageWarning:null,normalShutdownAt:null,
      boronPpm: C.boronInitialPpm,
      boronInventory: C.boronInitialPpm * C.nominalPrimaryMassKg,
      rcvTankBoronPpm: C.boronInitialPpm,
      rcvChargeKgS: C.rcvNominalM3h*CPP_NOMINAL_DENSITY/3600,
      rcvSealKgS: C.rcvSealM3h*CPP_NOMINAL_DENSITY/3600,
      rcvLetdownKgS: C.rcvLetdownM3h*CPP_NOMINAL_DENSITY/3600,
      rcvDeliveredKgS: C.rcvNominalM3h*CPP_NOMINAL_DENSITY/3600,
      rcvChargeM3h:C.rcvNominalM3h,rcvDeliveredM3h:C.rcvNominalM3h,
      rcvCapacityM3h:rcvPumpCapacityM3h(C.primaryPressureBar),rcvDemandM3h:C.rcvNominalM3h,
      pzrPistonBarS:0,pzrThermalPressureBar:C.primaryPressureBar,
      reliefLiquidKgS:0,reliefSteamKgS:0,
      rcvInjectionLitres: {dilution:0,borication:0},
      reliefKgS: 0, reliefStages: [false,false,false],reliefStageKgS:[0,0,0],
      reliefAutoArmed:[false,false,false],reliefAutoDemandAt:[null,null,null],
      reliefAutoOpeningPct:[0,0,0],reliefOpeningPct:[0,0,0],
      risMpKgS: 0, risBpKgS: 0, risPumpSpeedFraction: 0, accumulatorKgS: 0,
      risDeliveredKgS: 0,risDeliveredMpKgS:0,risDeliveredBpKgS:0,risDeliveredAccumulatorKgS:0,
      risCoolingMW: 0, risTankRemainingKg: C.risTankVolumeM3*C.risWaterDensityKgM3,
      accumulatorsKg: Array(4).fill(C.accumulatorKgPerLoop),
      breakKgS: 0,breakDensityKgM3:liquidWaterDensityKgM3(C.primaryMeanC,C.primaryPressureBar),
      breakAreaCm2: 0, breakLoop: 1, breakBranch: "froide",
      rods, g3Count: 780, g3Target: 780, rLimitPas: 186,
      loops: Array.from({length:4}, (_,i) => ({ index:i+1, flowKgS:nominalFlow,
        forcedFlowKgS:nominalFlow, naturalFlowKgS:0, forcedPrimingFraction:1,
        pumpHeatMW:C.primaryPumpHeatMWPerUnit,
        hotC:324.6, coldC:288.4, pumpStopped:false,
        pumpHeadHotBar:7, pumpHeadColdBar:7+3*(324.6-288.4)/(324.6-20),
        vesselDeltaBar:3.5, gvDeltaBar:3.5 })),
      gv: nominalGv(), totalGvMW: C.nominalPrimaryHeatMW,
      totalSteamKgS: 4 * C.nominalSteamKgSPerGV,
      totalTurbineSteamKgS: 4 * C.nominalSteamKgSPerGV,
      totalFeedKgS: 4 * C.nominalSteamKgSPerGV,
      asgDemandAt:null, asgAt: null, totalAsgKgS: 0,
      xenonTop: INITIAL_XENON32.slice(C.axialZones/2).reduce((a,b)=>a+b,0)/(C.axialZones/2),
      xenonBottom: INITIAL_XENON32.slice(0,C.axialZones/2).reduce((a,b)=>a+b,0)/(C.axialZones/2),
      iodineTop: INITIAL_IODINE32.slice(C.axialZones/2).reduce((a,b)=>a+b,0)/(C.axialZones/2),
      iodineBottom: INITIAL_IODINE32.slice(0,C.axialZones/2).reduce((a,b)=>a+b,0)/(C.axialZones/2),
      xenon32: [...INITIAL_XENON32], iodine32: [...INITIAL_IODINE32],
      axialShape32: [...INITIAL_AXIAL_SHAPE],
      axialZonePowerPctPn32: Array(C.axialZones).fill(100/C.axialZones),
      axialCoolant32: [...INITIAL_AXIAL_COOLANT], dpaxPctPn: 0,
      axialTilt: 0, axialFlux32: [...INITIAL_AXIAL_SHAPE],
      axialShape6: detectorMeans(INITIAL_AXIAL_SHAPE),
      axialZonePowerPctPn6: Array(C.axialDetectors).fill(100/C.axialDetectors),
      fluxDetectors6: detectorMeans(INITIAL_AXIAL_SHAPE), peakLinearWcm: 350,
      signals: {}, tripDemandAt: null, tripAt: null,
      risDemandAt: null, risAt: null, voltageLostAt: null,
      ejectWorthPcm: 0, withdrawalActive: false,
      rcvPipe: Array.from({length:80},(_,i)=>({at:i*0.1,
        massKg:C.rcvNominalM3h*CPP_NOMINAL_DENSITY/3600*0.1,
        boronPpm:C.boronInitialPpm,tempC:C.primaryMeanC})),
      risPipe: [], events: [], history: [], sampleAt: 0,
      previousPowerPct: 100, rawFluxRatePctS: 0, fluxRatePctS: 0,
      coreFlowFraction: 1, primaryPumpsStopped: false,
      primaryPumpStopAt:null,primaryPumpStopReason:"",
      subcoolingC: 344.79-324.6, dnbr: 1.65,
      heaterKW: C.nominalHeaterKW, sprayPct: C.nominalSprayPct,
      sprayValveM3h: 0, sprayContinuousM3h: 2*C.sprayContinuousM3hPerValve,
      sprayFlowM3h: 2*C.sprayContinuousM3hPerValve,
      sprayFlowPct: 100*2*C.sprayContinuousM3hPerValve
        /(2*C.sprayFullM3hPerValve),
      sprayFlowKgS: 2*C.sprayContinuousM3hPerValve*C.primaryDensityKgM3/3600,
      sprayDriveBar: C.sprayDriveNominalBar,
      auxiliarySprayM3h:0,auxiliarySpraySourceC:C.primaryMeanC,auxiliarySprayCoolingKW:0,
      totalSprayFlowM3h:2*C.sprayContinuousM3hPerValve,
      protectionsEnabled: true, risEnabled: true,
      lossOfVoltage: false, turbineTrip: false
    };
  }
  function make() {
    const model={
      state: initialState(),
      controls: {
        demandPct: 100, manualTurbineTargetPct: null, manualTurbineRatePctMin: 5,
        turbineLimitGraphPct: null, campaign: "debut", halfCycle: "premiere",
        rMode: "manual", rManualPas: 233, rGraphPas: 233, rManualOverride: false,
        g3GraphTarget: null, gcpCalibrationPct: 0, gvGraphFeedPct: [null,null,null,null],
        gvManualFeedPct: Array(4).fill(100*C.nominalSteamKgSPerGV/950), gvLevelSetpointPct: 55,
        gvSteamValvePct: Array(4).fill(100),
        gvSecondaryBreakAreaCm2: Array(4).fill(0),
        asgAvailable: true, asgManual:false,asgTrainEnabled:[false,false,false,false],
        gctAOpeningPressureBar: C.gctAPressureBar,
        pressureSetpointBar:155, pressureSetpointManual:false,
        pzrLevelSetpointPct:41.8, pzrLevelSetpointManual:false,
        setpointRamps:{gcta:{target:null,rate:5},pressure:{target:null,rate:5},level:{target:null,rate:5}},
        prefGraphBar:null,
        manualHeaterKW: C.nominalHeaterKW, manualSprayPct: C.nominalSprayPct,
        manualAuxiliarySprayM3h:0,allRodsTargetPas:null,
        manualReliefStages: [false,false,false],
        pressureGraphHeaterKW: null, pressureGraphSprayPct: null,
        nrefGraphPct: null,
      rcvChargeM3h: C.rcvNominalM3h, rcvChargeGraphM3h: null,
        rcvTankBoronPpm: C.boronInitialPpm,
        rcvLetdownOrifices: [true,true,false],
        rcvLetdownCloseGraph:null,
        rcvInjectionMode: "off",
        rcvInjectionGraphMode: null,
        risBoronPpm: C.risBoronPpm,risPumpMode:"auto",risSourceMode:"direct",
        rodWorthPcm: {...ROD_WORTH_PCM},
        axialRodAbsorption: {...AXIAL_ROD_ABSORPTION},
        coolantWorthPcmC: C.coolantWorthPcmC, dopplerWorthPcmC: C.dopplerWorthPcmC,
        xenonEquilibriumWorthPcm: C.xenonEquilibriumWorthPcm,
        naturalCirculationKgSPerLoop: C.naturalCirculationKgSPerLoop,
        risMpScale: 1, risBpScale: 1,
        tripLowPressureBar: C.tripLowPressureBar,
        risLowPressureBar: C.risLowPressureBar,
        tripHighFluxPct: C.tripHighFluxPct,
        fluxPrealarmPct: C.fluxPrealarmPct,
        tripFluxRatePctS: C.tripFluxRatePctS,
        mpTrainEnabled: [true,true], bpTrainEnabled: [true,true],
        breakAreaCm2: 0, breakLoop: 1, breakBranch: "froide",
        protectionsEnabled: true, risEnabled: true, protectionGraphMode: false,
        protectionGraphFluxRatePctS: null,
        fxYUngraped: 1.4, fxYGraped: 1,
        transient: "off", transientPhase: "off", transientStartS: 0,
        transientElapsedS: 0, transientPaused: false,
        transientTargetDemandPct: 100,
        timeScaleXenon: 1
      }
    };
    updateAxial(model.state,model.controls,0);
    return model;
  }

  const TRANSIENTS = Object.freeze({
    off: {label:"Aucun", duration:0},
    temperature: {label:"100 → 50 → 100 %", duration:2400},
    down: {label:"100 → 15 %", duration:2520},
    step: {label:"70 → 100 %", duration:600},
    lowstep: {label:"25 → 5 %", duration:900},
    frequency: {label:"Suivi de charge répété", duration:1200, loop:true},
    pilotage: {label:"100 → 10 % · 5 % PN/min", duration:1800}
  });
  function transientDemand(name, elapsed) {
    if (name === "temperature") {
      if (elapsed <= 300) return 100;
      if (elapsed <= 900) return 100 - (elapsed - 300) * 5 / 60;
      if (elapsed <= 1500) return 50;
      if (elapsed <= 2100) return 50 + (elapsed - 1500) * 5 / 60;
      return 100;
    }
    if (name === "down") return elapsed <= 300 ? 100 : Math.max(15, 100 - (elapsed-300)*5/60);
    if (name === "pilotage") return Math.max(10,100-5*Math.max(0,elapsed)/60);
    if (name === "step") return elapsed < 300 ? 70 : elapsed < 315 ? 70 + 2*(elapsed-300) : 100;
    if (name === "lowstep") return elapsed < 300 ? 25 : 5;
    if (name === "frequency") {
      const t = elapsed % 1200;
      return interpolation([[0,100],[90,100],[240,70],[330,70],[480,35],
        [570,35],[720,80],[810,80],[960,100],[1200,100]], t);
    }
    return null;
  }
  function turbineLoadTargetPct(model) {
    const limit=Number.isFinite(model.controls.turbineLimitGraphPct)
      ? clamp(model.controls.turbineLimitGraphPct,0,100) : 100;
    return clamp(model.state.demandPct,0,limit);
  }
  const TURBINE_MANUAL_RATES=[0.5,1,2,5,10,200,null];
  const SETPOINT_RATES=[0.25,0.5,1,2,5,10,200,null];
  const SETPOINT_CONTROLS={gcta:{key:"gctAOpeningPressureBar",min:1,max:100},
    pressure:{key:"pressureSetpointBar",min:1,max:180,manual:"pressureSetpointManual"},
    level:{key:"pzrLevelSetpointPct",min:0,max:100,manual:"pzrLevelSetpointManual"}};
  function setManualSetpoint(model,name,value) {
    const config=SETPOINT_CONTROLS[name],u=model.controls;
    if(!config||!Number.isFinite(value))return false;
    if(config.manual&&!u[config.manual])
      u[config.key]=name==="level"?model.state.nrefPct:model.state.prefBar;
    if(config.manual)u[config.manual]=true;
    const ramp=u.setpointRamps[name];ramp.target=clamp(value,config.min,config.max);
    if(ramp.rate===null)u[config.key]=ramp.target;
    return true;
  }
  function updateSetpointRamps(model,dt) {
    const u=model.controls;
    for(const [name,config] of Object.entries(SETPOINT_CONTROLS)){
      const ramp=u.setpointRamps[name];
      if(ramp.target===null||config.manual&&!u[config.manual])continue;
      const maxDelta=ramp.rate===null?Infinity:ramp.rate*dt/60;
      u[config.key]+=clamp(ramp.target-u[config.key],-maxDelta,maxDelta);
    }
  }
  function setManualTurbineDemand(model,targetPct) {
    if(isTransientActive(model)||!Number.isFinite(targetPct))return false;
    model.controls.manualTurbineTargetPct=clamp(targetPct,0,110);
    model.controls.demandPct=model.state.demandPct;
    return true;
  }
  function startTransient(model, name) {
    if (!TRANSIENTS[name]) return;
    const u=model.controls,s=model.state;
    u.manualTurbineTargetPct=null;
    u.transient=name;
    u.transientTargetDemandPct=name==="off"?100:transientDemand(name,0);
    u.transientPhase=Math.abs(s.demandPct-u.transientTargetDemandPct)>1e-9
      ? (name==="off"?"return":"approach") : (name==="off"?"off":"run");
    u.transientStartS=s.time;
    u.transientElapsedS=0;
    u.transientPaused=false;
    u.demandPct=s.demandPct;
    addEvent(s,"action",name==="off"?"Retour progressif à 100 %"
      : `Transitoire de charge : ${TRANSIENTS[name].label}`);
  }
  function isTransientActive(model) {
    return ["approach","run","return"].includes(model.controls.transientPhase);
  }
  function pauseTransient(model) {
    if(!isTransientActive(model)||model.controls.transientPaused)return;
    model.controls.transientPaused=true;
    addEvent(model.state,"action","Programme de charge en pause : PTUR maintenue");
  }
  function resumeTransient(model) {
    if(!isTransientActive(model)||!model.controls.transientPaused)return;
    model.controls.transientPaused=false;
    addEvent(model.state,"action","Reprise du programme de charge");
  }
  function interruptTransient(model) {
    if(!isTransientActive(model))return;
    const u=model.controls,s=model.state;
    u.demandPct=s.demandPct;
    u.transientPaused=false;
    u.transientPhase="interrupted";
    addEvent(s,"action",`Programme interrompu : PTUR manuelle à ${s.demandPct.toFixed(1)} %`);
  }
  function updateTurbineDemand(model,dt) {
    const s=model.state,u=model.controls;
    if(!isTransientActive(model)) {
      if(u.manualTurbineTargetPct!==null){
        const target=clamp(u.manualTurbineTargetPct,0,110),rate=u.manualTurbineRatePctMin;
        s.demandPct=rate===null?target:s.demandPct+clamp(target-s.demandPct,-rate*dt/60,rate*dt/60);
        if(Math.abs(s.demandPct-target)<1e-8)s.demandPct=target;
        u.demandPct=s.demandPct;
      }else s.demandPct=clamp(Number(u.demandPct),0,110);
      return;
    }
    if(u.transientPaused)return;
    if(u.transientPhase==="approach"||u.transientPhase==="return") {
      const error=u.transientTargetDemandPct-s.demandPct;
      s.demandPct=clamp(s.demandPct+clamp(error,-20*dt/60,20*dt/60),0,110);
      if(Math.abs(s.demandPct-u.transientTargetDemandPct)<1e-9){
        if(u.transientPhase==="return"){
          u.transientPhase="off";u.transient="off";
        }else{
          u.transientPhase="run";u.transientStartS=s.time;
          u.transientElapsedS=0;
        }
      }
    }else{
      const program=TRANSIENTS[u.transient];
      u.transientElapsedS+=dt;
      if(!program.loop&&u.transientElapsedS>=program.duration-1e-7){
        u.transientElapsedS=program.duration;
        s.demandPct=clamp(transientDemand(u.transient,program.duration),0,110);
        u.transientPhase="finished";
        addEvent(s,"action",`Programme terminé : PTUR manuelle à ${s.demandPct.toFixed(1)} %`);
      }else{
        s.demandPct=clamp(transientDemand(u.transient,u.transientElapsedS),0,110);
      }
    }
    // Préparer le retour en manuel à la valeur courante, sans saut de consigne.
    u.demandPct=s.demandPct;
  }
  function initiate(model, name, details = {}) {
    const s = model.state, u = model.controls;
    if (name === "break") {
      u.breakAreaCm2 = clamp(Number(details.areaCm2) || 0, 0, 2000);
      u.breakLoop = clamp(Math.round(Number(details.loop) || 1), 1, 4);
      u.breakBranch = details.branch === "chaude" ? "chaude" : "froide";
      s.breakAreaCm2 = u.breakAreaCm2;
      s.breakLoop = u.breakLoop;
      s.breakBranch = u.breakBranch;
      addEvent(s, "incident", `Brèche ${u.breakAreaCm2} cm² sur boucle ${u.breakLoop}, branche ${u.breakBranch}`);
    } else if (name === "secondaryBreak") {
      const index=clamp(Math.round(Number(details.gv)||1),1,4)-1;
      const area=clamp(Number(details.areaCm2)||0,0,2000);
      u.gvSecondaryBreakAreaCm2[index]=area;
      s.gv[index].secondaryBreakAreaCm2=area;
      if(area===0){
        const gv=s.gv[index];gv.secondaryBreakKgS=0;
        gv.steamKgS=gv.turbineSteamKgS+gv.dumpKgS;
        gv.waterMassRateKgS=gv.feedKgS+gv.asgKgS-gv.steamKgS;
        s.totalSteamKgS=s.gv.reduce((total,g)=>total+g.steamKgS,0);
      }
      addEvent(s,"incident",area>0
        ? `Brèche vapeur secondaire ${area} cm² sur GV ${index+1}`
        : `Brèche vapeur secondaire du GV ${index+1} isolée`);
    } else if (name === "ejection") {
      s.ejectWorthPcm = clamp(Number(details.worthPcm) || 300, 0, 800);
      addEvent(s, "incident", `Éjection d'une grappe : +${s.ejectWorthPcm} pcm (hypothèse)`);
    } else if (name === "withdrawal") {
      s.withdrawalActive = true;
      addEvent(s, "incident", "Remontée intempestive du groupe R");
    } else if (name === "voltage") {
      s.lossOfVoltage = true;
      s.voltageLostAt = s.time;
      addEvent(s, "incident", "Perte totale des alimentations électriques");
      stopPrimaryPumps(s,"Arrêt des GMPP sur perte de tension");
    } else if (name === "trip") {
      requestTrip(s, details.source === "cc-protect"
        ? "Ordre AAR du CC-PROTECT" : "Ordre manuel d'arrêt automatique");
    } else if (name === "ris") {
      requestRis(s, details.source === "cc-protect"
        ? "Ordre IS du CC-PROTECT" : "Demande manuelle d'injection de sécurité");
    } else if(name === "asg") {
      if(s.asgDemandAt===null){
        s.asgDemandAt=s.time;
        addEvent(s,"system",details.source==="cc-protect"
          ? "Ordre de démarrage ASG du CC-PROTECT" : "Ordre manuel de démarrage ASG");
      }
    }
  }
  function prepareRcvTank(model, volumeM3, boronPpm) {
    const s=model.state,u=model.controls;
    u.rcvTankBoronPpm=clamp(Number(boronPpm)||0,0,C.reaBoronPpm);
    s.rcvTankBoronPpm=rcvChargeBoronPpm(model);
    addEvent(s,"action",`CB de charge RCV réglée à ${s.rcvTankBoronPpm.toFixed(0)} ppm`);
  }
  function setRManualOverride(model, enabled) {
    const s=model.state,u=model.controls;
    u.rManualOverride=Boolean(enabled);
    u.rManualPas=s.rods.R;u.rGraphPas=s.rods.R;
    if(enabled)u.rMode="manual";
  }
  function setRcvInjection(model, mode) {
    const s=model.state,u=model.controls;
    u.rcvInjectionMode=["dilution","borication"].includes(mode)?mode:"off";
    s.rcvTankBoronPpm=rcvChargeBoronPpm(model);
    addEvent(s,"action",u.rcvInjectionMode==="off"?"Arrêt dilution/borication RCV · retour à la CB manuelle"
      :`Charge RCV : ${u.rcvInjectionMode} à ${s.rcvTankBoronPpm} ppm`);
  }
  function requestTrip(s, text) {
    if (s.tripDemandAt !== null) return;
    s.tripDemandAt = s.time;
    s.turbineTrip = true;
    addEvent(s, "protection", text);
  }
  function stopPrimaryPumps(s,text,eventType="protection") {
    if(s.primaryPumpsStopped)return false;
    s.primaryPumpsStopped=true;
    s.primaryPumpStopAt=s.time;s.primaryPumpStopReason=text;
    s.pumpHeatMW=0;s.loops.forEach(loop=>{loop.pumpHeatMW=0;});
    addEvent(s,eventType,text);
    return true;
  }
  function tripPrimaryPumps(model) {
    if(model.state.endState)return false;
    return stopPrimaryPumps(model.state,"Déclenchement manuel des 4 GMPP","action");
  }
  function requestRis(s, text) {
    if (s.risDemandAt !== null) return;
    s.risDemandAt = s.time;
    addEvent(s, "protection", text);
    requestTrip(s,"AAR : demande d'injection de sécurité");
  }

  function commandAllRods(model,targetPas) {
    const s=model.state,u=model.controls;
    if(s.tripDemandAt!==null||s.endState)return false;
    u.allRodsTargetPas=targetPas===null?null:targetPas===0?0:260;
    u.rManualPas=s.rods.R;u.rGraphPas=s.rods.R;u.g3GraphTarget=null;
    s.withdrawalActive=false;
    addEvent(s,"action",targetPas===null?"Retour des grappes à la conduite normale"
      :targetPas===0?"Descente commandée de tous les groupes à 0 pas · hors AAR"
      :"Montée commandée de tous les groupes à 260 pas · hors AAR");
    return true;
  }

  function updateRods(s, u, dt) {
    const tripped = s.tripAt !== null;
    if (tripped) {
      for (const name of ROD_NAMES) s.rods[name] = Math.max(0,
        s.rods[name] - C.rodStroke * dt / C.dropTimeS);
      return;
    }
    if(u.allRodsTargetPas!==null){
      for(const name of ["R","SA","SB","SC","SD"])
        s.rods[name]+=clamp(u.allRodsTargetPas-s.rods[name],-C.rodSpeedPasS*dt,C.rodSpeedPasS*dt);
      // Les GCP conservent leur séquence et leurs recouvrements ; les groupes
      // d'arrêt sont manœuvrés à la vitesse normale, sans chute ni ordre AAR.
      s.g3Target=u.allRodsTargetPas===0?0:780;
      s.g3Count+=clamp(s.g3Target-s.g3Count,-C.rodSpeedPasS*dt,C.rodSpeedPasS*dt);
      [s.rods.G1,s.rods.G2,s.rods.N1,s.rods.N2]=gcpPositions(s.g3Count);
      return;
    }
    if (s.withdrawalActive) {
      s.rods.R = Math.min(260, s.rods.R + 3 * dt);
    } else if (u.rMode === "graph" && !u.rManualOverride) {
      s.rods.R += clamp(clamp(Number(u.rGraphPas),0,260)-s.rods.R,
        -C.rodSpeedPasS*dt,C.rodSpeedPasS*dt);
    } else {
      s.rods.R += clamp(u.rManualPas - s.rods.R,
        -C.rodSpeedPasS*dt, C.rodSpeedPasS*dt);
    }
    s.g3Target = Number.isFinite(u.g3GraphTarget)
      ? clamp(u.g3GraphTarget,0,780) : s.g3Count;
    s.g3Count += clamp(s.g3Target - s.g3Count,
      -C.rodSpeedPasS*dt, C.rodSpeedPasS*dt);
    [s.rods.G1, s.rods.G2, s.rods.N1, s.rods.N2] = gcpPositions(s.g3Count);
  }

  function evolveAxialPoisons(s, dt, scale=1) {
    // Évolution locale I-135/Xe-135 à puissance et forme axiale imposées.
    // La moyenne de Xe, et non sa seule dissymétrie, agit aussi sur la
    // réactivité globale lors du bilan neutronique suivant.
    const scaledDt=dt*clamp(Number(scale) || 1,0.1,100);
    for(let i=0;i<C.axialZones;i++) {
      const local=clamp(s.powerPct/100*s.axialShape32[i],0,3);
      const iodineBefore=s.iodine32[i],xenonBefore=s.xenon32[i];
      s.iodine32[i]=Math.max(0,iodineBefore+IODINE_DECAY_S
        *(local-iodineBefore)*scaledDt);
      s.xenon32[i]=clamp(xenonBefore+(
        XENON_PRODUCTION_SCALE*(XENON_DECAY_S+XENON_CAPTURE_S)*iodineBefore
        -(XENON_DECAY_S+XENON_CAPTURE_S*local)*xenonBefore
      )*scaledDt,0,4);
    }
    const half=C.axialZones/2;
    s.iodineBottom=s.iodine32.slice(0,half).reduce((a,b)=>a+b,0)/half;
    s.iodineTop=s.iodine32.slice(half).reduce((a,b)=>a+b,0)/half;
    s.xenonBottom=s.xenon32.slice(0,half).reduce((a,b)=>a+b,0)/half;
    s.xenonTop=s.xenon32.slice(half).reduce((a,b)=>a+b,0)/half;
  }

  // Tableau 11 FXY(z) SPIN en DDC fourni par l'utilisateur, cotes 1 à 31.
  // Colonnes G1, R, R+G1, G1+G2, R+G1+G2, N1, autres.
  // Pour nos 32 cellules, la cote 0 reprend la cote 1 (prolongement au pied).
  const SPIN_FXY32 = Object.freeze(Array.from({length:32},(_,z)=>Object.freeze(
    z<=18 ? [1.597,1.632,1.688,1.667,1.675,2.021,2.500]
      : z===19 ? [1.583,1.596,1.650,1.706,1.704,1.965,2.500]
      : z===20 ? [1.570,1.559,1.612,1.746,1.732,1.908,2.500]
      : [1.557,1.523,1.574,1.785,1.760,1.852,z===31?2.200:2.500]
  )));
  const FXY_BANKS = ["R","G1","G2","N1","N2"];
  function spinFxy32(rods, ungapped=1.4, tableScale=1, thermalRelative=1) {
    // La position sélectionne la configuration locale. La cellule traversée
    // par la pointe d'une grappe interpole les configurations voisines.
    const powerCorrection=1+0.3*(1-clamp(thermalRelative,0,1));
    return SPIN_FXY32.map((row,z)=>{
      let cases=[{mask:0,weight:1}];
      FXY_BANKS.forEach((name,bit)=>{
        const coverage=axialInsertionFraction(rods[name],z);
        cases=cases.flatMap(item=>{
          const next=[];
          if(coverage<1)next.push({mask:item.mask,weight:item.weight*(1-coverage)});
          if(coverage>0)next.push({mask:item.mask|(1<<bit),weight:item.weight*coverage});
          return next;
        });
      });
      const selected=cases.reduce((sum,{mask,weight})=>{
        const column=mask&16 ? 6 : mask&8 ? 5
          : ({1:1,2:0,3:2,6:3,7:4})[mask];
        const value=mask===0 ? ungapped : row[column===undefined?6:column]*tableScale;
        return sum+weight*value;
      },0);
      const shutdownCoverage=Math.max(...["SA","SB","SC","SD"]
        .map(name=>axialInsertionFraction(rods[name],z)));
      return lerp(selected,row[6]*tableScale,shutdownCoverage)*powerCorrection;
    });
  }
  function coreProtectionProfile(s,u) {
    const relative=s.thermalPowerMW/C.nominalThermalMW;
    const fxy32=spinFxy32(s.rods,u.fxYUngraped,u.fxYGraped,relative);
    const q32=s.axialShape32.map((shape,i)=>shape*fxy32[i]);
    const fDeltaH=q32.reduce((sum,value)=>sum+value,0)/C.axialZones;
    const linearWcm32=q32.map(value=>C.nominalAverageLinearWcm*relative*value);
    // Intégrale d'enthalpie du canal chaud, FHFR=FGFR=1 faute de tables
    // de mélange/redistribution. Enthalpies approchées à Cp primaire constant.
    const inletEnthalpyKJkg=C.primaryCpJkgK*s.coldC/1000;
    const deltaEnthalpyKJkg=C.primaryCpJkgK*(s.hotC-s.coldC)/1000;
    let integral=0;
    const hotChannelTemp32=s.axialShape32.map(shape=>{
      const midpoint=integral+shape/(2*C.axialZones);
      integral+=shape/C.axialZones;
      return s.coldC+(s.hotC-s.coldC)*fDeltaH*midpoint;
    });
    const satTempC=saturationTemperatureC(s.pressureBar);
    const pressureFactor=Math.sqrt(clamp(s.pressureBar,0,200)/C.primaryPressureBar);
    const flowFactor=Math.sqrt(Math.max(0,s.coreFlowFraction));
    // Proxy de flux critique : pression, débit et sous-refroidissement LOCAL.
    // Ce n'est pas WRB1. La normalisation fixe nominale sera appliquée ensuite.
    const dnbrRaw32=hotChannelTemp32.map((temp,i)=>pressureFactor*flowFactor
      *Math.max(0.1,satTempC-temp+5)/Math.max(30,linearWcm32[i]));
    return {fxy32,linearWcm32,fDeltaH,fq:Math.max(...q32),hotChannelTemp32,
      hotChannelEnthalpy32:hotChannelTemp32.map(temp=>temp*C.primaryCpJkgK/1000),
      coreOutletEnthalpyKJkg:inletEnthalpyKJkg+deltaEnthalpyKJkg/(1-C.coreBypassFraction),
      hotChannelOutletEnthalpyKJkg:inletEnthalpyKJkg+deltaEnthalpyKJkg*fDeltaH,
      subcoolingC:Math.max(0,satTempC-s.hotC),dnbrRaw32};
  }
  const NOMINAL_DNBR_RAW=Math.min(...coreProtectionProfile({
    rods:{R:233,G1:260,G2:260,N1:260,N2:260,SA:260,SB:260,SC:260,SD:260},
    axialShape32:INITIAL_AXIAL_SHAPE,thermalPowerMW:C.nominalThermalMW,
    coldC:288.4,hotC:324.6,pressureBar:C.primaryPressureBar,coreFlowFraction:1
  },{fxYUngraped:1.4,fxYGraped:1}).dnbrRaw32);

  function updateAxial(s, u, dt) {
    // 32 mailles physiques : la puissance globale reste déterminée par la
    // cinétique ponctuelle ; le mode axial répartit cette puissance sans
    // rajouter une seconde efficacité des grappes à la réactivité globale.
    evolveAxialPoisons(s,dt,u.timeScaleXenon);
    const saturationC=saturationTemperatureC(s.pressureBar);
    const coolant=axialCoolantTemperatures(s.coldC,s.sensibleCoreMW??s.coreTransferMW,
      s.coreFlowFraction,s.axialShape32).map(t=>Math.min(t,saturationC));
    const temperatureOffset=coolant.map((temp,i)=>s.coreFlowFraction<0.2
      ? 0 : clamp(temp-INITIAL_AXIAL_COOLANT[i],-30,30));
    s.axialShape32=solveAxialShape(s.rods,s.xenon32,temperatureOffset,
      s.axialShape32,u.axialRodAbsorption,C.axialXenonAbsorption
        *u.xenonEquilibriumWorthPcm/C.xenonEquilibriumWorthPcm);
    s.axialCoolant32=axialCoolantTemperatures(s.coldC,s.sensibleCoreMW??s.coreTransferMW,
      s.coreFlowFraction,s.axialShape32).map(t=>Math.min(t,saturationC));
    s.axialZonePowerPctPn32=s.axialShape32.map(value=>s.powerPct*value/C.axialZones);
    s.axialShape6=detectorMeans(s.axialShape32);
    s.axialZonePowerPctPn6=s.axialShape6.map(value=>s.powerPct*value/C.axialDetectors);
    s.dpaxPctPn=s.axialZonePowerPctPn6.slice(3).reduce((a,b)=>a+b,0)
      -s.axialZonePowerPctPn6.slice(0,3).reduce((a,b)=>a+b,0);
    s.dpaxRightExceeded=isDpaxRightExceeded(s);
    s.axialTilt=s.powerPct>1e-9 ? -s.dpaxPctPn/s.powerPct : 0;
    s.axialFlux32=[...s.axialShape32];
    // Mesures idéales des six sections : une réponse instrumentale RPN calibrée
    // pourra être introduite plus tard sans confondre mesure et état du cœur.
    s.fluxDetectors6=[...s.axialShape6];
    const protection=coreProtectionProfile(s,u);
    Object.assign(s,protection);
    s.peakLinearWcm=Math.max(...s.linearWcm32);
    s.dnbr32=s.dnbrRaw32.map(value=>clamp(1.65*value/NOMINAL_DNBR_RAW,0,10));
    s.dnbr=Math.min(...s.dnbr32);
  }

  function updateProtection(s, u, dt) {
    s.rawFluxRatePctS = (s.powerPct-s.previousPowerPct)/dt;
    s.fluxRatePctS = u.protectionGraphMode
      ? (Number.isFinite(u.protectionGraphFluxRatePctS) ? u.protectionGraphFluxRatePctS : 0)
      : s.rawFluxRatePctS;
    s.previousPowerPct = s.powerPct;
    s.signals = {
      lowPressure: s.pressureBar < u.tripLowPressureBar,
      highFluxAlarm: s.powerPct >= u.fluxPrealarmPct,
      highFluxTrip: s.powerPct >= u.tripHighFluxPct,
      highLinearPower: s.peakLinearWcm > C.tripLinearWcm,
      rapidFluxRise: s.fluxRatePctS >= u.tripFluxRatePctS,
      rapidFluxFall: s.fluxRatePctS <= -u.tripFluxRatePctS,
      voltageLoss: s.lossOfVoltage,
      risLowPressure: s.pressureBar < u.risLowPressureBar,
      rBelowLimit: s.tripAt===null && s.rods.R < s.rLimitPas - 0.5
    };
    s.protectionsEnabled = Boolean(u.protectionsEnabled);
    s.risEnabled = Boolean(u.risEnabled);
    if (s.protectionsEnabled && !u.protectionGraphMode) {
      const reason = s.signals.voltageLoss ? "Manque de tension"
        : s.signals.lowPressure ? "Basse pression primaire"
        : s.signals.highFluxTrip ? "Haut flux nucléaire"
        : s.signals.highLinearPower ? "PLIN supérieure à 435 W/cm"
        : s.signals.rapidFluxRise ? "Variation rapide positive du flux"
        : s.signals.rapidFluxFall ? "Variation rapide négative du flux" : null;
      if (reason) requestTrip(s, `AAR : ${reason}`);
    }
    if (s.risEnabled && !u.protectionGraphMode && s.signals.risLowPressure)
      requestRis(s, "IS : basse pression primaire");
    if (s.tripDemandAt !== null && s.tripAt === null
        && s.time-s.tripDemandAt >= C.tripActuationS) {
      s.tripAt = s.time;
      addEvent(s, "protection", "Chute des groupes R, GCP et SA à SD");
    }
    if (s.risDemandAt !== null && s.risAt === null
        && s.time-s.risDemandAt >= C.risActuationS) {
      s.risAt = s.time;
      addEvent(s, "protection", "RIS demandé : attente de la capacité des pompes et du transit");
    }
  }

  function risPumpsReady(s,u) {
    const sourceReady = (u.risSourceMode==="recirculation"?s.sumpKg:s.risTankRemainingKg) > 0;
    const voltageReady = !s.lossOfVoltage || s.time-s.voltageLostAt >= C.dieselStartS;
    return s.risEnabled && u.risPumpMode!=="off"
      && (u.risPumpMode==="on"||s.risAt !== null) && sourceReady && voltageReady;
  }
  function risPumpCapacity(s,u,p=s.pressureBar) {
    // Lois d'affinité Q∝N, H∝N² appliquées aux courbes d'étude existantes.
    // À pleine vitesse les courbes MP/BP ne changent pas. Une pompe BP
    // peut tourner vanne de non-retour fermée au-dessus de sa HMT.
    const speed=risPumpsReady(s,u)?s.risPumpSpeedFraction:0;
    const equivalentPressure=speed>0?p/(speed*speed):Infinity;
    const mpOne=speed*Math.max(0,120-equivalentPressure);
    const bpOne=speed*9*Math.max(0,40-equivalentPressure);
    let mp=mpOne*u.mpTrainEnabled.filter(Boolean).length*u.risMpScale;
    let bp=bpOne*u.bpTrainEnabled.filter(Boolean).length*u.risBpScale;
    const pumped = Math.min(mp+bp,
      (u.risSourceMode==="recirculation"?s.sumpKg:s.risTankRemainingKg)/0.1);
    if (pumped < mp+bp) {
      const ratio = pumped/(mp+bp);mp*=ratio;bp*=ratio;
    }
    return {mp,bp};
  }
  function risPumpFlows(s,u,p=s.pressureBar) {
    const capacity=risPumpCapacity(s,u,p);
    s.risMpKgS=capacity.mp;s.risBpKgS=capacity.bp;
  }
  function pumpToPipe(pipe, at, massKg, boronPpm, metadata = {}) {
    if (massKg > 0) {
      pipe.push({ at, massKg, boronPpm, ...metadata });
      pipe.sort((a,b) => a.at-b.at);
    }
  }
  function deliverPipe(pipe, time, injectionLitres = null, maxMassKg=Infinity, sourceLimits=null, preview=false) {
    let massKg=0, boron=0,energyJ=0;
    const sources={mp:0,bp:0,accumulator:0};
    const properties=Object.fromEntries(Object.keys(sources).map(key=>[key,{massKg:0,boron:0,energyJ:0}]));
    let index=0;
    while (index<pipe.length && pipe[index].at <= time+1e-9 && massKg<maxMassKg-1e-12) {
      const pending=pipe[index],limit=sourceLimits?.[pending.source]??Infinity;
      const amount=Math.min(pending.massKg,maxMassKg-massKg,Math.max(0,limit-(sources[pending.source]??0)));
      // Consommer aussi les reliquats positifs de la vidange d'un accumulateur.
      // Les ignorer laisse des milliers de parcelles quasi nulles dans la ligne.
      if(amount<=0){index++;continue;}
      const fraction=amount/pending.massKg;
      const parcel={...pending,massKg:amount,litres:(pending.litres??0)*fraction};
      if(!preview){
        if(fraction>=1-1e-12)pipe.splice(index,1);
        else {pending.massKg-=amount;if(pending.litres!==undefined)pending.litres-=parcel.litres;index++;}
      }else index++;
      massKg += parcel.massKg;
      boron += parcel.massKg*parcel.boronPpm;
      energyJ += parcel.massKg*C.primaryCpJkgK*(parcel.tempC??C.risInjectionTempC);
      if(Object.hasOwn(sources,parcel.source)){
        sources[parcel.source]+=parcel.massKg;
        const stream=properties[parcel.source];stream.massKg+=parcel.massKg;
        stream.boron+=parcel.massKg*parcel.boronPpm;
        stream.energyJ+=parcel.massKg*C.primaryCpJkgK*(parcel.tempC??C.risInjectionTempC);
      }
      if(!preview && injectionLitres && Object.hasOwn(injectionLitres,parcel.mode))
        injectionLitres[parcel.mode]+=parcel.litres;
    }
    if(!preview&&pipe.length>128){
      // Les parcelles déjà arrivées et consécutives de même composition peuvent
      // partager un stock en attente. Garder l'ordre des fronts T/CB et les
      // dates futures ; conserver les reliquats, même infinitésimaux.
      let kept=0;
      for(const parcel of pipe){
        const previous=pipe[kept-1];
        if(previous&&previous.at<=time+1e-9&&parcel.at<=time+1e-9
          &&previous.source===parcel.source&&previous.tempC===parcel.tempC
          &&previous.boronPpm===parcel.boronPpm&&previous.mode===parcel.mode){
          previous.massKg+=parcel.massKg;
          if(parcel.litres!==undefined)previous.litres=(previous.litres??0)+parcel.litres;
        }else pipe[kept++]=parcel;
      }
      pipe.length=kept;
    }
    return { massKg, boron,energyJ,sources,properties };
  }

  function primaryBreakHydraulics(s,p=s.pressureBar,dt=0) {
    const density=liquidWaterDensityKgM3(s.tavgC,p);
    const branch=CPP_GEOMETRY.find(g=>g.id===(s.breakBranch==='chaude'?'hot':'cold'));
    // La section est située au milieu de la branche schématique. Après
    // vidange du PZR, le niveau commun fournit la charge gravitaire locale.
    const elevationM=(branch.bottom+branch.top)/2;
    const inv=s.inventory??cppInventory(Math.max(0,s.primaryMassKg-s.vaporMassKg),s.tavgC,p);
    const headM=Math.max(0,inv.levelM-elevationM);
    const hydrostaticBar=density*9.80665*headM/1e5;
    const wetFraction=clamp((inv.loopLevelM-branch.bottom)/(branch.top-branch.bottom),0,1);
    const localPressureBar=p+hydrostaticBar;
    const fluxOrifice=.68*Math.sqrt(2*density*Math.max(0,localPressureBar-1)*1e5);
    // La borne de détente diphasique ne concerne pas un rejet liquide froid.
    // Transition d'étude sur 5 °C au-dessus de Tsat de l'enceinte à 1 bar.
    const flashingFraction=clamp((s.tavgC-saturationTemperatureC(1))/5,0,1);
    const fluxLimit=C.breakCriticalFluxKgM2S*Math.sqrt(Math.max(0,localPressureBar)/155);
    const liquidFlux=lerp(fluxOrifice,Math.min(fluxOrifice,fluxLimit),flashingFraction);
    // Une ouverture découverte rejette la vapeur réellement présente,
    // sans continuer à prélever un liquide situé au-dessous de la brèche.
    const vaporFlow=s.vaporMassKg>0
      ? secondaryBreakFlowKgS(s.breakAreaCm2,p,saturationTemperatureC(p)) : 0;
    const wetFlow=s.breakAreaCm2*1e-4*liquidFlux*wetFraction;
    const steamDensity=saturatedWaterDensities(saturationTemperatureC(p)).vapor;
    const vaporVolume=s.vaporMassKg/Math.max(.1,steamDensity);
    const liquidVolume=Math.max(1,s.primaryMassKg-s.vaporMassKg)/density;
    const wetSteamFraction=clamp(vaporVolume/(liquidVolume+vaporVolume),0,1)
      *(s.breakBranch==='chaude'?.7:.15);
    const liquidKgS=wetFlow*(1-wetSteamFraction);
    const steamDemand=wetFlow*wetSteamFraction+(1-wetFraction)*vaporFlow;
    // Une brèche découverte ne peut consommer davantage de vapeur que le
    // stock disponible pendant ce pas. Le liquide reste compté séparément.
    const steamKgS=dt>0?Math.min(steamDemand,s.vaporMassKg/dt):steamDemand;
    const flowKgS=liquidKgS+steamKgS;
    return {flowKgS,liquidKgS,steamKgS,steamFraction:flowKgS>0?steamKgS/flowKgS:0,density,
      localPressureBar,hydrostaticBar,elevationM,wetFraction};
  }
  function breakFlowKgS(s,p=s.pressureBar,dt=0) {
    return primaryBreakHydraulics(s,p,dt).flowKgS;
  }
  function risAdmissionLimits(s,u,p,dt) {
    const pumps=risPumpCapacity(s,u,p);
    const accumulator=s.risEnabled&&s.risDemandAt!==null
      ?s.accumulatorsKg.reduce((q,m)=>q+accumulatorFlowKgS(p,Math.max(1e-8,m)).flowKgS,0):0;
    return {mp:pumps.mp*dt,bp:pumps.bp*dt,accumulator:accumulator*dt};
  }
  function primaryHydraulicPressure(model,dt,coreTransferMW) {
    const s=model.state,u=model.controls;
    // Résoudre la contre-pression et les admissions ensemble dès que le
    // rejet est sous-refroidi, y compris pendant le remplissage du PZR.
    // Un seuil sur le volume libre ferait basculer brutalement entre deux
    // réponses hydrauliques. Le transit des
    // parcelles conserve T/CB, mais ne retarde pas la réponse hydraulique de 4 s.
    if(s.breakAreaCm2<=0||s.vaporMassKg>1
      ||s.tavgC>=saturationTemperatureC(s.pressureBar)-1)return s.pressureBar;
    const before={massKg:s.primaryMassKg,vaporKg:s.vaporMassKg,tempC:s.tavgC,pressureBar:s.pressureBar};
    const oldEnergy=s.primaryMassKg*C.primaryCpJkgK*s.tavgC+s.vaporEnergyJ;
    const letdown=rcvLetdownM3h(model)*liquidWaterDensityKgM3(s.tavgC,s.pressureBar)/3600;
    const pzrHeatMW=(s.heaterKW-C.pzrPassiveTransferKW)/1000;
    const residual=p=>{
      const ris=deliverPipe(s.risPipe,s.time,null,Infinity,risAdmissionLimits(s,u,p,dt),true);
      const charge=deliverPipe(s.rcvPipe,s.time,null,
        rcvPumpCapacityM3h(p)*liquidWaterDensityKgM3(s.tavgC,p)/3600*dt,null,true);
      const out=(breakFlowKgS(s,p,dt)+letdown+s.reliefKgS)*dt;
      const mass=s.primaryMassKg+ris.massKg+charge.massKg-out;
      const energy=oldEnergy+(coreTransferMW+s.pumpHeatMW-s.totalGvMW)*1e6*dt
        +ris.energyJ+charge.energyJ-out*C.primaryCpJkgK*s.tavgC;
      return advancePrimaryPressure(before,mass,energy,pzrHeatMW,s.reliefSteamKgS,
        s.pzrThermalPressureBar,s.pzrLevelPct,dt,p).volumeResidualM3;
    };
    let lo=1,hi=C.primaryPressureMaxBar,p=clamp(s.pressureBar,lo,hi);
    if(residual(lo)<=0)return lo;
    if(residual(hi)>=0)return hi;
    for(let i=0;i<24;i++){
      const value=residual(p);
      if(Math.abs(value)<1e-8)return p;
      if(value>0)lo=p;else hi=p;
      if(hi-lo<1e-5)break;
      const probe=clamp(p+(p+.01<hi?.01:-.01),lo,hi);
      const slope=probe!==p?(residual(probe)-value)/(probe-p):0;
      const next=slope<0?p-value/slope:NaN;
      p=Number.isFinite(next)&&next>lo&&next<hi?next:(lo+hi)/2;
    }
    return (lo+hi)/2;
  }

  function deliveredProperties(parcel, fallback) {
    return parcel.massKg>0?{tempC:parcel.energyJ/(parcel.massKg*C.primaryCpJkgK),
      boronPpm:parcel.boron/parcel.massKg}:{...fallback};
  }
  function coolRisSump(s,dt) {
    // Enveloppe pédagogique EAS : enlever explicitement la chaleur nécessaire
    // au maintien sous 90 °C, sans retirer de masse ou de bore du puisard.
    if(s.sumpKg<=1e-9){s.sumpKg=0;s.sumpBoron=0;s.sumpEnergyJ=0;s.sumpTempC=20;return;}
    const ceiling=s.sumpKg*C.primaryCpJkgK*C.easSumpMaxTempC;
    const removed=Math.max(0,s.sumpEnergyJ-ceiling);
    s.sumpEnergyJ=Math.max(0,s.sumpEnergyJ-removed);
    s.easCoolingMW+=removed/dt/1e6;
    s.sumpTempC=s.sumpEnergyJ/(s.sumpKg*C.primaryCpJkgK);
    s.sumpBoronPpm=Math.max(0,s.sumpBoron/s.sumpKg);
  }
  function updateRelief(s,u,dt) {
    for(let i=0;i<3;i++){
      const previous=s.reliefAutoArmed[i];
      if(s.pressureBar>=C.reliefOpenBar[i])s.reliefAutoArmed[i]=true;
      else if(s.pressureBar<=C.reliefCloseBar[i])s.reliefAutoArmed[i]=false;
      if(s.reliefAutoArmed[i]!==previous){
        s.reliefAutoDemandAt[i]=s.time;
        addEvent(s,"system",`Soupape PZR étage ${i+1} : ${s.reliefAutoArmed[i]?"ouverture":"fermeture"} automatique à ${s.pressureBar.toFixed(1)} bar`);
      }
      if(s.reliefAutoDemandAt[i]!==null&&s.time-s.reliefAutoDemandAt[i]+1e-9>=C.reliefDelayS){
        const target=s.reliefAutoArmed[i]?100:0;
        s.reliefAutoOpeningPct[i]+=clamp(target-s.reliefAutoOpeningPct[i],
          -100*dt/C.reliefStrokeS,100*dt/C.reliefStrokeS);
      }
      // Même organe : la commande manuelle et l'automatique ne doublent pas le débit.
      s.reliefOpeningPct[i]=u.manualReliefStages[i]?100:s.reliefAutoOpeningPct[i];
      s.reliefStages[i]=s.reliefOpeningPct[i]>1e-9;
      s.reliefStageKgS[i]=50*Math.sqrt(Math.max(0,s.pressureBar)/155)*s.reliefOpeningPct[i]/100;
    }
    s.reliefKgS=s.reliefStageKgS.reduce((sum,q)=>sum+q,0);
  }

  // Orifice vapeur vers l'atmosphère : approximation gaz parfait isentropique,
  // débit étranglé ou sous-critique. Cd et gamma sont des paramètres d'étude,
  // sans prétendre représenter une conduite réelle ou sa détente diphasique.
  function secondaryBreakFlowKgS(areaCm2,pressureBar,tempC) {
    if(!(areaCm2>0)||!(pressureBar>1))return 0;
    const cd=0.7,gamma=1.3,rSteam=461.5;
    const ratio=1/pressureBar,critical=Math.pow(2/(gamma+1),gamma/(gamma-1));
    const fluxFactor=ratio<=critical
      ? Math.sqrt(gamma)*Math.pow(2/(gamma+1),(gamma+1)/(2*(gamma-1)))
      : Math.sqrt(Math.max(0,2*gamma/(gamma-1)
        *(Math.pow(ratio,2/gamma)-Math.pow(ratio,(gamma+1)/gamma))));
    return cd*areaCm2*1e-4*pressureBar*1e5
      /Math.sqrt(rSteam*(Math.max(20,tempC)+273.15))*fluxFactor;
  }

  function updateGv(s, u, dt) {
    const nominal = C.nominalSteamKgSPerGV;
    if(u.asgAvailable && s.asgAt===null && s.asgDemandAt!==null
        && s.time-s.asgDemandAt>=C.asgStartDelayS) {
      s.asgAt=s.time;
      s.gv.forEach(g=>{g.asgRunning=true;});
      addEvent(s,"system","ASG démarrée sur ordre · arrêt au-dessus de 90 % GE, reprise sous 10 % GE en automatique");
    }
    const totalTarget = s.turbineTrip ? 0 : turbineLoadTargetPct({state:s,controls:u});
    if(u.manualTurbineTargetPct!==null&&u.manualTurbineRatePctMin===null
      &&!["approach","run","return"].includes(u.transientPhase))s.turbinePct=totalTarget;
    else s.turbinePct += clamp(totalTarget-s.turbinePct,-4*dt,4*dt);
    // Le limiteur turbine répartit le débit demandé entre les quatre GV.
    // Une pression GV élevée augmente le débit disponible, pas la consigne réseau.
    const availableSteam=s.gv.map(gv=>{
      const valveTarget=clamp(u.gvSteamValvePct[gv.index-1],0,100);
      gv.steamValvePct+=clamp(valveTarget-gv.steamValvePct,
        -C.steamValveStrokePctPerS*dt,C.steamValveStrokePctPerS*dt);
      const pressureFactor=Math.sqrt(clamp(gv.pressureBar/C.steamPressureBar,0.05,1.5));
      return nominal*(s.turbinePct/100)*pressureFactor*gv.steamValvePct/100;
    });
    const availableTotal=availableSteam.reduce((sum,flow)=>sum+flow,0);
    const turbineLimit=4*nominal*s.turbinePct/100;
    const limiter=availableTotal>turbineLimit&&availableTotal>0
      ? turbineLimit/availableTotal : 1;
    let sumHeat=0, sumSteam=0, sumTurbineSteam=0, sumFeed=0, sumAsg=0;
    for (const gv of s.gv) {
      const oldWaterKg=gv.waterKg,oldTempC=gv.tempC;
      Object.assign(gv,gvLevels(gv.waterKg));
      const flowFraction = s.loops[gv.index-1].flowKgS/(C.nominalPrimaryFlowKgS/4);
      const levelFactor = clamp(gv.waterKg/C.gvNominalWaterKg, 0, 1.1);
      gv.heatMW = Math.max(0, C.gvConductanceMWCPerUnit
        * Math.max(0,s.tavgC-gv.tempC)*flowFraction*levelFactor);
      gv.turbineSteamKgS=availableSteam[gv.index-1]*limiter;
      const gctASetpoint=clamp(Number(u.gctAOpeningPressureBar),1,100);
      // Conserver la précision de l'écrêtage lors d'un refroidissement à basse pression.
      const gctABand=C.gctABandBar*Math.min(1,gctASetpoint/C.gctAPressureBar);
      const gctATarget = clamp(100*(gv.pressureBar-gctASetpoint)/gctABand, 0, 100);
      gv.gctAValvePct += clamp(gctATarget-gv.gctAValvePct,
        -C.gctAStrokePctPerS*dt, C.gctAStrokePctPerS*dt);
      gv.dumpKgS = C.gctAFullKgSPerGV*gv.gctAValvePct/100
        *Math.sqrt(gv.pressureBar/C.gctAPressureBar);
      const graphFeed=u.gvGraphFeedPct[gv.index-1];
      let feedTarget=Number.isFinite(graphFeed)
        ? clamp(graphFeed,0,100)*9.5
        : clamp(u.gvManualFeedPct[gv.index-1],0,100)*9.5;
      if (s.lossOfVoltage||s.tripAt!==null) feedTarget = 0;
      gv.feedKgS += (feedTarget-gv.feedKgS)*clamp(dt/(s.tripAt!==null?1:8),0,1);
      if(feedTarget===0&&gv.feedKgS<0.01)gv.feedKgS=0;
      gv.feedValvePct = 100*gv.feedKgS/950;
      // Coupure sur haut niveau commune à l'automatique et au manuel.
      // Ne plus admettre d'eau ni entretenir une queue de débit sur un GV plein.
      if(gv.levelPct>90+1e-9){
        gv.asgRunning=false;
        u.asgTrainEnabled[gv.index-1]=false;
        gv.asgKgS=0;
      }else if(!u.asgManual&&s.asgAt!==null&&gv.levelPct<10-1e-9){
        gv.asgRunning=true;
      }
      const asgRunning=u.asgManual?u.asgTrainEnabled[gv.index-1]:gv.asgRunning;
      // MPS secourues par diesel ; TPS autonomes. Aucun effet du bouton CC-RÉGUL.
      const asgPowerReady=gv.asgType==="TPS"||!s.lossOfVoltage
        ||s.time-s.voltageLostAt>=C.dieselStartS;
      const asgTarget=u.asgAvailable && asgRunning && asgPowerReady
        && (u.asgManual||s.asgAt!==null) ? asgFlowKgS(gv.pressureBar) : 0;
      gv.asgKgS+=(asgTarget-gv.asgKgS)*clamp(dt/2,0,1);
      if(asgTarget===0&&gv.asgKgS<0.01)gv.asgKgS=0;
      // La sortie vapeur est limitée par l'eau réellement disponible durant
      // ce pas, y compris les alimentations arrivées ; pas de vapeur fictive à sec.
      gv.secondaryBreakAreaCm2=clamp(u.gvSecondaryBreakAreaCm2[gv.index-1],0,2000);
      gv.secondaryBreakKgS=secondaryBreakFlowKgS(gv.secondaryBreakAreaCm2,gv.pressureBar,oldTempC);
      const requestedSteam=gv.turbineSteamKgS+gv.dumpKgS+gv.secondaryBreakKgS;
      const availableWaterKg=oldWaterKg+(gv.feedKgS+gv.asgKgS)*dt;
      gv.steamLatentJkg=gvLatentHeatJkg(gv.pressureBar);
      const oldEnergyJ=gvThermalCapacityJk(oldWaterKg)*oldTempC;
      const incomingJ=(gv.feedKgS*C.secondaryCpJkgK*C.areFeedTempC
        +gv.asgKgS*C.secondaryCpJkgK*C.asgFeedTempC)*dt;
      // Ne pas évaporer davantage que l'inventaire et l'énergie disponibles.
      // La borne à 20 °C n'ajoute ainsi aucune chaleur pour alimenter une fuite.
      const evaporationBudgetJ=Math.max(0,oldEnergyJ+gv.heatMW*1e6*dt+incomingJ
        -gvThermalCapacityJk(availableWaterKg)*20);
      const maxSteamEnergyKg=evaporationBudgetJ
        /(C.secondaryCpJkgK*Math.max(0,oldTempC-20)+gv.steamLatentJkg);
      const steamScale=requestedSteam>0
        ? Math.min(1,availableWaterKg/(requestedSteam*dt),maxSteamEnergyKg/(requestedSteam*dt)) : 1;
      gv.turbineSteamKgS*=steamScale;gv.dumpKgS*=steamScale;gv.secondaryBreakKgS*=steamScale;
      // Mesure vapeur du GV, également utilisée par l'anticipation ARE.
      gv.steamKgS=gv.turbineSteamKgS+gv.dumpKgS+gv.secondaryBreakKgS;
      gv.secondaryBreakReleasedKg+=gv.secondaryBreakKgS*dt;
      gv.secondaryBreakEnergyJ+=gv.secondaryBreakKgS
        *(C.secondaryCpJkgK*oldTempC+gv.steamLatentJkg)*dt;
      gv.asgCoolingMW=gv.asgKgS*C.secondaryCpJkgK
        *(oldTempC-C.asgFeedTempC)/1e6;
      gv.areCoolingMW=gv.feedKgS*C.secondaryCpJkgK*(oldTempC-C.areFeedTempC)/1e6;
      gv.waterKg = Math.max(0,availableWaterKg-gv.steamKgS*dt);
      gv.waterMassRateKgS=gv.feedKgS+gv.asgKgS-gv.steamKgS;
      Object.assign(gv, gvLevels(gv.waterKg));
      gv.thermalCapacityJk=gvThermalCapacityJk(gv.waterKg);
      // U = (M_eau*Cp + C_métal)*T. La vapeur emporte Cp*T + Lv,
      // ARE et ASG apportent Cp*T_alimentation. La même chaleur primaire–GV
      // est retirée au primaire et ajoutée ici, une seule fois.
      const outgoingJ=gv.steamKgS*(C.secondaryCpJkgK*oldTempC+gv.steamLatentJkg)*dt;
      const energyJ=oldEnergyJ+gv.heatMW*1e6*dt+incomingJ-outgoingJ;
      gv.tempC = clamp(energyJ/gv.thermalCapacityJk,20,330);
      gv.thermalEnergyJ=gv.thermalCapacityJk*gv.tempC;
      gv.pressureBar = Math.max(gv.secondaryBreakAreaCm2>0?1:0,saturationPressureBar(gv.tempC));
      sumHeat += gv.heatMW;
      sumSteam += gv.steamKgS;
      sumTurbineSteam += gv.turbineSteamKgS;
      sumAsg += gv.asgKgS;
      sumFeed += gv.feedKgS+gv.asgKgS;
    }
    s.totalGvMW=sumHeat; s.totalSteamKgS=sumSteam; s.totalFeedKgS=sumFeed;
    s.totalTurbineSteamKgS=sumTurbineSteam;
    s.totalAsgKgS=sumAsg;
    s.electricMW=Math.min(C.nominalElectricMW,
      C.nominalElectricMW*sumTurbineSteam/(4*nominal));
  }

  // Ordre stable des mesures supplémentaires : ne jamais réordonner une version.
  // Les anciens points restent lisibles ; une mesure absente n'est pas inventée.
  const HISTORY_PATHS=[
    'demandPct','turbinePct','trefC','nrefPct','fuelC','lidC','subcoolingC',
    'coreFlowKgS','coreFlowFraction','risCoreKgS','totalGvMW','heaterKW','sprayPct',
    'sprayFlowM3h','auxiliarySprayM3h','totalSprayFlowM3h','sprayDriveBar',
    'rcvChargeM3h','rcvDeliveredM3h','rcvDemandM3h','rcvCapacityM3h','rcvTankBoronPpm',
    'pzrPistonBarS','pzrThermalPressureBar','reliefSteamKgS','reliefLiquidKgS',
    'xenonWorthPcm','xenonTop','xenonBottom','iodineTop','iodineBottom',
    'reactivityParts.rod','reactivityParts.boron','reactivityParts.temp','reactivityParts.doppler',
    'reactivityParts.xenon','reactivityParts.coreReference','g3Target','rLimitPas',
    'risTankRemainingKg','sumpKg','sumpTempC','sumpBoronPpm','easCoolingMW','risCoolingMW',
    'coveragePct','primaryEnergyJ','vaporEnergyJ','primaryMassRateKgS','phaseChangeKgS',
    'rraFlowKgS','lossOfVoltage',
    ...['SB','SC','SD'].map(n=>`rods.${n}`),
    ...Array.from({length:4},(_,i)=>['flowKgS','forcedFlowKgS','naturalFlowKgS','hotC','coldC',
      'pumpHeatMW','pumpHeadColdBar','vesselDeltaBar','gvDeltaBar','primingFraction']
      .map(k=>`loops.${i}.${k}`)).flat(),
    ...Array.from({length:4},(_,i)=>['waterKg','levelWidePct','levelMetres','feedKgS','feedValvePct',
      'steamKgS','dumpKgS','turbineSteamKgS','steamValvePct','gctAValvePct','heatMW','asgRunning']
      .map(k=>`gv.${i}.${k}`)).flat(),
    ...Array.from({length:6},(_,i)=>`fluxDetectors6.${i}`),
    ...Array.from({length:4},(_,i)=>['secondaryBreakAreaCm2','secondaryBreakKgS',
      'secondaryBreakReleasedKg','secondaryBreakEnergyJ','waterMassRateKgS']
      .map(k=>`gv.${i}.${k}`)).flat(),
    'risPumpSpeedFraction',
    ...Array.from({length:4},(_,i)=>[`accumulatorsKg.${i}`,`accumulatorNitrogenBar.${i}`,`accumulatorFlowsKgS.${i}`]).flat(),
    ...Array.from({length:4},(_,i)=>`loops.${i}.forcedPrimingFraction`)
  ];
  function historyPoint(model) {
    const s=model.state;
    const compact=value=>typeof value==='boolean'?Number(value):Number.isFinite(value)
      ?Number(value.toPrecision(8)):null;
    return { t:s.time, power:s.powerPct, electric:s.electricMW,
      thermalPower:100*s.thermalPowerMW/C.nominalThermalMW,
      residualPower:100*s.decayMW/C.nominalThermalMW,
      pumpHeatMW:s.pumpHeatMW,
      cold:s.coldC,tavg:s.tavgC,hot:s.hotC,tric:s.tRicC,
      pzrTemp:saturationTemperatureC(s.pressureBar),reactivity:s.reactivityPcm,
      pressure:s.pressureBar,gvPressure:s.gv.map(g=>g.pressureBar),
      boron:s.boronPpm,gv:s.gv.map(g=>g.levelPct),
      gvTemp:s.gv.map(g=>g.tempC),pzrLevel:s.pzrLevelPct,
      steamTotal:s.totalSteamKgS,steamGctA:s.gv.reduce((sum,g)=>sum+g.dumpKgS,0),
      steamVpu:s.totalTurbineSteamKgS,
      asg:s.gv.map(g=>g.asgKgS),fDeltaH:s.fDeltaH,dnbr:s.dnbr,
      rods:{R:s.rods.R,G1:s.rods.G1,G2:s.rods.G2,N1:s.rods.N1,N2:s.rods.N2,SA:s.rods.SA},
      r:s.rods.R,g3:s.g3Count,ris:s.risDeliveredKgS,break:s.breakKgS,
      accumulator:s.accumulatorKgS,risMp:s.risMpKgS,risBp:s.risBpKgS,
      cppLevel:s.inventory.levelM,cppMass:s.primaryMassKg,vaporization:s.vaporizationKgS,
      vaporMass:s.vaporMassKg,breakSteam:s.breakSteamKgS,
      breakDensity:s.breakDensityKgM3,
      massBalance:primaryMassBalance(s),relief:s.reliefKgS,
      pline:s.peakLinearWcm,dpax:s.dpaxPctPn,
      detailVersion:1,
      detail:HISTORY_PATHS.map(p=>compact(p.split('.').reduce((v,k)=>v?.[k],s))),
      cc:Object.values(controlSignals(model)).map(([value])=>compact(value)) };
  }
  function sample(model) {
    const s=model.state;
    if (s.time+1e-9 < s.sampleAt) return;
    s.sampleAt = s.time+1;
    s.history.push(historyPoint(model));
    if (s.history.length>8*3600) s.history.shift();
  }

  function refreshReactivity(model) {
    const s=model.state,u=model.controls;
    const rodPcm=rodsReactivityPcm(s.rods,s.ejectWorthPcm,u.rodWorthPcm);
    const boronPcm=C.boronWorthPcmPpm*(s.boronPpm-C.boronInitialPpm);
    const tempPcm=u.coolantWorthPcmC*(s.tavgC-C.primaryMeanC);
    const dopplerPcm=u.dopplerWorthPcmC*(s.fuelC-C.fuelC);
    const xenonPcm=-u.xenonEquilibriumWorthPcm*(s.xenonTop+s.xenonBottom)/2;
    // Le calage du point initial suit le poids nominal choisi ; il ne suit
    // pas la concentration de xénon pendant le transitoire.
    const coreReferencePcm=u.xenonEquilibriumWorthPcm;
    s.xenonWorthPcm=xenonPcm;
    s.reactivityParts={rod:rodPcm,boron:boronPcm,temp:tempPcm,
      doppler:dopplerPcm,coreReference:coreReferencePcm,xenon:xenonPcm};
    s.reactivityPcm=rodPcm+boronPcm+tempPcm+dopplerPcm
      +coreReferencePcm+xenonPcm;
    return s;
  }

  function step(model, dt) {
    const s=model.state,u=model.controls;
    dt=clamp(Number(dt)||0,0,0.1);
    if (!dt||s.endState) return s;
    updateSetpointRamps(model,dt);
    updateTurbineDemand(model,dt);
    s.trefC=297.2+9.3*turbineLoadTargetPct(model)/100;
    s.rLimitPas=rInsertionLimit(s.powerPct,u.halfCycle);
    s.rcvTankBoronPpm=rcvChargeBoronPpm(model);
    s.breakAreaCm2=clamp(Number(u.breakAreaCm2)||0,0,2000);
    s.breakLoop=clamp(Math.round(Number(u.breakLoop)||1),1,4);
    s.breakBranch=u.breakBranch;
    updateProtection(s,u,dt);
    updateRods(s,u,dt);

    refreshReactivity(model);
    const rho=clamp(s.reactivityPcm*1e-5,-0.15,0.012);
    const source=s.precursors.reduce((sum,c,i)=>sum+C.lambdaGroups[i]*c,0);
    const n=clamp((s.powerPct/100+dt*source)
      /(1-dt*(rho-C.beta)/C.promptGenerationS),1e-8,3);
    s.precursors=s.precursors.map((c,i)=>Math.max(0,
      (c+dt*C.betaGroups[i]*n/C.promptGenerationS)/(1+dt*C.lambdaGroups[i])));
    s.powerPct=100*n;
    s.fissionMW=C.nominalThermalMW*n;
    // Loi d'étude après fonctionnement nominal prolongé : ~7 % à l'AAR,
    // puis décroissance en temps^-0,2. Ce terme chauffe réellement le combustible.
    if(u.allRodsTargetPas===0&&s.powerPct<1&&s.normalShutdownAt===null)s.normalShutdownAt=s.time;
    const shutdowns=[s.tripAt,s.normalShutdownAt].filter(t=>t!==null);
    const shutdownAt=shutdowns.length?Math.min(...shutdowns):null;
    s.decayMW=shutdownAt===null?0:0.07*C.nominalThermalMW
      *(1+Math.max(0,s.time-shutdownAt))**-0.2;
    s.thermalPowerMW=s.fissionMW+s.decayMW;

    // Les quatre boucles partagent l'inventaire global, sans le multiplier par quatre.
    s.inventory=cppInventory(Math.max(0,s.primaryMassKg-s.vaporMassKg),s.tavgC,s.pressureBar);
    s.coveragePct=s.inventory.coveragePct;
    if(s.inventory.loopLevelM<=C.primaryPumpLowLevelM)
      stopPrimaryPumps(s,`Arrêt GMPP : niveau CPP ${s.inventory.loopLevelM.toFixed(2)} m ≤ ${C.primaryPumpLowLevelM} m · risque de cavitation (hypothèse d'étude)`);
    const forcedPriming=clamp((s.inventory.loopLevelM-C.primaryPumpLowLevelM)/C.primaryPumpLowLevelBandM,0,1);
    for (const loop of s.loops) {
      const stopped=s.primaryPumpsStopped||loop.pumpStopped;
      // Apport thermique de l'entraînement alimenté, distinct du débit :
      // ni PTUR ni le relais par thermosiphon ne le commandent.
      // Après déclenchement, l'énergie cinétique du ralentissement n'est pas
      // ajoutée : le modèle ne possède pas de stock d'énergie rotor/circuit.
      loop.pumpHeatMW=stopped?0:C.primaryPumpHeatMWPerUnit;
      const nominalLoopFlow=C.nominalPrimaryFlowKgS/4;
      const flowTarget=stopped?0:nominalLoopFlow;
      const priming=s.inventory.loopPriming[loop.index-1];
      const localFactor=s.breakAreaCm2>0 && s.breakLoop===loop.index?0.82:1;
      const tau=stopped?C.pumpCoastdownTauS:8;
      const previousForced=loop.forcedFlowKgS;
      // Le dénoyage du sommet GV ne supprime pas le débit d'une pompe
      // encore alimentée. La borne d'eau disponible évite en revanche
      // une circulation inertielle fictive après vidange de l'aspiration.
      loop.forcedPrimingFraction=forcedPriming;
      loop.forcedFlowKgS=Math.min(nominalLoopFlow*forcedPriming,
        previousForced+(flowTarget*localFactor*forcedPriming-previousForced)*clamp(dt/tau,0,1));
      if(stopped&&loop.forcedFlowKgS<0.02*nominalLoopFlow)loop.forcedFlowKgS=0;
      const fraction=loop.forcedFlowKgS/nominalLoopFlow;
      const gv=s.gv[loop.index-1];
      const thermalDrive=Math.max(0,s.tavgC-gv.tempC);
      loop.primingFraction=priming;loop.thermalDriveC=thermalDrive;
      loop.gvWaterFactor=clamp(gv.waterKg/C.gvNominalWaterKg,0,1);
      loop.coreCoverageFraction=s.coveragePct/100;loop.breakFactor=localFactor;
      const naturalTarget=Math.min(C.naturalCirculationMaxKgSPerLoop,
        clamp(u.naturalCirculationKgSPerLoop,0,C.naturalCirculationMaxKgSPerLoop)
          *Math.sqrt(thermalDrive/C.naturalCirculationReferenceDeltaC))
        *s.coveragePct/100*s.inventory.loopPriming[loop.index-1]
        *clamp(gv.waterKg/C.gvNominalWaterKg,0,1)*localFactor;
      // Relais progressif du débit forcé par la circulation naturelle.
      loop.naturalFlowKgS=stopped?naturalTarget*(1-clamp(fraction,0,1)):0;
      loop.flowKgS=loop.forcedFlowKgS+loop.naturalFlowKgS;
      // La variation 7→10 bar avec T représente l'effet de densité sur la HMT.
      // La pression motrice d'aspersion suit le seul débit forcé.
      const headAtTemp=tempC=>clamp(C.pumpHeadHotBar
        +(C.pumpHeadColdBar-C.pumpHeadHotBar)*(324.6-tempC)/(324.6-20),
        C.pumpHeadHotBar,C.pumpHeadColdBar);
      loop.pumpHeadHotBar=headAtTemp(loop.hotC)*fraction*fraction;
      loop.pumpHeadColdBar=headAtTemp(loop.coldC)*fraction*fraction;
      const nominalColdHead=headAtTemp(288.4);
      loop.vesselDeltaBar=C.sprayDriveNominalBar
        *loop.pumpHeadColdBar/nominalColdHead;
      loop.gvDeltaBar=loop.vesselDeltaBar;
    }
    s.pumpHeatMW=s.loops.reduce((sum,loop)=>sum+loop.pumpHeatMW,0);
    s.coreFlowFraction=clamp(s.loops.reduce((a,l)=>a+l.flowKgS,0)/C.nominalPrimaryFlowKgS,0,1);
    // Loi globale à K fixe : le transfert ne s'annule pas à l'arrêt des GMPP.
    // Le même échange est retiré du combustible et ajouté au primaire.
    const coreTransferMW=C.coreConductanceMWC*(s.fuelC-s.tavgC);
    s.coreTransferMW=coreTransferMW;
    updateGv(s,u,dt);
    const fuelDelta=(s.thermalPowerMW-coreTransferMW)*1e6*dt/C.fuelHeatCapacityJk;
    s.fuelC=clamp(s.fuelC+fuelDelta,20,3000);

    // Brèche primaire, RIS à pression variable et transit des volumes injectés.
    s.risPumpSpeedFraction=risPumpsReady(s,u)
      ? Math.min(1,s.risPumpSpeedFraction+dt/C.risPumpStartS):0;
    const hydraulicPressureBar=primaryHydraulicPressure(model,dt,coreTransferMW);
    const breach=primaryBreakHydraulics(s,hydraulicPressureBar,dt);
    s.breakDensityKgM3=breach.density;
    s.breakKgS=breach.flowKgS;
    s.breakKgS=Math.min(s.breakKgS,Math.max(0,(s.primaryMassKg-1)/dt));
    risPumpFlows(s,u,hydraulicPressureBar);
    s.easCoolingMW=0;coolRisSump(s,dt);
    let accumPump=0;
    for(let i=0;i<4;i++) {
      const gas=accumulatorFlowKgS(hydraulicPressureBar,s.accumulatorsKg[i],s.accumulatorFlowsKgS[i],dt);
      const target=s.risEnabled&&s.risDemandAt!==null?gas.flowKgS:0;
      // Réduction progressive en fin de réserve (sortie qui se découvre),
      // plutôt que délivrer le dernier paquet à plein débit puis couper net.
      const q=Math.min(target,s.accumulatorsKg[i]
        /Math.max(dt,C.accumulatorEndDrainTauS));
      s.accumulatorFlowsKgS[i]=q;accumPump+=q;s.accumulatorsKg[i]-=q*dt;
      s.accumulatorNitrogenBar[i]=accumulatorFlowKgS(hydraulicPressureBar,s.accumulatorsKg[i]).nitrogenBar;
    }
    s.accumulatorKgS=accumPump;
    const recirculation=u.risSourceMode==="recirculation";
    const sourceMass=recirculation?s.sumpKg:s.risTankRemainingKg;
    const risPump=Math.min(s.risMpKgS+s.risBpKgS,sourceMass/dt);
    const sourceBoron=recirculation?s.sumpBoronPpm:clamp(Number(u.risBoronPpm),0,4000);
    const sourceTemp=recirculation?s.sumpTempC:C.risInjectionTempC;
    const risReserveBefore=s.risTankRemainingKg;
    if(recirculation){
      s.sumpKg-=risPump*dt;s.sumpBoron-=risPump*dt*sourceBoron;
      s.sumpEnergyJ-=risPump*dt*C.primaryCpJkgK*sourceTemp;
    }else s.risTankRemainingKg-=risPump*dt;
    if(risReserveBefore>0&&s.risTankRemainingKg<=0)
      addEvent(s,"protection","Réserve RIS épuisée : bascule en recirculation possible depuis la conduite manuelle");
    const pumpTotal=s.risMpKgS+s.risBpKgS;
    const mpPumped=pumpTotal>0?risPump*s.risMpKgS/pumpTotal:0;
    // Garder l'origine des paquets jusqu'à leur arrivée : le bilan CPP
    // utilise les débits livrés, pas les demandes à la sortie des pompes.
    pumpToPipe(s.risPipe,s.time+C.risTransitS,mpPumped*dt,
      sourceBoron,{tempC:sourceTemp,source:"mp"});
    pumpToPipe(s.risPipe,s.time+C.risTransitS,(risPump-mpPumped)*dt,
      sourceBoron,{tempC:sourceTemp,source:"bp"});
    pumpToPipe(s.risPipe,s.time+C.accumulatorTransitS,accumPump*dt,
      clamp(Number(u.risBoronPpm),0,4000),{tempC:C.risInjectionTempC,source:"accumulator"});
    const arrivedRis=deliverPipe(s.risPipe,s.time,null,Infinity,
      risAdmissionLimits(s,u,hydraulicPressureBar,dt));
    s.risDeliveredKgS=arrivedRis.massKg/dt;
    s.risDeliveredMpKgS=arrivedRis.sources.mp/dt;
    s.risDeliveredBpKgS=arrivedRis.sources.bp/dt;
    s.risDeliveredAccumulatorKgS=arrivedRis.sources.accumulator/dt;
    const risFallback={tempC:sourceTemp,boronPpm:sourceBoron};
    s.flowProperties.risMp=deliveredProperties(arrivedRis.properties.mp,risFallback);
    s.flowProperties.risBp=deliveredProperties(arrivedRis.properties.bp,risFallback);
    s.flowProperties.accumulator=deliveredProperties(arrivedRis.properties.accumulator,
      {tempC:C.risInjectionTempC,boronPpm:clamp(Number(u.risBoronPpm),0,4000)});
    s.flowProperties.ris=deliveredProperties(arrivedRis,risFallback);
    // Apport BF : hypothèse de mélange, avec 50 % de court-circuit sur la seule
    // boucle rompue. Les autres 3/4 de l'injection traversent entièrement le cœur.
    s.risCoreKgS=s.risDeliveredKgS*(s.breakAreaCm2>0&&s.breakBranch==="froide"?0.875:1);
    s.coreFlowKgS=s.loops.reduce((sum,l)=>sum+l.flowKgS,0)+s.risCoreKgS;
    s.coreFlowFraction=s.coreFlowKgS/C.nominalPrimaryFlowKgS;

    const chargeM3h=Number.isFinite(u.rcvChargeGraphM3h)
      ? u.rcvChargeGraphM3h : u.rcvChargeM3h;
    // La glissière/CC demande un débit ; la HMT de la pompe en limite
    // le débit réalisé. Les retours des joints restent dans le bilan CPP.
    s.rcvDemandM3h=clamp(Number(chargeM3h)||0,0,C.rcvMaxCommandM3h);
    s.rcvCapacityM3h=rcvPumpCapacityM3h(hydraulicPressureBar);
    s.rcvChargeM3h=Math.min(s.rcvDemandM3h,s.rcvCapacityM3h);
    const chargeDensity=liquidWaterDensityKgM3(s.tavgC,s.pressureBar);
    const rcvFlow=s.rcvChargeM3h*chargeDensity/3600;
    const letdown=rcvLetdownM3h(model)*chargeDensity/3600;
    s.rcvChargeKgS=rcvFlow;
    s.rcvSealKgS=Math.min(C.rcvSealM3h,s.rcvChargeM3h)*chargeDensity/3600;
    s.rcvLetdownKgS=letdown;
    pumpToPipe(s.rcvPipe,s.time+C.rcvTransitS,rcvFlow*dt,s.rcvTankBoronPpm,
      {mode:rcvInjectionMode(model),litres:s.rcvChargeM3h*dt*1000/3600,tempC:s.tavgC});
    // La contre-pression agit immédiatement, même sur les parcelles en transit.
    // Une parcelle non admise reste en ligne : aucune masse/bore n'est effacée.
    const arrivedRcv=deliverPipe(s.rcvPipe,s.time,s.rcvInjectionLitres,
      s.rcvCapacityM3h*chargeDensity/3600*dt);
    s.rcvDeliveredKgS=arrivedRcv.massKg/dt;
    s.flowProperties.charge=deliveredProperties(arrivedRcv,{tempC:s.tavgC,boronPpm:s.rcvTankBoronPpm});
    s.rcvDeliveredM3h=s.rcvDeliveredKgS*3600
      /liquidWaterDensityKgM3(s.flowProperties.charge.tempC,s.pressureBar);

    updateRelief(s,u,dt);
    const oldMass=s.primaryMassKg;
    const oldVaporMass=s.vaporMassKg;
    const availableMass=oldMass+arrivedRis.massKg+arrivedRcv.massKg;
    const totalOut=s.breakKgS+letdown+s.reliefKgS;
    const outScale=Math.min(1,Math.max(0,availableMass-1)/Math.max(1,totalOut*dt));
    s.breakKgS*=outScale;s.reliefKgS*=outScale;
    s.reliefStageKgS=s.reliefStageKgS.map(q=>q*outScale);
    s.rcvLetdownKgS=letdown*outScale;
    const outMass=(s.breakKgS+s.rcvLetdownKgS+s.reliefKgS)*dt;
    const oldTemp=s.tavgC,oldLatent=s.vaporEnergyJ;
    const latent=latentHeatJkg(s.pressureBar);
    s.breakSteamKgS=s.breakKgS*breach.steamFraction;
    s.breakLiquidKgS=s.breakKgS-s.breakSteamKgS;
    // Conditions effectivement employées au prélèvement dans le bilan homogénéisé.
    s.flowProperties.letdown={tempC:oldTemp,boronPpm:s.boronPpm};
    s.flowProperties.breakLiquid={tempC:oldTemp,boronPpm:s.boronPpm};
    s.flowProperties.breakSteam={tempC:saturationTemperatureC(s.pressureBar),boronPpm:0};
    // PZR plein : la soupape évacue du liquide, pas une vapeur fictive.
    // Transition continue sur les derniers 0,4 m³ de poche équivalente.
    const reliefSteamFraction=clamp(s.inventory.steamSpaceM3/.4,0,1);
    s.reliefSteamKgS=s.reliefKgS*reliefSteamFraction;
    s.reliefLiquidKgS=s.reliefKgS-s.reliefSteamKgS;
    s.flowProperties.relief={tempC:lerp(oldTemp,saturationTemperatureC(s.pressureBar),reliefSteamFraction),
      boronPpm:s.boronPpm*(1-reliefSteamFraction)};
    const steamOut=(s.breakSteamKgS+s.reliefSteamKgS)*dt;
    const liquidOut=outMass-steamOut;
    s.boronInventory+=arrivedRis.boron+arrivedRcv.boron-liquidOut*s.boronPpm;
    s.primaryMassKg=Math.max(1,availableMass-outMass);
    s.risCoolingMW=(arrivedRis.massKg*C.primaryCpJkgK*oldTemp-arrivedRis.energyJ)/dt/1e6;
    // Conservation de l'énergie : l'eau injectée apporte son enthalpie,
    // la vapeur sortante emporte Cp*T + Lv. Aucun refroidissement forfaitaire.
    const oldEnergy=oldMass*C.primaryCpJkgK*oldTemp+oldLatent;
    const outgoingEnergy=outMass*C.primaryCpJkgK*oldTemp+steamOut*latent;
    const netEnergy=oldEnergy+(coreTransferMW+s.pumpHeatMW-s.totalGvMW)*1e6*dt
      +arrivedRis.energyJ+arrivedRcv.energyJ-outgoingEnergy;
    const pBefore=s.pressureBar;
    const circulation=Math.max(0,s.coreFlowKgS);
    const satBefore=saturationTemperatureC(pBefore);
    const outletRiseFactor=C.corePowerFraction/(1-C.coreBypassFraction)-.5;
    const maxRise=Math.max(0,Math.min(2*(oldTemp-20),(satBefore-oldTemp)/outletRiseFactor));
    const sensibleLimit=circulation*C.primaryCpJkgK*maxRise/1e6;
    const vaporHeatMW=Math.max(0,coreTransferMW-sensibleLimit);
    // Équilibre homogénéisé du stock : une bulle locale peut se condenser
    // dans le liquide sous-refroidi. Aucune vapeur ne reste stockée à T<Tsat.
    s.vaporEnergyJ=Math.max(0,netEnergy-s.primaryMassKg*C.primaryCpJkgK*satBefore);
    let candidateTemp=Math.min(satBefore,netEnergy/(s.primaryMassKg*C.primaryCpJkgK));
    s.tavgC=Math.max(20,candidateTemp);
    // Collecte simplifiée dans le puisard pour la recirculation : la vapeur
    // rejetée se condense à l'enthalpie sensible, chaleur latente vers l'enceinte.
    const collected=(s.breakKgS+s.reliefKgS)*dt;
    s.sumpKg+=collected;s.sumpBoron+=((s.breakLiquidKgS+s.reliefLiquidKgS)*dt)*s.boronPpm;
    s.sumpEnergyJ+=collected*C.primaryCpJkgK*Math.min(100,oldTemp);
    coolRisSump(s,dt);
    s.nrefPct=Number.isFinite(u.nrefGraphPct)
      ? clamp(u.nrefGraphPct,0,100)
      : clamp(20+21.8*(s.tavgC-297.2)/9.3,20,41.8);
    s.prefBar=Number.isFinite(u.prefGraphBar)?clamp(u.prefGraphBar,1,180):155;
    let sprayDemandPct;
    if(Number.isFinite(u.pressureGraphHeaterKW)
        || Number.isFinite(u.pressureGraphSprayPct)) {
      s.heaterKW=Number.isFinite(u.pressureGraphHeaterKW)
        ? clamp(u.pressureGraphHeaterKW,0,2500) : s.heaterKW;
      sprayDemandPct=Number.isFinite(u.pressureGraphSprayPct)
        ? clamp(u.pressureGraphSprayPct,0,100) : s.sprayPct;
    } else {
      s.heaterKW=clamp(Number(u.manualHeaterKW),0,2500);
      sprayDemandPct=clamp(Number(u.manualSprayPct),0,100);
    }
    s.sprayPct+=clamp(sprayDemandPct-s.sprayPct,
      -C.sprayStrokePctPerS*dt,C.sprayStrokePctPerS*dt);
    const sprayDrive1=s.loops[0].vesselDeltaBar;
    const sprayDrive2=s.loops[1].vesselDeltaBar;
    s.sprayDriveBar=(sprayDrive1+sprayDrive2)/2;
    const line1Drive=Math.sqrt(Math.max(0,sprayDrive1)/C.sprayDriveNominalBar);
    const line2Drive=Math.sqrt(Math.max(0,sprayDrive2)/C.sprayDriveNominalBar);
    const sprayLine1M3h=(C.sprayFullM3hPerValve*s.sprayPct/100
      +C.sprayContinuousM3hPerValve)*line1Drive;
    const sprayLine2M3h=(C.sprayFullM3hPerValve*s.sprayPct/100
      +C.sprayContinuousM3hPerValve)*line2Drive;
    s.sprayValveM3h=C.sprayFullM3hPerValve*s.sprayPct/100
      *(line1Drive+line2Drive);
    s.sprayContinuousM3h=C.sprayContinuousM3hPerValve
      *(line1Drive+line2Drive);
    s.sprayFlowM3h=sprayLine1M3h+sprayLine2M3h;
    s.sprayFlowPct=100*s.sprayFlowM3h/(2*C.sprayFullM3hPerValve);
    const spraySourceC=s.sprayFlowM3h>0
      ? (sprayLine1M3h*s.loops[0].coldC+sprayLine2M3h*s.loops[1].coldC)
        /s.sprayFlowM3h
      : (s.loops[0].coldC+s.loops[1].coldC)/2;
    s.sprayFlowKgS=s.sprayFlowM3h*liquidWaterDensityKgM3(spraySourceC,s.pressureBar)/3600;
    const saturationC=saturationTemperatureC(s.pressureBar);
    const sprayCoolingKW=s.sprayFlowKgS*C.primaryCpJkgK
      *Math.max(0,saturationC-spraySourceC)/1000;
    // Détour de la charge directe vers le PZR : même masse et même bore,
    // déjà comptés dans arrivedRcv. Ni débit supplémentaire, ni HMT GMPP.
    s.auxiliarySprayM3h=Math.min(clamp(Number(u.manualAuxiliarySprayM3h)||0,0,C.auxiliarySprayMaxM3h),
      Math.max(0,s.rcvDeliveredM3h-Math.min(C.rcvSealM3h,s.rcvDeliveredM3h)));
    s.auxiliarySpraySourceC=arrivedRcv.massKg>0
      ? arrivedRcv.energyJ/(arrivedRcv.massKg*C.primaryCpJkgK) : s.tavgC;
    s.auxiliarySprayCoolingKW=s.auxiliarySprayM3h
      *liquidWaterDensityKgM3(s.auxiliarySpraySourceC,s.pressureBar)/3600*C.primaryCpJkgK
      *Math.max(0,saturationC-s.auxiliarySpraySourceC)/1000;
    s.totalSprayFlowM3h=s.sprayFlowM3h+s.auxiliarySprayM3h;
    // Échange passif effectif calibré au point nominal ; sa valeur reste
    // une hypothèse, distincte du débit d'aspersion documenté.
    const pzrNetHeatMW=(s.heaterKW-C.pzrPassiveTransferKW-sprayCoolingKW-s.auxiliarySprayCoolingKW)/1000;
    const before={massKg:oldMass,vaporKg:oldVaporMass,tempC:oldTemp,pressureBar:pBefore};
    const pressure=advancePrimaryPressure(before,s.primaryMassKg,netEnergy,pzrNetHeatMW,
      s.reliefSteamKgS,s.pzrThermalPressureBar,s.pzrLevelPct,dt);
    s.pzrThermalPressureBar=pressure.thermalPressureBar;
    s.pressureBar=pressure.pressureBar;
    s.pzrPistonBarS=(s.pressureBar-pBefore)/dt;
    s.saturationC=saturationTemperatureC(s.pressureBar);
    // Détente : l'énergie excédant le liquide saturé produit de la vapeur.
    // Elle reste dans l'inventaire jusqu'à condensation ou rejet.
    s.vaporEnergyJ=Math.max(0,netEnergy-s.primaryMassKg*C.primaryCpJkgK*s.saturationC);
    s.tavgC=Math.min(s.saturationC,Math.max(20,netEnergy/(s.primaryMassKg*C.primaryCpJkgK)));
    s.vaporMassKg=Math.min(s.primaryMassKg-1,s.vaporEnergyJ/latentHeatJkg(s.pressureBar));
    s.vaporEnergyJ=s.vaporMassKg*latentHeatJkg(s.pressureBar);
    s.primaryMassRateKgS=(s.primaryMassKg-oldMass)/dt;
    s.vaporMassRateKgS=(s.vaporMassKg-oldVaporMass)/dt;
    // Transfert interne liquide ↔ vapeur : inclut détente et condensation.
    // Ce terme ne s'ajoute pas une seconde fois à la fuite totale de brèche.
    s.phaseChangeKgS=s.vaporMassRateKgS+s.breakSteamKgS+s.reliefSteamKgS;
    s.primaryEnergyJ=s.primaryMassKg*C.primaryCpJkgK*s.tavgC+s.vaporEnergyJ;
    s.boronPpm=clamp(s.boronInventory/Math.max(1,s.primaryMassKg-s.vaporMassKg),0,C.reaBoronPpm);
    s.inventory=cppInventory(Math.max(0,s.primaryMassKg-s.vaporMassKg),s.tavgC,s.pressureBar);
    s.coveragePct=s.inventory.coveragePct;
    s.pzrLevelPct=s.inventory.components.pzr.fillPct;
    // L'inventaire a changé pendant ce pas. Un sommet maintenant découvert
    // ne peut conserver un débit de thermosiphon calculé avec l'ancien niveau.
    for(const loop of s.loops){
      loop.primingFraction=s.inventory.loopPriming[loop.index-1];
      loop.forcedPrimingFraction=clamp((s.inventory.loopLevelM-C.primaryPumpLowLevelM)/C.primaryPumpLowLevelBandM,0,1);
      loop.coreCoverageFraction=s.coveragePct/100;
      if(loop.primingFraction===0)loop.naturalFlowKgS=0;
      loop.flowKgS=loop.forcedFlowKgS+loop.naturalFlowKgS;
    }
    s.coreFlowKgS=s.loops.reduce((sum,l)=>sum+l.flowKgS,0)+s.risCoreKgS;
    s.coreFlowFraction=clamp(s.loops.reduce((sum,l)=>sum+l.flowKgS,0)/C.nominalPrimaryFlowKgS,0,1);
    const primaryFlow=s.coreFlowKgS;
    const maxDelta=Math.max(0,Math.min(2*(s.tavgC-20),(s.saturationC-s.tavgC)/outletRiseFactor));
    const deltaT=primaryFlow>1?Math.min(maxDelta,Math.max(0,coreTransferMW-vaporHeatMW)*1e6
      /(primaryFlow*C.primaryCpJkgK)):0;
    s.sensibleCoreMW=primaryFlow*C.primaryCpJkgK*deltaT/1e6;
    s.vaporizationKgS=Math.max(0,coreTransferMW-s.sensibleCoreMW)*1e6/latentHeatJkg(s.pressureBar);
    s.hotC=Math.min(s.saturationC,s.tavgC+deltaT/2);
    s.coldC=Math.max(20,s.tavgC-deltaT/2);
    // T RIC est la sortie moyenne du cœur avant mélange avec les 7 % de bypass.
    // Les branches chaudes mesurent, elles, la sortie de cuve après mélange.
    s.tRicC=Math.min(s.saturationC,s.coldC+C.corePowerFraction*deltaT/(1-C.coreBypassFraction));
    s.lidC=Math.min(s.saturationC,s.hotC);
    for(const loop of s.loops) {
      const gv=s.gv[loop.index-1];
      const asymmetry=(gv.heatMW-s.totalGvMW/4)/70;
      loop.hotC=clamp(s.hotC+asymmetry,20,s.saturationC);
      loop.coldC=clamp(s.coldC-asymmetry,20,s.saturationC);
    }
    updateAxial(s,u,dt);
    s.ptOutside=isPtOutside(s);
    updateCoreDamageWarning(s,dt);
    s.time+=dt;
    sample(model);
    return s;
  }
  function updateCoreDamageWarning(s,dt) {
    const reason=s.peakLinearWcm>590?"Puissance linéique supérieure à 590 W/cm."
      :s.inventory.levelM<CPP_CORE_TOP_M?"Dénoyage du haut du cœur.":"";
    if(!reason){s.coreDamageWarning=null;return;}
    if(!s.coreDamageWarning){
      s.coreDamageWarning={elapsedS:0,remainingS:C.coreDamageDelayS,reason};
      addEvent(s,"alarm",`Risque de cœur fondu · ${reason} Temporisation de 5 s.`);
    }else{
      s.coreDamageWarning.elapsedS+=dt;
      s.coreDamageWarning.remainingS=Math.max(0,C.coreDamageDelayS-s.coreDamageWarning.elapsedS);
      s.coreDamageWarning.reason=reason;
    }
    if(s.coreDamageWarning.elapsedS>C.coreDamageDelayS+1e-9){
      s.endState="melted";s.endReason=reason+" Dépassement maintenu plus de 5 s.";
      addEvent(s,"protection",`Cœur fondu · ${s.endReason}`);
    }
  }
  function advance(model, seconds, dt=0.1) {
    let remaining=Math.max(0,Number(seconds)||0);
    while(remaining>1e-9) {
      const h=Math.min(remaining,dt,0.1);
      step(model,h); remaining-=h;
      if(model.state.endState)break;
    }
    return model.state;
  }
  function refreshAxial(model) {
    updateAxial(model.state,model.controls,0);
    return model.state;
  }
  // Lecture commune aux synoptiques, au tableau de bord et aux éditeurs CC.
  // Les commandes demandées ne remplacent jamais les positions/débits réalisés.
  function primaryMassBalance(s) {
    const inputKgS=s.rcvDeliveredKgS+s.risDeliveredKgS;
    const outputKgS=s.rcvLetdownKgS+s.breakKgS+s.reliefKgS;
    const netKgS=inputKgS-outputKgS;
    const totalRateKgS=s.primaryMassRateKgS;
    const properties=s.flowProperties;
    const mix=(flows)=>{
      const total=flows.reduce((sum,[q])=>sum+q,0);
      return total>0?{tempC:flows.reduce((sum,[q,p])=>sum+q*p.tempC,0)/total,
        boronPpm:flows.reduce((sum,[q,p])=>sum+q*p.boronPpm,0)/total}:null;
    };
    const streams={...properties,
      break:mix([[s.breakLiquidKgS,properties.breakLiquid],[s.breakSteamKgS,properties.breakSteam]]),
      input:mix([[s.rcvDeliveredKgS,properties.charge],[s.risDeliveredKgS,properties.ris]]),
      output:mix([[s.rcvLetdownKgS,properties.letdown],[s.breakLiquidKgS,properties.breakLiquid],
        [s.breakSteamKgS,properties.breakSteam],[s.reliefKgS,properties.relief]])};
    const conditions={};
    for(const [key,p] of Object.entries(streams)){
      conditions[key+"TempC"]=p?.tempC??null;
      conditions[key+"BoronPpm"]=p?.boronPpm??null;
    }
    return {
      ...conditions,
      chargeKgS:s.rcvDeliveredKgS,chargeM3h:s.rcvDeliveredM3h,
      risMpKgS:s.risDeliveredMpKgS,risBpKgS:s.risDeliveredBpKgS,
      accumulatorKgS:s.risDeliveredAccumulatorKgS,
      risMpM3h:s.risDeliveredMpKgS*3600/C.risWaterDensityKgM3,
      risBpM3h:s.risDeliveredBpKgS*3600/C.risWaterDensityKgM3,
      accumulatorM3h:s.risDeliveredAccumulatorKgS*3600/C.risWaterDensityKgM3,
      risKgS:s.risDeliveredKgS,risM3h:s.risDeliveredKgS*3600/C.risWaterDensityKgM3,
      letdownKgS:s.rcvLetdownKgS,letdownM3h:s.rcvLetdownKgS*3600
        /liquidWaterDensityKgM3(properties.letdown.tempC,s.pressureBar),
      breakKgS:s.breakKgS,breakLiquidKgS:s.breakLiquidKgS,breakSteamKgS:s.breakSteamKgS,
      breakDensityKgM3:s.breakDensityKgM3,
      // Équivalent liquide de la masse rejetée, et non volume diphasique réel.
      breakM3h:s.breakKgS*3600/s.breakDensityKgM3,
      reliefKgS:s.reliefKgS,reliefLiquidKgS:s.reliefLiquidKgS,reliefSteamKgS:s.reliefSteamKgS,
      reliefM3h:s.reliefKgS*3600/liquidWaterDensityKgM3(properties.letdown.tempC,s.pressureBar),
      inputKgS,outputKgS,netKgS,totalRateKgS,
      liquidRateKgS:totalRateKgS-s.vaporMassRateKgS,
      vaporRateKgS:s.vaporMassRateKgS,phaseChangeKgS:s.phaseChangeKgS,
      closureErrorKgS:totalRateKgS-netKgS,
      trend:netKgS>0.05?"Inventaire total en hausse":netKgS<-.05?"Inventaire total en baisse":"Bilan massique équilibré"
    };
  }
  function primaryFlowDiagnostics(model) {
    const s=model.state,u=model.controls;
    const loops=s.loops.map(loop=>{
      const gv=s.gv[loop.index-1],stopped=s.primaryPumpsStopped||loop.pumpStopped;
      const priming=loop.primingFraction??s.inventory.loopPriming[loop.index-1];
      const forcedPriming=loop.forcedPrimingFraction??clamp((s.inventory.loopLevelM-C.primaryPumpLowLevelM)/C.primaryPumpLowLevelBandM,0,1);
      const drive=loop.thermalDriveC??Math.max(0,s.tavgC-gv.tempC);
      const water=loop.gvWaterFactor??clamp(gv.waterKg/C.gvNominalWaterKg,0,1);
      const coverage=loop.coreCoverageFraction??s.coveragePct/100;
      const topM=s.inventory.components[`gv${loop.index}`].topM;
      const reasons=[];
      if(priming<.999)reasons.push(priming<=1e-6
        ? `boucle désamorcée : niveau ${s.inventory.loopLevelM.toFixed(2)} m, sommet du faisceau ${topM.toFixed(2)} m (amorçage nul sous ${(topM-.3).toFixed(2)} m)`
        : `amorçage partiel ${Math.round(priming*100)} % : niveau sous le sommet du faisceau ${topM.toFixed(2)} m`);
      if(drive<=1e-6)reasons.push(`absence de source froide : TMOY ${s.tavgC.toFixed(1)} °C ≤ TGV ${gv.tempC.toFixed(1)} °C`);
      if(water<=1e-6)reasons.push("GV sans eau côté secondaire");
      else if(water<.99)reasons.push(`inventaire secondaire réduit (${Math.round(water*100)} % du nominal)`);
      if(coverage<.999)reasons.push(`couverture du cœur ${Math.round(coverage*100)} %`);
      if(Number(u.naturalCirculationKgSPerLoop)<=0)reasons.push("débit naturel de référence réglé à zéro");
      if(loop.breakFactor<1)reasons.push("brèche sur cette boucle");
      const lost=stopped&&loop.naturalFlowKgS<.1&&reasons.length>0;
      const limited=stopped&&reasons.length>0;
      const coastdown=stopped&&loop.forcedFlowKgS>0;
      const forcedReduced=forcedPriming<.999||loop.breakFactor<1;
      const status=!stopped?(forcedReduced?"Débit forcé réduit":"Circulation forcée")
        :lost?"Thermosiphon perdu":limited?"Thermosiphon réduit":coastdown?"Ralentissement GMPP / relais naturel":"Thermosiphon établi";
      const detail=stopped?(reasons.length?reasons.join(" · ")
        :`boucle amorcée · écart primaire–GV ${drive.toFixed(1)} °C`)
        :[`GMPP en marche`,
          ...(forcedPriming<.999?[`aspiration fragilisée : niveau CPP ${s.inventory.loopLevelM.toFixed(2)} m, arrêt mémorisé à ${C.primaryPumpLowLevelM} m`]:[]),
          ...(loop.breakFactor<1?["brèche sur cette boucle"]:[]),
          ...(priming<.999?["thermosiphon indisponible après arrêt : sommet du faisceau dénoyé"]:[])].join(" · ");
      return {index:loop.index,status,detail,severity:lost?"lost":stopped?limited?"reduced":"normal":forcedReduced?"reduced":"normal",
        forcedKgS:loop.forcedFlowKgS,naturalKgS:loop.naturalFlowKgS,totalKgS:loop.flowKgS,
        pumpHeatMW:loop.pumpHeatMW,
        flowPct:100*loop.flowKgS/(C.nominalPrimaryFlowKgS/4),primingFraction:priming,forcedPrimingFraction:forcedPriming,
        thermalDriveC:drive,gvWaterFactor:water,coreCoverageFraction:coverage};
    });
    return {loops,forcedKgS:loops.reduce((sum,l)=>sum+l.forcedKgS,0),
      naturalKgS:loops.reduce((sum,l)=>sum+l.naturalKgS,0),
      loopKgS:loops.reduce((sum,l)=>sum+l.totalKgS,0),
      risCoreKgS:s.risCoreKgS,coreKgS:s.coreFlowKgS,
      pumpHeatMW:s.pumpHeatMW,
      corePct:100*s.coreFlowFraction,primedLoops:loops.filter(l=>l.primingFraction>.001).length};
  }
  function instrumentSnapshot(model, selectedGv=1) {
    const s=model.state,u=model.controls;
    const gv=Math.max(1,Math.min(4,Math.trunc(Number(selectedGv)||1)));
    const gvAll=s.gv.map(g=>({...g,areTempC:C.areFeedTempC,feedTh:g.feedKgS*3.6,
      asgM3h:g.asgKgS*3600/C.risWaterDensityKgM3}));
    const loops=s.loops.map(loop=>({...loop,pumpStopped:s.primaryPumpsStopped||loop.pumpStopped,
      flowPct:100*loop.flowKgS/(C.nominalPrimaryFlowKgS/4)}));
    const rBelowLimit=s.tripAt===null&&s.rods.R<s.rLimitPas-0.5;
    return {gv,gvState:gvAll[gv-1],gvAll,loops,operatingState:reactorOperatingState(s),
      power:s.powerPct,demand:s.demandPct,pressure:s.pressureBar,
      pzrLevel:s.pzrLevelPct,nref:s.nrefPct,pzrTempC:saturationTemperatureC(s.pressureBar),
      sprayPct:s.sprayPct,sprayFlowM3h:s.sprayFlowM3h,heaterKW:s.heaterKW,
      auxiliarySprayM3h:s.auxiliarySprayM3h,totalSprayFlowM3h:s.totalSprayFlowM3h,
      primaryPumpsStopped:s.primaryPumpsStopped,primaryPumpStopAt:s.primaryPumpStopAt,
      primaryPumpStopReason:s.primaryPumpStopReason,allRodsTargetPas:u.allRodsTargetPas,
      asgDemandAt:s.asgDemandAt,asgAt:s.asgAt,
      coreDamageWarning:s.coreDamageWarning?{...s.coreDamageWarning}:null,
      heaterImmersionPct:Math.max(0,Math.min(100,s.pzrLevelPct/15*100)),
      hotC:s.hotC,coldC:s.coldC,tRicC:s.tRicC,tavgC:s.tavgC,lidC:s.lidC,
      inventory:s.inventory,primaryMassKg:s.primaryMassKg,massBalance:primaryMassBalance(s),
      primaryFlow:primaryFlowDiagnostics(model),
      vaporMassKg:s.vaporMassKg,vaporizationKgS:s.vaporizationKgS,
      saturationC:saturationTemperatureC(s.pressureBar),risCoreKgS:s.risCoreKgS,
      accumulatorsKg:[...s.accumulatorsKg],accumulatorNitrogenBar:[...s.accumulatorNitrogenBar],
      accumulatorFlowsKgS:[...s.accumulatorFlowsKgS],accumulatorKgS:s.accumulatorKgS,
      risMpKgS:s.risMpKgS,risBpKgS:s.risBpKgS,risPumpSpeedFraction:s.risPumpSpeedFraction,risSourceMode:u.risSourceMode,
      risTankRemainingKg:s.risTankRemainingKg,sumpKg:s.sumpKg,sumpTempC:s.sumpTempC,
      sumpBoronPpm:s.sumpBoronPpm,easCoolingMW:s.easCoolingMW,risPumpMode:u.risPumpMode,
      rra:rraConditions(s),rraConnected:s.rraConnected,endState:s.endState,endReason:s.endReason,
      boron:s.boronPpm,g3:s.g3Count,g3Display:s.tripAt===null?s.g3Count:null,
      rods:{...s.rods},rLimit:s.rLimitPas,halfCycle:u.halfCycle,tripAt:s.tripAt,
      steamKgS:s.totalSteamKgS,steamTh:s.totalSteamKgS*3.6,
      turbinePct:s.turbinePct,thermalMW:s.thermalPowerMW,pumpHeatMW:s.pumpHeatMW,electricMW:s.electricMW,
      reliefStages:[...s.reliefStages],reliefOpeningPct:[...s.reliefOpeningPct],
      reliefAutoArmed:[...s.reliefAutoArmed],reliefAutoOpeningPct:[...s.reliefAutoOpeningPct],
      reliefKgS:s.reliefKgS,reliefStageKgS:[...s.reliefStageKgS],gvSetpoint:u.gvLevelSetpointPct,
      risDelivered:s.risDeliveredKgS,
      risLoopM3h:s.risDeliveredKgS*3600/C.risWaterDensityKgM3/4,
      rraLoopM3h:s.rraFlowKgS*3600/C.primaryDensityKgM3/2,
      chargeM3h:s.rcvChargeM3h,
      letdownM3h:s.rcvLetdownKgS*3600/liquidWaterDensityKgM3(s.flowProperties.letdown.tempC,s.pressureBar),
      rcvCapacityM3h:s.rcvCapacityM3h,rcvDemandM3h:s.rcvDemandM3h,pzrPistonBarS:s.pzrPistonBarS,
      alarms:{rBelowLimit,gcta:gvAll[gv-1].dumpKgS>0.01,dpax:s.dpaxRightExceeded,pt:isPtOutside(s)},
      time:s.time,signals:{...s.signals}};
  }
  function controlSignals(model) {
    const s=model.state,u=model.controls,v=instrumentSnapshot(model);
    const values={
      ptur:[s.turbinePct,"%"],pdem:[s.demandPct,"%"],pow1:[s.powerPct,"% PN"],
      mt1Signal:[s.hotC,"°C"],mt2Signal:[s.coldC,"°C"],
      mp1Signal:[s.pressureBar,"bar abs."],mn1Signal:[s.pzrLevelPct,"%"],
      pow2Signal:[s.electricMW,"MWe"],mt3Signal:[s.gv[0].tempC,"°C"],
      mt4Signal:[v.gvState.areTempC,"°C"],md1Signal:[s.totalSteamKgS/1000,"t/s"],
      mp2Signal:[s.gv[0].pressureBar,"bar abs."],
      pthcSignal:[100*s.thermalPowerMW/C.nominalThermalMW,"% PN"],
      pgvSignal:[100*s.totalGvMW/C.nominalThermalMW,"% PN"],
      tmoy:[s.tavgC,"°C"],tpzrSignal:[v.pzrTempC,"°C"],
      reacSignal:[s.reactivityPcm,"pcm"],tfuelSignal:[s.fuelC,"°C"],
      plinSignal:[s.peakLinearWcm,"W/cm"],dnbrSignal:[s.dnbr,""],
      tsubSignal:[s.subcoolingC,"°C"],
      pchauffSignal:[s.heaterKW,"kW"],qaspSignal:[s.sprayPct,"%"],
      qpriSignal:[100*s.coreFlowFraction,"% nominal"],
      qchaSignal:[v.chargeM3h,"m³/h"],qdecSignal:[v.letdownM3h,"m³/h"],
      nrefSignal:[s.nrefPct,"%"],imchSignal:[v.heaterImmersionPct,"%"],
      qsvpSignal:[s.reliefKgS,"kg/s"],posgSignal:[s.rods.R,"pas extraits"],
      posgInternalPct:[100*(260-s.rods.R)/260,"% insertion"],
      gcpPowerSignal:[Math.min(100,turbineLoadTargetPct(model)+u.gcpCalibrationPct),"% PN"],
      turbineLimitSignal:[Number.isFinite(u.turbineLimitGraphPct)?clamp(u.turbineLimitGraphPct,0,100):100,"%"],
      gcpCalibrationSignal:[u.gcpCalibrationPct,"% PN"],
      gvSetpointSignal:[u.gvLevelSetpointPct,"%"],g3CountSignal:[s.g3Count,"pas"],
      voltageSignal:[s.lossOfVoltage?1:0,"TOR"],fluxRateSignal:[s.fluxRatePctS,"% PN/s"],
      aarSignal:[s.tripDemandAt!==null||s.tripAt!==null?1:0,"TOR"],
      qaspAuxSignal:[s.auxiliarySprayM3h,"m³/h"]
    };
    s.gv.forEach((g,i)=>{
      values[`gv${i+1}LevelSignal`]=[g.levelPct,"%"];
      values[`gv${i+1}SteamSignal`]=[g.steamKgS,"kg/s"];
    });
    // Ajouter à la fin : conserver les indices des mesures CC dans les anciens historiques.
    Object.assign(values,{
      pressureSetpointSignal:[u.pressureSetpointBar,"bar abs."],
      pzrLevelSetpointSignal:[u.pzrLevelSetpointPct,"%"],
      pressureSetpointManualSignal:[u.pressureSetpointManual?1:0,"TOR"],
      pzrLevelSetpointManualSignal:[u.pzrLevelSetpointManual?1:0,"TOR"],
      rcvLetdownCloseSignal:[u.rcvLetdownCloseGraph===true?1:0,"TOR"],
      qchargeCapacitySignal:[s.rcvCapacityM3h,"m³/h"]
    });
    return values;
  }
  return { C,G3,ROD_NAMES,ROD_WORTH_PCM,AXIAL_ROD_ABSORPTION,TRANSIENTS,make,step,advance,
    CPP_GEOMETRY,CPP_CORE_TOP_M,CPP_CORE_BOTTOM_M,CPP_INITIAL_LEVEL_M,HISTORY_PATHS,historyPoint,
    cppInventory,liquidWaterDensityKgM3,saturatedWaterDensities,rcvPumpCapacityM3h,solvePrimaryPressure,pzrEquilibriumResponse,advancePrimaryPressure,primaryBreakHydraulics,
    latentHeatJkg,gvThermalCapacityJk,gvLatentHeatJkg,secondaryBreakFlowKgS,accumulatorFlowKgS,ptLimits,reactorOperatingState,isPtOutside,rraConditions,connectRra,setRisOperation,commandAllRods,tripPrimaryPumps,
    instrumentSnapshot,controlSignals,primaryMassBalance,primaryFlowDiagnostics,TURBINE_MANUAL_RATES,setManualTurbineDemand,
    SETPOINT_RATES,SETPOINT_CONTROLS,setManualSetpoint,
    evolveAxialPoisons,
    g3Target,gcpPositions,rInsertionLimit,rodIntegral,rodsReactivityPcm,
    axialInsertionFraction,solveAxialShape,smoothAxialProfile,
    saturationPressureBar,saturationTemperatureC,gvLevels,asgFlowKgS,
    SPIN_FXY32,spinFxy32,coreProtectionProfile,
    dpaxRightLimit,isDpaxRightExceeded,rcvLetdownM3h,rcvChargeBoronPpm,
    setRManualOverride,setRcvInjection,rcvInjectionMode,setRcvGraphInjection,
    turbineLoadTargetPct,startTransient,transientDemand,isTransientActive,pauseTransient,resumeTransient,
    interruptTransient,initiate,prepareRcvTank,refreshAxial,refreshReactivity };
});
