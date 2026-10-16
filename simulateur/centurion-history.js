/* Courbes libres : catalogue, axes indépendants, sélection temporelle et lecture. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CenturionHistory=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const colors=['#1584b2','#c34c36','#27855e','#8857b5','#ab7909','#267d87','#b04b83','#5969af','#61762e',
    '#d45b88','#8a6334','#536b80','#ac504f','#3e8071','#935d96','#346fbc','#ab6b29','#658753',
    '#ae426d','#46779a','#7d683a','#5c508e','#b17258','#32839a','#8a783e','#774d6a','#476a4d',
    '#986537','#5f6796','#b55e28','#368467','#954da8'];
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const timeLabel=t=>{const n=Math.max(0,Math.floor(t));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60]
    .map(v=>String(v).padStart(2,'0')).join(':');};
  const numberLabel=v=>Number.isFinite(v)?(Math.abs(v)<.0005?0:v).toLocaleString('fr-FR',{maximumFractionDigits:3}):'—';
  function parseTime(text){
    const match=/^(\d+):(\d{2}):(\d{2})$/.exec(String(text).trim());
    return match&&+match[2]<60&&+match[3]<60?+match[1]*3600+ +match[2]*60+ +match[3]:null;
  }
  function catalog(E,referenceModel=null){
    const defs=[];
    function add(id,label,tag,unit,group,value,range=[0,100],mode='adaptive',zero=false,aliases=''){
      const d={id,label,tag,unit,group,value,range,mode,zero,color:colors[defs.length%colors.length]};
      d.search=normalize(`${label} ${tag} ${unit} ${group} ${id} ${aliases}`);defs.push(d);return d;
    }
    const simple=(id,label,tag,unit,group,key,range,mode,zero,aliases)=>add(id,label,tag,unit,group,p=>p[key],range,mode,zero,aliases);
    simple('power','Puissance nucléaire de fission','POW1','% PN','Puissances','power',[0,110],'adaptive',true,'RCP001KM pow1');
    add('thermalMW','Puissance thermique cœur','PTHC','MWth','Puissances',p=>p.thermalPower*E.C.nominalThermalMW/100,[0,4000],'adaptive',true);
    simple('thermalPower','Puissance thermique cœur relative','PTHC','% PN','Puissances','thermalPower',[0,110],'adaptive',true);
    add('residualMW','Puissance résiduelle','PRES','MWth','Puissances',p=>p.residualPower*E.C.nominalThermalMW/100,[0,300],'adaptive',true);
    simple('residualPower','Puissance résiduelle relative','PRES','% PN','Puissances','residualPower',[0,10],'adaptive',true);
    simple('electric','Puissance réseau','POW2','MWe','Puissances','electric',[0,1400],'adaptive',true,'pow2Signal');
    add('electricPct','Puissance réseau relative à 1 300 MWe','POW2','% nominal','Puissances',p=>100*p.electric/E.C.nominalElectricMW,[0,110],'adaptive',true);
    for(const [id,label,tag] of [['cold','Branche froide moyenne','TBF'],['tavg','Température moyenne primaire','TMOY'],
      ['hot','Branche chaude moyenne','TBC'],['tric','Sortie cœur avant bypass','T RIC'],['pzrTemp','Température du pressuriseur','TPZR']])
      simple(id,label,tag,'°C','Températures',id,[280,350]);
    simple('pressure','Pression primaire','002MP','bar','Pressions','pressure',[0,180],'adaptive',true,'mp1Signal');
    simple('pzrLevel','Niveau pressuriseur','003MN','%','Niveaux','pzrLevel',[0,100],'fixed',true,'mn1Signal');
    for(const [id,label,tag,unit,range,mode,zero] of [
      ['boron','Concentration en bore primaire','CB','ppm',[0,7000],'adaptive',true],
      ['pline','Puissance linéique maximale','PLIN','W/cm',[0,435],'fixed',true],
      ['dnbr','Marge critique simplifiée','DNBR','—',[0,3],'adaptive',true],
      ['fDeltaH','Facteur d’élévation d’enthalpie','FΔH','—',[0,3],'adaptive',true],
      ['dpax','Déséquilibre axial de puissance','DPAX','% PN',[-15,15],'adaptive',false],
      ['reactivity','Réactivité globale','REAC','pcm',[-600,600],'adaptive',false],
      ['cppLevel','Niveau CPP depuis le fond de cuve','N CPP','m',[0,25],'fixed',true],
      ['cppMass','Masse totale primaire','M CPP','kg',[0,300000],'adaptive',true],
      ['vaporMass','Masse de vapeur de détente','M VAP','kg',[0,5000],'adaptive',true],
      ['pumpHeatMW','Chaleur totale des pompes primaires','GMPP','MWth',[0,24],'fixed',true]])
      simple(id,label,tag,unit,'Cœur et inventaire',id,range,mode,zero);
    for(const [id,label,tag] of [['steamTotal','Débit vapeur total · 4 GV','VAP'],
      ['steamGctA','Débit GCT-A · 4 GV','GCT-A'],['steamVpu','Débit VPU · 4 GV','VPU']])
      simple(id,label,tag,'kg/s','Vapeur',id,[0,2400],'adaptive',true);
    for(const n of ['R','G1','G2','N1','N2','SA'])add(`rod.${n}`,`Position du groupe ${n}`,`RGL ${n}`,'pas extraits',
      'Grappes',p=>p.rods?.[n],[0,260],'fixed',true);
    simple('g3','Position condensée des GCP','G3','pas de chevauchement','Grappes','g3',[0,780],'fixed',true);
    for(const [id,label,tag,key,max] of [['ris','Injection RIS arrivée au CPP','RIS','ris',6500],
      ['break','Brèche · équivalent liquide chaud','BRÈCHE','break',13000],
      ['accumulator','Débit des accumulateurs RIS','ACCU','accumulator',6500]]){
      simple(`${id}.kg`,label,tag,'kg/s','Débits d’eau',key,[0,max/3.6],'adaptive',true);
      add(`${id}.m3`,label,tag,'m³/h','Débits d’eau',p=>p[key]*3600/(id==='break'?(p.breakDensity||E.C.primaryDensityKgM3):E.C.risWaterDensityKgM3),[0,max],'adaptive',true);
    }
    const pathIndex=new Map(E.HISTORY_PATHS.map((p,i)=>[p,i]));
    const detail=(path)=>p=>p.detailVersion===1?p.detail?.[pathIndex.get(path)]:undefined;
    function extra(path,label,tag,unit,group,range,mode='adaptive',zero=false){
      return add(path,label,tag,unit,group,detail(path),range,mode,zero);
    }
    for(const [p,l,t,u,g,r,m,z] of [
      ['demandPct','Puissance turbine demandée','PDEM','%','Puissances',[0,100],'fixed',true],
      ['turbinePct','Puissance turbine réalisée','PTUR','%','Puissances',[0,100],'fixed',true],
      ['totalGvMW','Puissance échangée dans les quatre GV','PGV','MWth','Puissances',[0,4000],'adaptive',true],
      ['trefC','Température primaire de référence','TREF','°C','Températures',[280,320]],
      ['fuelC','Température à cœur du crayon','TCRA','°C','Températures',[0,1200]],
      ['lidC','Température du couvercle','T COUV','°C','Températures',[0,350]],
      ['subcoolingC','Sous-refroidissement','TSUB','°C','Températures',[0,60]],
      ['nrefPct','Niveau PZR de référence','NREF','%','Niveaux',[0,100],'fixed',true],
      ['coveragePct','Couverture en eau du cœur','COUV','%','Inventaire',[0,100],'fixed',true],
      ['coreFlowKgS','Débit total traversant le cœur, RIS inclus','Q CŒUR','kg/s','Débits d’eau',[0,18000],'adaptive',true],
      ['risCoreKgS','RIS traversant le cœur','RIS CŒUR','kg/s','Débits d’eau',[0,1800],'adaptive',true],
      ['heaterKW','Puissance des chaufferettes','PCHF','kW','Pressuriseur',[0,2500],'fixed',true],
      ['pzrHeatToPrimaryMW','Chaleur PZR transférée au stock primaire','Q PZR CPP','MWth','Pressuriseur',[-20,20]],
      ['pzrHeatReserveMW','Chaleur accumulée dans la réserve PZR','Q RÉSERVE','MWth','Pressuriseur',[-20,3]],
      ['sprayCoolingKW','Transfert thermique par aspersion BF','Q ASP','kW','Pressuriseur',[0,20000],'adaptive',true],
      ['sprayPct','Ouverture aspersion réglante','201/202KM','%','Pressuriseur',[0,100],'fixed',true],
      ['sprayFlowM3h','Débit aspersion BF','QASP','m³/h','Pressuriseur',[0,300],'adaptive',true],
      ['auxiliarySprayM3h','Débit aspersion auxiliaire RCV','QASP AUX','m³/h','Pressuriseur',[0,8],'fixed',true],
      ['totalSprayFlowM3h','Débit total d’aspersion','QASP TOT','m³/h','Pressuriseur',[0,310],'adaptive',true],
      ['sprayDriveBar','Pression motrice d’aspersion','ΔP ASP','bar','Pressuriseur',[0,5]],
      ['pzrPistonBarS','Vitesse de variation de pression primaire','dP/dt','bar/s','Pressuriseur',[-1,1]],
      ['pzrThermalPressureBar','Pression thermique de référence PZR','P TH PZR','bar','Pressuriseur',[0,180]],
      ['rcvChargeM3h','Débit charge RCV pompé','QCHARGE','m³/h','RCV',[0,60],'fixed',true],
      ['rcvDeliveredM3h','Débit charge RCV arrivé','QCHA CPP','m³/h','RCV',[0,60],'fixed',true],
      ['rcvDemandM3h','Débit charge RCV demandé','QCHA DEM','m³/h','RCV',[0,60],'fixed',true],
      ['rcvCapacityM3h','Capacité disponible de la charge RCV','QCHA MAX','m³/h','RCV',[0,60],'fixed',true],
      ['rcvTankBoronPpm','CB de charge RCV','CB RCV','ppm','RCV',[0,7000],'fixed',true],
      ['xenonWorthPcm','Antiréactivité du xénon','XÉNON','pcm','Poisons',[-6000,0]],
      ['xenonTop','Concentration relative de xénon en haut','XE HAUT','× nominal','Poisons',[0,2]],
      ['xenonBottom','Concentration relative de xénon en bas','XE BAS','× nominal','Poisons',[0,2]],
      ['iodineTop','Réserve d’iode en haut','I HAUT','× nominal','Poisons',[0,2]],
      ['iodineBottom','Réserve d’iode en bas','I BAS','× nominal','Poisons',[0,2]],
      ['g3Target','Consigne du compteur GCP','G3 CIBLE','pas de chevauchement','Grappes',[0,780],'fixed',true],
      ['rLimitPas','Insertion limite du groupe R','IL R','pas extraits','Grappes',[0,260],'fixed',true],
      ['risTankRemainingKg','Masse d’eau PTR disponible','M PTR','kg','RIS',[0,2315000],'adaptive',true],
      ['sumpKg','Masse d’eau aux puisards','M PUIS','kg','RIS',[0,300000],'adaptive',true],
      ['sumpTempC','Température des puisards','T PUIS','°C','RIS',[0,90],'fixed',true],
      ['sumpBoronPpm','CB des puisards','CB PUIS','ppm','RIS',[0,7000]],
      ['easCoolingMW','Refroidissement EAS','P EAS','MWth','RIS',[0,100],'adaptive',true],
      ['risCoolingMW','Refroidissement apporté par RIS','P RIS','MWth','RIS',[0,100],'adaptive',true],
      ['primaryMassRateKgS','Variation du stock primaire','dM CPP/dt','kg/s','Inventaire',[-1000,1000]],
      ['phaseChangeKgS','Changement de phase net','FLASH','kg/s','Inventaire',[-1000,1000]],
      ['rraFlowKgS','Débit RRA','RRA','kg/s','Débits d’eau',[0,400],'fixed',true],
      ['lossOfVoltage','Manque de tension','MDT','TOR','Protection',[0,1],'fixed',true]])extra(p,l,t,u,g,r,m,z);
    add('coreFlowPct','Débit primaire des boucles relatif','QPRI','% nominal','Débits d’eau',p=>detail('coreFlowFraction')(p)*100,[0,110],'fixed',true);
    for(const [key,label,tag] of [['rod','Effet des grappes','ρ GRAPPES'],['boron','Effet du bore','ρ BORE'],
      ['temp','Effet modérateur','ρ MOD'],['doppler','Effet Doppler','ρ DOP'],['xenon','Effet du xénon','ρ XE'],
      ['coreReference','Compensation initiale du xénon','ρ REF']])
      extra(`reactivityParts.${key}`,label,tag,'pcm','Réactivité',[-5000,5000]);
    for(const n of ['SB','SC','SD'])extra(`rods.${n}`,`Position du groupe ${n}`,`RGL ${n}`,'pas extraits','Grappes',[0,260],'fixed',true);
    for(const [key,label,tag,unit,range] of [
      ['chargeKgS','Charge RCV arrivée','QCHA','kg/s',[0,15]],['letdownM3h','Décharge RCV','QDEC','m³/h',[0,54]],
      ['inputKgS','Total des entrées CPP','ENTRÉES','kg/s',[0,2000]],['outputKgS','Total des sorties CPP','SORTIES','kg/s',[0,4000]],
      ['netKgS','Solde du bilan massique CPP','BILAN','kg/s',[-2000,2000]],
      ['liquidRateKgS','Variation de masse liquide CPP','dML/dt','kg/s',[-2000,2000]],
      ['vaporRateKgS','Variation de masse vapeur CPP','dMV/dt','kg/s',[-2000,2000]],
      ['reliefKgS','Débit total des soupapes PZR','QSVP','kg/s',[0,200]],
      ['breakLiquidKgS','Débit liquide à la brèche','BR LIQ','kg/s',[0,4000]],
      ['breakSteamKgS','Débit vapeur à la brèche','BR VAP','kg/s',[0,2000]]])
      add(`balance.${key}`,label,tag,unit,'Bilan CPP',p=>p.massBalance?.[key],range);
    for(let i=0;i<4;i++){
      const n=i+1;
      for(const [key,label,tag,unit,range,mode] of [
        ['flowKgS','Débit primaire total','QPRI','kg/s',[0,5000]],
        ['forcedFlowKgS','Débit forcé','Q FORCÉ','kg/s',[0,5000]],
        ['naturalFlowKgS','Débit thermosiphon','Q NATUREL','kg/s',[0,300]],
        ['hotC','Température branche chaude',`${n}01MT`,'°C',[280,350]],
        ['coldC','Température branche froide',`${n}02MT`,'°C',[280,350]],
        ['pumpHeatMW','Chaleur GMPP','P GMPP','MWth',[0,6],'fixed'],
        ['pumpHeadColdBar','HMT GMPP','HMT','bar',[0,10]],
        ['vesselDeltaBar','Perte de charge cuve','ΔP CUVE','bar',[0,5]],
        ['gvDeltaBar','Perte de charge GV','ΔP GV','bar',[0,5]],
        ['primingFraction','Amorçage du thermosiphon','AMORÇAGE NAT','—',[0,1],'fixed'],
        ['forcedPrimingFraction','Disponibilité d’aspiration GMPP','ASPIRATION GMPP','—',[0,1],'fixed']])
        extra(`loops.${i}.${key}`,`${label} · boucle ${n}`,`${tag} B${n}`,unit,`Boucle ${n}`,range,mode);
      add(`gv.${i}.pressure`,`Pression GV ${n}`,`${n}04MP`,'bar',`GV ${n}`,p=>p.gvPressure?.[i],[0,100],'adaptive',true);
      add(`gv.${i}.level`,`Niveau gamme étroite GV ${n}`,`${n}05MN`,'%',`GV ${n}`,p=>p.gv?.[i],[0,100],'fixed',true);
      add(`gv.${i}.temp`,`Température vapeur GV ${n}`,`T GV${n}`,'°C',`GV ${n}`,p=>p.gvTemp?.[i],[0,330]);
      add(`gv.${i}.asg`,`Débit ASG GV ${n}`,`ASG${n}01MD`,'m³/h',`GV ${n}`,p=>p.asg?.[i]*3.6,[0,180],'adaptive',true);
      for(const [key,label,tag,unit,range,mode] of [
        ['waterKg','Masse d’eau','M EAU','kg',[0,100000]],['levelWidePct','Niveau gamme large',`${n}06MN`,'%',[0,100],'fixed'],
        ['levelMetres','Hauteur d’eau','N EAU','m',[0,15]],['feedKgS','Débit ARE',`ARE${n}01MD`,'kg/s',[0,1000]],
        ['feedValvePct','Ouverture ARE','ARE','%',[0,100],'fixed'],['steamKgS','Débit vapeur total','VAP','kg/s',[0,1000]],
        ['dumpKgS','Débit GCT-A',`GCT-A${n}20KM`,'kg/s',[0,1000]],['turbineSteamKgS','Débit VPU','VPU','kg/s',[0,1000]],
        ['steamValvePct','Ouverture VVP',`VVP${n}20VV`,'%',[0,100],'fixed'],['gctAValvePct','Ouverture GCT-A','GCT-A','%',[0,100],'fixed'],
        ['heatMW','Puissance échangée','PGV','MWth',[0,1100]],['asgRunning','Train ASG en service','ASG ES','TOR',[0,1],'fixed'],
        ['secondaryBreakAreaCm2','Section de brèche vapeur','BRÈCHE','cm²',[0,2000]],
        ['secondaryBreakKgS','Débit brèche vapeur','Q BRÈCHE','kg/s',[0,1000]],
        ['secondaryBreakReleasedKg','Masse vapeur perdue à la brèche','M BRÈCHE','kg',[0,100000]],
        ['secondaryBreakEnergyJ','Énergie emportée à la brèche','E BRÈCHE','J',[0,1e11]],
        ['waterMassRateKgS','Bilan de masse d’eau','BILAN EAU','kg/s',[-1000,1000]]])
        extra(`gv.${i}.${key}`,`${label} · GV ${n}`,`${tag} GV${n}`,unit,`GV ${n}`,range,mode);
    }
    for(let i=0;i<6;i++)extra(`fluxDetectors6.${i}`,`Flux RPN section ${i+1} · du bas vers le haut`,`RPN ${i+1}`,'× moyen','RPN',[0,2]);
    // Sources exactement transmises aux ateliers, y compris consignes/limiteurs.
    const signals=Object.entries(E.controlSignals(referenceModel||E.make()));
    const signalNames={ptur:'Puissance turbine',pdem:'Demande turbine',pow1:'Puissance nucléaire',pow2Signal:'Puissance réseau',
      mt1Signal:'Branche chaude',mt2Signal:'Branche froide',mp1Signal:'Pression primaire',mn1Signal:'Niveau PZR',
      mt3Signal:'Température vapeur GV1',mt4Signal:'Température ARE',mp2Signal:'Pression GV1',md1Signal:'Débit vapeur total',
      pthcSignal:'Puissance thermique cœur',pgvSignal:'Puissance échangée GV',tmoy:'Température moyenne',tpzrSignal:'Température PZR',
      reacSignal:'Réactivité',tfuelSignal:'Température crayon',plinSignal:'PLIN',dnbrSignal:'DNBR',tsubSignal:'Sous-refroidissement',
      pchauffSignal:'Chaufferettes',qaspSignal:'Ouverture aspersion',qpriSignal:'Débit primaire relatif',qchaSignal:'Charge RCV',
      qdecSignal:'Décharge RCV',nrefSignal:'Niveau PZR de référence',imchSignal:'Immersion chaufferettes',qsvpSignal:'Soupapes PZR',
      posgSignal:'Position de R',posgInternalPct:'Insertion de R',gcpPowerSignal:'Puissance vue par les GCP',
      turbineLimitSignal:'Limiteur turbine',gcpCalibrationSignal:'Décalibrage GCP',gvSetpointSignal:'Consigne niveau GV',
      g3CountSignal:'Position GCP',voltageSignal:'Manque de tension',fluxRateSignal:'Variation du flux',aarSignal:'Ordre AAR',qaspAuxSignal:'Aspersion auxiliaire'};
    signals.forEach(([id,[,unit]],i)=>{
      const range=unit==='TOR'?[0,1]:unit==='°C'?[0,350]:unit.includes('bar')?[0,180]:unit==='pcm'?[-600,600]
        :unit==='pas extraits'?[0,260]:unit==='pas'?[0,780]:unit==='W/cm'?[0,435]:unit==='kW'?[0,2500]
          :unit==='MWe'?[0,1400]:unit==='m³/h'?[0,60]:unit==='kg/s'?[0,1000]:unit==='t/s'?[0,2.5]
            :unit==='% PN/s'?[-10,10]:!unit?[0,3]:id==='gcpCalibrationSignal'?[0,8]:[0,110];
      add(`cc.${id}`,`CC · ${signalNames[id]||id.replace(/gv(\d)(Level|Steam)Signal/,(_,g,k)=>`${k==='Level'?'Niveau':'Débit vapeur'} GV${g}`)}`,
        id,unit||'—','Sources CC',p=>p.detailVersion===1?p.cc?.[i]:undefined,range,unit==='TOR'?'fixed':'adaptive');
    });
    extra('risPumpSpeedFraction','Vitesse relative des pompes RIS','N RIS','× nominal','RIS',[0,1],'fixed',true);
    for(let i=0;i<4;i++){
      extra(`accumulatorsKg.${i}`,`Masse d’eau · accumulateur ${i+1}`,`M ACCU${i+1}`,'kg','RIS',[0,27000],'fixed',true);
      extra(`accumulatorNitrogenBar.${i}`,`Pression azote · accumulateur ${i+1}`,`P ACCU${i+1}`,'bar','RIS',[0,42],'fixed',true);
      extra(`accumulatorFlowsKgS.${i}`,`Débit · accumulateur ${i+1}`,`Q ACCU${i+1}`,'kg/s','RIS',[0,1000]);
    }
    return defs;
  }
  function presets(gv=1){const i=gv-1;return {
    powers:['power','thermalPower','residualPower','electricPct'],
    temperatures:['cold','tavg','hot','tric','pzrTemp'],
    secondaryTemperatures:[`gv.${i}.temp`,'cc.mt4Signal'],
    pressures:['pressure',`gv.${i}.pressure`],levels:['pzrLevel',`gv.${i}.level`],
    rods:['rod.R','rod.G1','rod.G2','rod.N1','rod.N2','rod.SA','g3'],
    flows:['ris.m3','break.m3'],steam:['steamTotal','steamGctA','steamVpu']
  };}
  function search(defs,text){const words=normalize(text).trim().split(/\s+/).filter(Boolean);
    return defs.filter(d=>words.every(w=>d.search.includes(w)));}
  function trace(def){return {id:def.id,visible:true,mode:def.mode,min:def.range[0],max:def.range[1],color:def.color};}
  function nearest(points,time){
    if(!points.length)return null;let lo=0,hi=points.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(points[mid].t<time)lo=mid+1;else hi=mid;}
    return lo&&Math.abs(points[lo-1].t-time)<Math.abs(points[lo].t-time)?points[lo-1]:points[lo];
  }
  function rangeFor(def,options,points){
    if(options.mode==='fixed')return [options.min,options.max];
    let lo=Infinity,hi=-Infinity;for(const p of points){const v=def.value(p);if(Number.isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}}
    if(!Number.isFinite(lo))return [...def.range];
    if(def.zero&&lo>=0){const step=10**Math.max(-2,Math.floor(Math.log10(Math.max(hi,1)))-1);
      return [0,Math.max(step,Math.ceil(hi*1.02/step)*step)];}
    const span=Math.max(hi-lo,Math.abs(hi)*.04,def.unit==='°C'?2:0.01);
    const step=10**Math.floor(Math.log10(span/5));
    return [Math.floor((lo-span*.1)/step)*step,Math.ceil((hi+span*.1)/step)*step];
  }
  function period(view,state){const points=state.history,oldest=points[0]?.t??0,latest=Math.max(state.time,points.at(-1)?.t??0);
    const end=view.following?latest:clamp(view.end??latest,oldest,latest);
    const start=view.following?Math.max(oldest,end-view.duration):clamp(view.start??end-view.duration,oldest,end);
    return {start,end,oldest,latest,span:Math.max(1,end-start)};}
  function tsv(snapshot,defs,traces){const map=new Map(defs.map(d=>[d.id,d]));
    const rows=[['Instant','Variable','Valeur','Unité']];
    for(const o of traces.filter(o=>o.visible)){const d=map.get(o.id),v=snapshot?.values[o.id];
      if(d)rows.push([snapshot?timeLabel(snapshot.time):'',`${d.tag} · ${d.label}`,Number.isFinite(v)?String(v).replace('.',','):'',d.unit]);}
    return rows.map(r=>r.join('\t')).join('\n');}
  function create({E,$,document,clipboard,getModel,onGv=()=>{}}){
    const defs=catalog(E,getModel()),byId=new Map(defs.map(d=>[d.id,d]));
    const view={traces:[],following:true,duration:300,start:0,end:null,pinned:null,
      reactivity:{mode:'adaptive',min:-600,max:600}};
    let hover=null,geometry=null,overviewGeometry=null,brush=null,lastLegend='',copyText='';
    const periodEditing=new Set();
    const status=(text,error=false)=>{const e=$('historyStatus');e.textContent=text;e.classList.toggle('error',error);};
    function applyPreset(name=$('traceSet').value){
      const ids=presets(Number($('historyGv').value)||1)[name];if(!ids)return;
      view.traces=ids.map((id,i)=>({...trace(byId.get(id)),color:colors[i]}));renderSelection();draw();
    }
    function custom(){ $('traceSet').value='custom'; }
    function updateSearch(){
      const matches=search(defs,$('historySearch').value),selected=new Set(view.traces.map(t=>t.id));
      const prior=$('historyVariable').value;
      $('historyVariable').innerHTML=matches.map(d=>`<option value="${escape(d.id)}"${selected.has(d.id)?' disabled':''}>${escape(d.group+' · '+d.tag+' · '+d.label+' ['+d.unit+']')}${selected.has(d.id)?' · sélectionnée':''}</option>`).join('');
      const available=matches.filter(d=>!selected.has(d.id));
      $('historyVariable').value=available.some(d=>d.id===prior)?prior:available[0]?.id||'';
      $('historySearchCount').textContent=`${matches.length} / ${defs.length} variables`;
      $('historyAdd').disabled=!available.length;
    }
    function renderSelection(){
      $('historySelectedRows').innerHTML=view.traces.map((o,i)=>{const d=byId.get(o.id);return `<tr>
        <td><input id="historyShow${i}" type="checkbox" aria-label="Afficher ${escape(d.label)}"${o.visible?' checked':''}></td>
        <td><input id="historyColor${i}" type="color" value="${o.color}" aria-label="Couleur ${escape(d.label)}"></td>
        <td class="history-variable-name"><strong>${escape(d.tag)}</strong><span>${escape(d.label)}</span><small>${escape(d.unit)}</small></td>
        <td><select id="historyMode${i}" aria-label="Échelle ${escape(d.label)}"><option value="adaptive"${o.mode==='adaptive'?' selected':''}>Adaptative</option><option value="fixed"${o.mode==='fixed'?' selected':''}>Fixe</option></select></td>
        <td><input id="historyMin${i}" type="number" step="any" value="${o.min}" aria-label="Minimum ${escape(d.label)}"${o.mode==='adaptive'?' disabled':''}></td>
        <td><input id="historyMax${i}" type="number" step="any" value="${o.max}" aria-label="Maximum ${escape(d.label)}"${o.mode==='adaptive'?' disabled':''}></td>
        <td><output id="historyValue${i}">—</output></td><td><button id="historyRemove${i}" type="button" class="button history-remove" aria-label="Retirer ${escape(d.label)}">×</button></td></tr>`;}).join('');
      $('historyEmptySelection').hidden=view.traces.length>0;
      view.traces.forEach((o,i)=>{
        $('historyShow'+i).addEventListener('change',e=>{o.visible=e.target.checked;custom();draw();});
        $('historyColor'+i).addEventListener('input',e=>{o.color=e.target.value;custom();draw();});
        $('historyMode'+i).addEventListener('change',e=>{
          o.mode=e.target.value;for(const k of ['Min','Max'])$('history'+k+i).disabled=o.mode==='adaptive';custom();draw();
        });
        function bounds(){const a=$('historyMin'+i),b=$('historyMax'+i),min=Number(a.value),max=Number(b.value);
          const valid=a.value!==''&&b.value!==''&&Number.isFinite(min)&&Number.isFinite(max)&&min<max;
          a.setAttribute('aria-invalid',String(!valid));b.setAttribute('aria-invalid',String(!valid));
          if(!valid){status('La borne minimale doit être inférieure à la borne maximale.',true);return;}
          o.min=min;o.max=max;custom();status('');draw();
        }
        for(const k of ['Min','Max']){
          const input=$('history'+k+i);input.addEventListener('input',bounds);
          input.addEventListener('wheel',e=>{if(input.disabled||document.activeElement!==input)return;e.preventDefault();
            const increment=Math.max(.01,10**Math.floor(Math.log10(Math.max(.01,o.max-o.min)/100)));
            input.value=Number((Number(input.value)+(e.deltaY<0?increment:-increment)).toPrecision(10));bounds();},{passive:false});
        }
        $('historyRemove'+i).addEventListener('click',()=>{view.traces.splice(i,1);custom();renderSelection();draw();});
      });updateSearch();
    }
    function addVariable(){const def=byId.get($('historyVariable').value);if(!def||view.traces.some(o=>o.id===def.id))return;
      if(view.traces.length>=32){status('32 courbes sont déjà sélectionnées. Retirez-en une pour en ajouter une autre.',true);return;}
      const o=trace(def);o.color=colors.find(color=>!view.traces.some(t=>t.color===color))||colors[view.traces.length];
      view.traces.push(o);custom();renderSelection();draw();
    }
    function setPeriod(start,end){const p=period(view,getModel().state);
      start=clamp(start,p.oldest,p.latest);end=clamp(end,p.oldest,p.latest);
      if(p.latest>p.oldest&&end-start<1){status('Choisissez une période d’au moins une seconde.',true);return false;}
      if(end<start)return false;
      view.following=false;view.start=start;view.end=end;view.duration=Math.max(1,end-start);
      periodEditing.clear();
      $('historyWindow').value='custom';status('');draw();return true;
    }
    function movePeriod(direction){const p=period(view,getModel().state),width=Math.min(p.end-p.start,p.latest-p.oldest);
      const start=clamp(p.start+direction*Math.max(1,width/2),p.oldest,Math.max(p.oldest,p.latest-width));
      setPeriod(start,start+width);
    }
    function chooseWindow(){const duration=Number($('historyWindow').value);if(!(duration>0))return;
      periodEditing.clear();
      const p=period(view,getModel().state);view.duration=duration;
      if(!view.following){view.end=p.end;view.start=Math.max(p.oldest,p.end-duration);}draw();
    }
    function availablePoints(){const s=getModel().state;return s.history.length?s.history:[E.historyPoint(getModel())];}
    function snapshotAt(time){const p=nearest(availablePoints(),time);return p?{time:p.t,
      values:Object.fromEntries(defs.map(d=>[d.id,Number.isFinite(d.value(p))?d.value(p):null]))}:null;}
    function pin(time){view.pinned=snapshotAt(time);hover=null;draw();}
    function cursorTime(){return view.pinned?.time??hover??availablePoints().at(-1)?.t??0;}
    function drawSnapshot(reading){
      const pinned=view.pinned,visible=view.traces.filter(o=>o.visible);
      // La réactivité du panneau inférieur fait aussi partie de la lecture.
      if(!visible.some(o=>o.id==='reactivity'))visible.push({id:'reactivity',visible:true});
      $('historyCursorLabel').textContent=`${pinned?'Instant fixé':'Lecture'} : ${timeLabel(reading?.time||0)}`;
      $('historyUnpin').disabled=!pinned;$('historyCopy').disabled=!pinned||!visible.length;
      $('historySnapshot').hidden=!pinned;
      const rows=pinned?visible.map(o=>{const d=byId.get(o.id);return `<tr><td>${escape(d.tag+' · '+d.label)}</td><td>${numberLabel(pinned.values[o.id])}</td><td>${escape(d.unit)}</td></tr>`;}).join(''):'';
      if($('historySnapshotRows').innerHTML!==rows)$('historySnapshotRows').innerHTML=rows;
      $('historySnapshotTime').textContent=pinned?timeLabel(pinned.time):'—';
      copyText=pinned?tsv(pinned,defs,visible):'';
      if(!pinned)$('historyCopyText').hidden=true;
      else if(!$('historyCopyText').hidden)$('historyCopyText').value=copyText;
      view.traces.forEach((o,i)=>{const v=reading?.values[o.id],el=$('historyValue'+i);
        if(el)el.textContent=numberLabel(v);});
    }
    async function copy(){
      if(!view.pinned)return;
      try{if(!clipboard?.writeText)throw new Error('Clipboard indisponible');await clipboard.writeText(copyText);
        status(`Tableau de ${timeLabel(view.pinned.time)} copié · compatible tableur.`);
      }catch(_){const area=$('historyCopyText');area.hidden=false;area.value=copyText;area.focus?.();area.select?.();
        status('Sélection prête : utilisez Ctrl+C pour copier le tableau.');}
    }
    function canvasContext(id,width,height){const canvas=$(id),dpr=typeof window!=='undefined'?window.devicePixelRatio||1:1;
      if(canvas.width!==Math.round(width*dpr))canvas.width=Math.round(width*dpr);
      if(canvas.height!==Math.round(height*dpr))canvas.height=Math.round(height*dpr);
      const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
      ctx.fillStyle='#fbfdff';ctx.fillRect(0,0,width,height);return ctx;
    }
    function path(ctx,points,value,xFor,yFor,color,width=2){
      // Un point manquant interrompt la ligne ; conserver min/max par pixel
      // permet de voir les pics sans dessiner 28 800 segments par courbe.
      ctx.beginPath();let bucket=null,started=false;
      function flush(){if(!bucket)return;const candidates=[bucket.first,bucket.min,bucket.max,bucket.last]
        .sort((a,b)=>a.t-b.t);let previous=null;
        for(const p of candidates){if(p===previous)continue;const x=xFor(p.t),y=yFor(value(p));
          if(started)ctx.lineTo(x,y);else{ctx.moveTo(x,y);started=true;}previous=p;}bucket=null;}
      for(const p of points){const v=value(p);if(!Number.isFinite(v)){flush();started=false;continue;}
        const pixel=Math.floor(xFor(p.t));if(bucket?.pixel!==pixel){flush();bucket={pixel,first:p,last:p,min:p,max:p};}
        else{bucket.last=p;if(v<value(bucket.min))bucket.min=p;if(v>value(bucket.max))bucket.max=p;}}
      flush();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
    }
    function horizontalGrid(ctx,left,right,top,bottom){for(let j=0;j<=4;j++){const y=top+j*(bottom-top)/4;
      ctx.strokeStyle='#e0eaf0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}}
    function timeGrid(ctx,p,left,right,top,bottom){for(let j=0;j<=4;j++){
      const x=left+j*(right-left)/4;ctx.strokeStyle='#e4edf2';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
      ctx.fillStyle='#587486';ctx.font='11px Arial';ctx.textAlign=j===0?'left':j===4?'right':'center';
      ctx.fillText(timeLabel(p.start+j*(p.end-p.start)/4),x,bottom+21);}
      ctx.textAlign='left';}
    function cursorLine(ctx,time,p,left,right,top,bottom){if(time<p.start||time>p.end)return;
      const x=left+(time-p.start)/p.span*(right-left);ctx.save();ctx.setLineDash(view.pinned?[]:[4,3]);
      ctx.strokeStyle=view.pinned?'#304b5b':'#7693a3';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.restore();}
    function drawOverview(p,points){const width=$('historyOverview').getBoundingClientRect().width||900,height=70;
      const ctx=canvasContext('historyOverview',width,height),left=10,right=width-10,top=7,bottom=height-20;
      overviewGeometry={left,right,width,oldest:p.oldest,latest:p.latest};
      const x=t=>left+(t-p.oldest)/Math.max(1,p.latest-p.oldest)*(right-left);
      let peak=100;for(const point of points)if(Number.isFinite(point.power))peak=Math.max(peak,point.power);
      path(ctx,points,point=>point.power,x,v=>bottom-v/(peak*1.1)*(bottom-top),'#a2bac8',1.5);
      const a=x(p.start),b=x(p.end);ctx.fillStyle='#159ec322';ctx.fillRect(a,top,Math.max(1,b-a),bottom-top);
      ctx.strokeStyle='#1689ae';ctx.lineWidth=2;ctx.strokeRect(a,top,Math.max(1,b-a),bottom-top);
      for(const handle of [a,b]){ctx.fillStyle='#1689ae';ctx.fillRect(handle-3,top,6,bottom-top);}
      ctx.fillStyle='#587486';ctx.font='11px Arial';ctx.textAlign='left';ctx.fillText(timeLabel(p.oldest),left,height-3);
      ctx.textAlign='right';ctx.fillText(timeLabel(p.latest),right,height-3);ctx.textAlign='left';
    }
    function draw(){
      const s=getModel().state,p=period(view,s),points=availablePoints(),visible=points.filter(point=>point.t>=p.start&&point.t<=p.end);
      const traces=view.traces.filter(o=>o.visible),column=76,left=Math.max(72,traces.length*column+12),
        width=Math.max($('historyPlotScroll').getBoundingClientRect().width||900,left+440),
        height=Math.max(340,$('historyChart').getBoundingClientRect().height||420),right=width-18,top=52,bottom=height-32;
      $('historyChart').style.width=width+'px';$('reactivityChart').style.width=width+'px';
      const ctx=canvasContext('historyChart',width,height);
      geometry={left,right,top,bottom,width,start:p.start,end:p.end,span:p.span};
      horizontalGrid(ctx,left,right,top,bottom);timeGrid(ctx,p,left,right,top,bottom);
      const reading=view.pinned||snapshotAt(cursorTime());drawSnapshot(reading);
      const xFor=t=>left+(t-p.start)/p.span*(right-left);
      traces.forEach((o,i)=>{const d=byId.get(o.id),[minimum,maximum]=rangeFor(d,o,visible),axis=12+(i+1)*column-5;
        const yFor=v=>bottom-(v-minimum)/(maximum-minimum)*(bottom-top);
        ctx.strokeStyle=o.color;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(axis,top);ctx.lineTo(axis,bottom);ctx.stroke();
        ctx.fillStyle=o.color;ctx.font='bold 10px Arial';ctx.textAlign='center';
        const tag=d.tag.length>12?d.tag.slice(0,11)+'…':d.tag;
        ctx.fillText(tag,axis-column/2,17);ctx.font='10px Arial';
        const unit=d.unit==='pas de chevauchement'?'pas chev.':d.unit;ctx.fillText(unit,axis-column/2,33);
        for(let j=0;j<=4;j++){const y=top+j*(bottom-top)/4;
          ctx.beginPath();ctx.moveTo(axis-4,y);ctx.lineTo(axis,y);ctx.stroke();ctx.textAlign='right';
          ctx.fillText(numberLabel(maximum-j*(maximum-minimum)/4),axis-7,y+4);}
        ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
        path(ctx,visible,d.value,xFor,yFor,o.color);ctx.restore();
        const v=reading?.values[o.id];if(Number.isFinite(v)){
          const y=clamp(yFor(v),top+11,bottom-7),label=(v<minimum?'↓ ':v>maximum?'↑ ':'')+numberLabel(v);
          ctx.fillStyle='#ffffffef';ctx.fillRect(axis-column+4,y-11,column-9,19);
          ctx.fillStyle=o.color;ctx.font='bold 11px Arial';ctx.textAlign='right';ctx.fillText(label,axis-7,y+3);
          if(reading.time>=p.start&&reading.time<=p.end&&v>=minimum&&v<=maximum){ctx.beginPath();ctx.arc(xFor(reading.time),yFor(v),3,0,Math.PI*2);ctx.fill();}
        }ctx.textAlign='left';
      });cursorLine(ctx,reading?.time??0,p,left,right,top,bottom);
      if(!traces.length){ctx.fillStyle='#587486';ctx.font='14px Arial';ctx.fillText('Choisissez une variable à afficher.',left+16,top+35);}
      const legend=traces.map(o=>{const d=byId.get(o.id);return `<span><i style="background:${o.color}"></i>${escape(d.tag+' · '+d.label)}</span>`;}).join('');
      if(legend!==lastLegend){$('historyLegend').innerHTML=legend;lastLegend=legend;}
      drawReactivity(p,visible,reading,left,right,width);drawOverview(p,points);updatePeriodInputs(p);
    }
    function drawReactivity(p,points,reading,left,right,width){
      const height=190,top=30,bottom=height-28,ctx=canvasContext('reactivityChart',width,height),opts=view.reactivity;
      let min=opts.min,max=opts.max;if(opts.mode==='adaptive'){let peak=600;
        for(const point of points)if(Number.isFinite(point.reactivity))peak=Math.max(peak,Math.abs(point.reactivity));
        max=Math.ceil(peak/200)*200;min=-max;}
      const yFor=v=>bottom-(v-min)/(max-min)*(bottom-top),xFor=t=>left+(t-p.start)/p.span*(right-left);
      for(const [lo,hi,color] of [[min,-300,'#f7dfdc'],[-300,-200,'#fff0d5'],[-200,200,'#e6f4ec'],[200,300,'#fff0d5'],[300,max,'#f7dfdc']]){
        const a=Math.max(min,lo),b=Math.min(max,hi);if(b>a){ctx.fillStyle=color;ctx.fillRect(left,yFor(b),right-left,yFor(a)-yFor(b));}}
      ctx.fillStyle='#8857b5';ctx.font='bold 11px Arial';ctx.fillText('Réactivité · pcm',12,16);
      for(let j=0;j<=6;j++){const v=max-j*(max-min)/6,y=yFor(v);ctx.strokeStyle='#cddedc';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.textAlign='right';ctx.fillStyle='#79539f';
        ctx.fillText(numberLabel(v),left-8,y+4);}
      for(const v of [-300,-200,0,200,300])if(v>=min&&v<=max){const y=yFor(v);ctx.strokeStyle=v===0?'#576b65':'#b8c4b8';
        ctx.lineWidth=v===0?1.8:1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
      ctx.textAlign='left';timeGrid(ctx,p,left,right,top,bottom);ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();
      path(ctx,points,point=>point.reactivity,xFor,yFor,'#8857b5',2);ctx.restore();cursorLine(ctx,reading?.time??0,p,left,right,top,bottom);
      const value=reading?.values.reactivity;if(Number.isFinite(value)){ctx.fillStyle='#ffffffef';
        const y=clamp(yFor(value),top+12,bottom-8);ctx.fillRect(left-76,y-12,70,20);ctx.fillStyle='#8857b5';ctx.textAlign='right';
        ctx.font='bold 11px Arial';ctx.fillText((value<min?'↓ ':value>max?'↑ ':'')+numberLabel(value),left-9,y+3);ctx.textAlign='left';}
    }
    function updatePeriodInputs(p){
      $('historyRangeLabel').textContent=`${timeLabel(p.start)} – ${timeLabel(p.end)}`;
      $('historyOldestLabel').textContent=`Données depuis ${timeLabel(p.oldest)}`;
      $('historyNewestLabel').textContent=`Simulation : ${timeLabel(p.latest)}`;
      $('historyLive').disabled=view.following;$('historyPrevious').disabled=p.start<=p.oldest;
      $('historyNext').disabled=p.end>=p.latest;
      for(const [id,value] of [['historyStart',p.start],['historyEnd',p.end]])
        if(document.activeElement!==$(id)&&!periodEditing.has(id))$(id).value=timeLabel(value);
      for(const [id,value] of [['historyStartRange',p.start],['historyEndRange',p.end]]){
        const el=$(id);el.min=String(p.oldest);el.max=String(Math.max(p.oldest+1,p.latest));el.value=String(value);
        el.disabled=p.latest<=p.oldest;el.setAttribute('aria-valuetext',timeLabel(value));}
      $('historyFollowingLabel').textContent=view.following?'Suivi du direct':'Période fixée';
    }
    function eventTime(event,canvas,g){const rect=canvas.getBoundingClientRect(),x=(event.clientX-(rect.left||0))*g.width/rect.width;
      return g.start+clamp((x-g.left)/(g.right-g.left),0,1)*g.span;}
    for(const id of ['historyChart','reactivityChart']){
      const canvas=$(id);canvas.addEventListener('pointermove',event=>{if(view.pinned||!geometry)return;
        hover=nearest(availablePoints(),eventTime(event,canvas,geometry))?.t??null;draw();});
      canvas.addEventListener('pointerleave',()=>{if(!view.pinned){hover=null;draw();}});
      canvas.addEventListener('click',event=>{if(geometry)pin(eventTime(event,canvas,geometry));});
      canvas.addEventListener('keydown',event=>{if(event.key==='Escape'){view.pinned=null;draw();return;}
        if(event.key==='Enter'||event.key===' '){event.preventDefault();pin(cursorTime());}
        if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const points=availablePoints(),current=nearest(points,cursorTime());
          const next=points[clamp(points.indexOf(current)+(event.key==='ArrowLeft'?-1:1),0,points.length-1)];
          if(view.pinned)pin(next.t);else{hover=next.t;draw();}}});
    }
    const overview=$('historyOverview');
    overview.addEventListener('pointerdown',event=>{if(!overviewGeometry||event.button!==0)return;
      const g=overviewGeometry,p=period(view,getModel().state),rect=overview.getBoundingClientRect(),x=event.clientX-(rect.left||0);
      const a=g.left+(p.start-g.oldest)/Math.max(1,g.latest-g.oldest)*(g.right-g.left),b=g.left+(p.end-g.oldest)/Math.max(1,g.latest-g.oldest)*(g.right-g.left);
      const time=g.oldest+clamp((x-g.left)/(g.right-g.left),0,1)*(g.latest-g.oldest);
      brush={time,start:p.start,end:p.end,mode:Math.abs(x-a)<9?'start':Math.abs(x-b)<9?'end':x>a&&x<b?'pan':'select'};
      overview.setPointerCapture?.(event.pointerId);event.preventDefault();
    });
    overview.addEventListener('pointermove',event=>{if(!brush||!overviewGeometry)return;
      const g=overviewGeometry,rect=overview.getBoundingClientRect(),time=g.oldest+clamp((event.clientX-(rect.left||0)-g.left)/(g.right-g.left),0,1)*(g.latest-g.oldest);
      if(brush.mode==='start')setPeriod(Math.min(time,brush.end-1),brush.end);
      else if(brush.mode==='end')setPeriod(brush.start,Math.max(time,brush.start+1));
      else if(brush.mode==='select')setPeriod(Math.min(time,brush.time),Math.max(time,brush.time));
      else{const width=brush.end-brush.start,start=clamp(brush.start+time-brush.time,g.oldest,Math.max(g.oldest,g.latest-width));setPeriod(start,start+width);}
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture'])overview.addEventListener(event,()=>{brush=null;});
    $('historySearch').addEventListener('input',updateSearch);$('historyAdd').addEventListener('click',addVariable);
    $('historyVariable').addEventListener('dblclick',addVariable);
    $('historyVariable').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addVariable();}});
    $('historyClear').addEventListener('click',()=>{view.traces=[];custom();renderSelection();draw();});
    $('traceSet').addEventListener('change',()=>applyPreset());
    $('historyGv').addEventListener('change',()=>{onGv(Number($('historyGv').value)||1);if($('traceSet').value!=='custom')applyPreset();});
    $('historyWindow').addEventListener('change',chooseWindow);
    $('historyPrevious').addEventListener('click',()=>movePeriod(-1));$('historyNext').addEventListener('click',()=>movePeriod(1));
    $('historyLive').addEventListener('click',()=>{periodEditing.clear();view.following=true;status('');draw();});
    function applyPeriodFields(){
      const start=parseTime($('historyStart').value),end=parseTime($('historyEnd').value);
      if(start===null||end===null||end<start){status('Saisissez un début et une fin au format HH:MM:SS, dans cet ordre.',true);return;}
      setPeriod(start,end);
    }
    for(const id of ['historyStart','historyEnd']){
      $(id).addEventListener('input',()=>periodEditing.add(id));
      $(id).addEventListener('change',applyPeriodFields);
      $(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyPeriodFields();}});
    }
    $('historyApplyPeriod').addEventListener('click',applyPeriodFields);
    $('historyStartRange').addEventListener('input',e=>{const p=period(view,getModel().state);setPeriod(Math.min(Number(e.target.value),p.end-1),p.end);});
    $('historyEndRange').addEventListener('input',e=>{const p=period(view,getModel().state);setPeriod(p.start,Math.max(Number(e.target.value),p.start+1));});
    $('historyPin').addEventListener('click',()=>pin(cursorTime()));
    $('historyUnpin').addEventListener('click',()=>{view.pinned=null;hover=null;draw();});
    $('historyCopy').addEventListener('click',copy);
    $('reactivityScale').addEventListener('change',()=>{view.reactivity.mode=$('reactivityScale').value;
      for(const id of ['reactivityMin','reactivityMax'])$(id).disabled=view.reactivity.mode==='adaptive';draw();});
    for(const id of ['reactivityMin','reactivityMax'])$(id).addEventListener('input',()=>{
      const min=Number($('reactivityMin').value),max=Number($('reactivityMax').value);
      if($('reactivityMin').value===''||$('reactivityMax').value===''||!Number.isFinite(min)||!Number.isFinite(max)||min>=max){status('Bornes de réactivité invalides.',true);return;}
      view.reactivity.min=min;view.reactivity.max=max;status('');draw();});
    function save(){return JSON.parse(JSON.stringify(view));}
    function restore(saved,legacy={}){
      if(saved){validate(saved,new Set(defs.map(d=>d.id)));Object.assign(view,JSON.parse(JSON.stringify(saved)));}
      else{view.following=legacy.historyFollowing??true;view.duration=Number(legacy.historyWindow)||300;
        view.end=legacy.historyEndS??null;view.start=Math.max(0,(view.end||0)-view.duration);view.pinned=null;
        view.traces=(presets(legacy.selectedGv||1)[legacy.traceSet]||presets().powers).map((id,i)=>({...trace(byId.get(id)),color:colors[i]}));}
      hover=null;brush=null;periodEditing.clear();renderSelection();$('reactivityScale').value=view.reactivity.mode;
      $('reactivityMin').value=view.reactivity.min;$('reactivityMax').value=view.reactivity.max;
      for(const id of ['reactivityMin','reactivityMax'])$(id).disabled=view.reactivity.mode==='adaptive';
    }
    function reset(){view.following=true;view.start=0;view.end=null;view.pinned=null;hover=null;brush=null;periodEditing.clear();draw();}
    view.traces=presets().powers.map((id,i)=>({...trace(byId.get(id)),color:colors[i]}));renderSelection();
    return {draw,save,restore,reset,applyPreset,defs,get view(){return view;}};
  }
  function validate(saved,ids){
    if(!saved||!Array.isArray(saved.traces)||saved.traces.length>32||typeof saved.following!=='boolean'
      ||!Number.isFinite(saved.duration)||saved.duration<1||saved.duration>1e9
      ||!Number.isFinite(saved.start)||saved.start<0||saved.end!==null&&(!Number.isFinite(saved.end)||saved.end<saved.start))
      throw new Error('Sélection de graphique invalide.');
    const selected=new Set();
    for(const o of saved.traces){if(typeof o.id!=='string'||ids&&!ids.has(o.id)||selected.has(o.id)
      ||typeof o.visible!=='boolean'||!['adaptive','fixed'].includes(o.mode)||!Number.isFinite(o.min)||!Number.isFinite(o.max)
      ||o.min>=o.max||!/^#[\da-f]{6}$/i.test(o.color))throw new Error('Courbe ou échelle invalide.');selected.add(o.id);}
    const r=saved.reactivity;if(!r||!['adaptive','fixed'].includes(r.mode)||!Number.isFinite(r.min)||!Number.isFinite(r.max)||r.min>=r.max)
      throw new Error('Échelle de réactivité invalide.');
    if(saved.pinned!==null&&(!saved.pinned||!Number.isFinite(saved.pinned.time)||saved.pinned.time<0
      ||!saved.pinned.values||Object.values(saved.pinned.values).some(v=>v!==null&&!Number.isFinite(v))))
      throw new Error('Lecture figée invalide.');
    return saved;
  }
  return {catalog,presets,search,trace,nearest,rangeFor,period,timeLabel,parseTime,tsv,validate,create};
});
