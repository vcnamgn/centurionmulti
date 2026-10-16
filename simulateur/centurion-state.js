/* Sauvegarde locale d'une partie complète. Aucune exécution de code importé. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.CenturionState=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  const History=typeof module==='object'&&module.exports?require('./centurion-history.js'):window.CenturionHistory;
  const PzrCommands=typeof module==='object'&&module.exports?require('./centurion-cc-pzr.js'):window.CenturionPzrCommands;
  const Auto=typeof module==='object'&&module.exports?require('./centurion-auto.js'):window.CenturionAuto;
  const FORMAT="Centurion-State",VERSION=1,REVISION="20261016-pzr-energy-v12";
  const MAX_STATE_BYTES=160*1024*1024;
  const COMPATIBLE_REVISIONS=["20261008-pzr-v2","20261008-pzr-v3","20261008-breche-v4","20261008-gv-breches-v5","20261008-ris-inertie-v6","20261008-gmpp-niveau-v7","20261009-pzr-breche-v8","20261009-consignes-v9","20261009-charge-v10","20261015-equipment-faults-v11"];
  const LEGACY_REVISION="20261007-state-v1";
  const clone=value=>JSON.parse(JSON.stringify(value));
  function checkJson(value,path="fichier",depth=0){
    if(depth>30)throw new Error(`${path} : imbrication excessive.`);
    if(typeof value==="number"&&!Number.isFinite(value))throw new Error(`${path} : nombre non fini.`);
    if(value===null||["string","number","boolean"].includes(typeof value))return;
    if(!value||typeof value!=="object")throw new Error(`${path} : valeur invalide.`);
    for(const [key,item] of Object.entries(value)){
      if(["__proto__","prototype","constructor"].includes(key))throw new Error(`${path} : clé interdite.`);
      checkJson(item,`${path}.${key}`,depth+1);
    }
  }
  function sameShape(value,example,path){
    if(example===null){if(value===undefined)throw new Error(`${path} : valeur absente.`);return;}
    if(Array.isArray(example)){
      if(!Array.isArray(value)||example.length&&value.length!==example.length)
        throw new Error(`${path} : taille de tableau incompatible.`);
      example.forEach((item,i)=>sameShape(value[i],item,`${path}[${i}]`));return;
    }
    if(typeof example==="object"){
      if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${path} : objet attendu.`);
      for(const [key,item] of Object.entries(example))sameShape(value[key],item,`${path}.${key}`);
      return;
    }
    if(typeof value!==typeof example)throw new Error(`${path} : type incompatible.`);
  }
  function validateModel(E,model){
    checkJson(model);const template=E.make();
    // Les tuyaux, événements et historiques ont une longueur variable.
    template.state.rcvPipe=[];template.state.risPipe=[];
    // Pente numérique ou null pour la commande instantanée.
    template.controls.manualTurbineRatePctMin=null;
    for(const ramp of Object.values(template.controls.setpointRamps))ramp.rate=null;
    sameShape(model,template,"modèle");
    const s=model.state,u=model.controls;
    const range=(value,min,max,label)=>{
      if(typeof value!=="number"||!Number.isFinite(value)||value<min||value>max)
        throw new Error(`${label} : valeur hors domaine.`);
    };
    for(const [id,fault] of Object.entries(u.equipmentFaults)){
      const equipment=E.FAULT_EQUIPMENT.find(item=>item.id===id);
      if(!equipment||!fault||!equipment.modes.includes(fault.mode))throw new Error("Défaillance d’équipement invalide.");
      range(fault.value,0,equipment.max,`Défaillance ${id}`);
      range(fault.at,0,s.time,`Date de défaillance ${id}`);
    }
    range(s.time,0,1e9,"Horloge");range(s.primaryMassKg,1,1e8,"Masse primaire");
    range(s.pressureBar,1,E.C.primaryPressureMaxBar,"Pression primaire");
    range(s.risPumpSpeedFraction,0,1,"Vitesse des pompes RIS");
    s.loops.forEach((loop,i)=>range(loop.forcedPrimingFraction,0,1,`Disponibilité d'aspiration GMPP ${i+1}`));
    range(u.breakAreaCm2,0,2000,"Section de brèche");
    if(s.breakAreaCm2!==u.breakAreaCm2||s.breakLoop!==u.breakLoop||s.breakBranch!==u.breakBranch)
      throw new Error("La brèche physique et sa commande sont incohérentes.");
    s.gv.forEach((g,i)=>{
      range(u.gvSecondaryBreakAreaCm2[i],0,2000,`Section de brèche GV ${i+1}`);
      if(g.secondaryBreakAreaCm2!==u.gvSecondaryBreakAreaCm2[i])
        throw new Error(`La brèche vapeur du GV ${i+1} et sa commande sont incohérentes.`);
      for(const key of ["secondaryBreakKgS","secondaryBreakReleasedKg","secondaryBreakEnergyJ"])
        range(g[key],0,1e15,`GV ${i+1}.${key}`);
    });
    for(const name of E.ROD_NAMES)range(s.rods[name],0,260,`Position ${name}`);
    if(!E.TURBINE_MANUAL_RATES.includes(u.manualTurbineRatePctMin))throw new Error("Pente PTUR invalide.");
    if(u.manualTurbineTargetPct!==null)range(u.manualTurbineTargetPct,0,110,"Cible PTUR manuelle");
    for(const [name,config] of Object.entries(E.SETPOINT_CONTROLS)){
      range(u[config.key],config.min,config.max,`Consigne ${name}`);
      const ramp=u.setpointRamps[name];
      if(!E.SETPOINT_RATES.includes(ramp.rate))throw new Error(`Pente ${name} invalide.`);
      if(ramp.target!==null)range(ramp.target,config.min,config.max,`Cible ${name}`);
    }
    if(![null,true,false].includes(u.rcvLetdownCloseGraph))throw new Error("Ordre de fermeture RCV invalide.");
    if(u.prefGraphBar!==null)range(u.prefGraphBar,1,180,"PREF du graphe");
    for(const [key,values] of Object.entries({risPumpMode:["auto","on","off"],risSourceMode:["direct","recirculation"],
      breakBranch:["froide","chaude"],campaign:["debut","milieu","fin"],halfCycle:["premiere","seconde"],
      rMode:["manual","graph"],rcvInjectionMode:["off","dilution","borication"]}))
      if(!values.includes(u[key]))throw new Error(`Commande ${key} invalide.`);
    if(![null,"safe","melted"].includes(s.endState))throw new Error("Verdict invalide.");
    for(const key of ["rcvPipe","risPipe"]){
      if(s[key].length>10000)throw new Error("Tuyauterie trop volumineuse.");
      for(const p of s[key]){
        for(const k of ["at","massKg","boronPpm"])range(p[k],0,1e12,`${key}.${k}`);
        range(p.tempC,0,3000,`${key}.tempC`);
      }
    }
    if(s.history.length>28801||s.events.length>100000)throw new Error("Historique trop volumineux.");
    let previous=-1;
    for(const p of s.history){
      range(p.t,previous,s.time+1e-6,"Date de mesure");previous=p.t;
      for(const key of ["tavg","pressure","power","dpax"])
        if(typeof p[key]!=="number")throw new Error(`Historique : ${key} absent.`);
    }
    // Vérifier les valeurs nullables avant qu'elles n'entrent dans une équation.
    for(const [key,value] of Object.entries(u))if(template.controls[key]===null){
      if(key==="rcvLetdownCloseGraph"){
        if(![null,true,false].includes(value))throw new Error(`Commande ${key} invalide.`);
      }else if(key==="rcvInjectionGraphMode"){
        if(![null,"off","dilution","borication"].includes(value))throw new Error(`Commande ${key} invalide.`);
      }else if(value!==null&&typeof value!=="number")throw new Error(`Commande ${key} invalide.`);
    }
    for(const key of ["tripAt","tripDemandAt","risAt","risDemandAt","asgAt","asgDemandAt","voltageLostAt",
      "primaryPumpStopAt","normalShutdownAt"])
      if(s[key]!==null)range(s[key],0,s.time,`Date ${key}`);
    return model;
  }
  function validateEditor(saved,mode){
    if(!saved||saved.mode!==mode||typeof saved.enabled!=="boolean"||!saved.graph
      ||saved.graph.format!=="SimuREP-Regulation"||saved.graph.version!==1)
      throw new Error(`Sauvegarde CC-${mode} incompatible.`);
    const {nodes,links}=saved.graph;
    if(!Array.isArray(nodes)||nodes.length>1000||!Array.isArray(links)||links.length>5000
      ||!Array.isArray(saved.runtime))throw new Error(`Graphe CC-${mode} invalide.`);
    const ids=new Set(nodes.map(n=>n.id));
    if(ids.size!==nodes.length||saved.runtime.some(([id,state])=>!ids.has(id)||!state||typeof state!=="object"))
      throw new Error(`Mémoires CC-${mode} invalides.`);
  }
  function migrateLegacy(E,raw){
    const s=raw.model.state,u=raw.model.controls;
    const rho=E.liquidWaterDensityKgM3(s.tavgC,s.pressureBar);
    s.breakDensityKgM3=rho;
    s.inventory=E.cppInventory(s.primaryMassKg-s.vaporMassKg,s.tavgC,s.pressureBar);
    s.pzrLevelPct=s.inventory.components.pzr.fillPct;s.coveragePct=s.inventory.coveragePct;
    for(const loop of s.loops){
      loop.primingFraction=s.inventory.loopPriming[loop.index-1];
      loop.coreCoverageFraction=s.coveragePct/100;
      if(loop.primingFraction===0)loop.naturalFlowKgS=0;
      loop.flowKgS=loop.forcedFlowKgS+loop.naturalFlowKgS;
    }
    s.coreFlowKgS=s.loops.reduce((n,l)=>n+l.flowKgS,0)+s.risCoreKgS;
    s.coreFlowFraction=Math.min(1,s.loops.reduce((n,l)=>n+l.flowKgS,0)/E.C.nominalPrimaryFlowKgS);
    s.rcvChargeM3h=s.rcvChargeKgS*3600/rho;
    s.rcvDeliveredM3h=s.rcvDeliveredKgS*3600
      /E.liquidWaterDensityKgM3(s.flowProperties.charge.tempC,s.pressureBar);
    s.rcvDemandM3h=u.rcvChargeGraphM3h??u.rcvChargeM3h;
    s.rcvCapacityM3h=E.rcvPumpCapacityM3h(s.pressureBar);
    s.pzrThermalPressureBar=s.pressureBar;s.pzrPistonBarS=0;
    s.reliefSteamKgS=s.reliefKgS;s.reliefLiquidKgS=0;
    for(const r of raw.certificateArchive?.records??[]){
      const v=r.snapshot;
      v.inventory=E.cppInventory(v.inventory.liquidMassKg,v.tavgC,v.pressure);
      v.pzrLevel=v.inventory.components.pzr.fillPct;
      v.rcvCapacityM3h=E.rcvPumpCapacityM3h(v.pressure);v.rcvDemandM3h=v.chargeM3h;
      v.pzrPistonBarS=0;
      v.massBalance.reliefSteamKgS=v.massBalance.reliefKgS;v.massBalance.reliefLiquidKgS=0;
    }
    raw.engineRevision=REVISION;
  }
  function read(E,raw){
    if(typeof raw==="string"){
      if(raw.length>MAX_STATE_BYTES)throw new Error("Fichier trop volumineux (160 Mo maximum).");
      raw=JSON.parse(raw);
    }
    checkJson(raw);
    if(raw.format!==FORMAT||raw.version!==VERSION||![REVISION,...COMPATIBLE_REVISIONS,LEGACY_REVISION].includes(raw.engineRevision))
      throw new Error("Ce fichier n'est pas une sauvegarde d'état Centurion compatible.");
    raw=clone(raw);
    // Anciennes sauvegardes : aucune rampe en attente, pente par défaut de 5 %/min.
    if(raw.model?.controls){
      if(raw.model.controls.manualTurbineTargetPct===undefined)raw.model.controls.manualTurbineTargetPct=null;
      if(raw.model.controls.manualTurbineRatePctMin===undefined)raw.model.controls.manualTurbineRatePctMin=5;
    }
    const oldRevision=raw.engineRevision!==REVISION;
    if(oldRevision&&raw.model?.state){
      const s=raw.model.state;
      // Le bilan PZR n'était pas enregistré : référence relative à la reprise,
      // sans réécrire l'énergie primaire, les stocks ou les historiques passés.
      if(s.pzrEnergyOffsetJ===undefined)s.pzrEnergyOffsetJ=0;
      if(s.pzrHeatToPrimaryMW===undefined)s.pzrHeatToPrimaryMW=0;
      if(s.pzrHeatReserveMW===undefined)s.pzrHeatReserveMW=0;
      if(s.sprayCoolingKW===undefined)s.sprayCoolingKW=(s.sprayFlowKgS||0)*E.C.primaryCpJkgK
        *Math.max(0,E.saturationTemperatureC(s.pressureBar)-(s.loops[0].coldC+s.loops[1].coldC)/2)/1000;
    }
    if(oldRevision&&raw.model?.controls?.equipmentFaults===undefined)raw.model.controls.equipmentFaults={};
    if(oldRevision){
      const u=raw.model.controls,s=raw.model.state;
      const defaults={pressureSetpointBar:155,pressureSetpointManual:false,
        pzrLevelSetpointPct:s.nrefPct,pzrLevelSetpointManual:false,
        setpointRamps:{gcta:{target:null,rate:5},pressure:{target:null,rate:5},level:{target:null,rate:5}},
        prefGraphBar:null,rcvLetdownCloseGraph:null};
      for(const [key,value] of Object.entries(defaults))if(u[key]===undefined)u[key]=value;
      if(s.prefBar===undefined)s.prefBar=155;
      if(raw.editors?.regul?.graph)PzrCommands.upgrade(raw.editors.regul.graph);
    }
    if(raw.engineRevision===LEGACY_REVISION)migrateLegacy(E,raw);
    if(oldRevision){
      // Une partie ancienne conserve ses stocks et ses débits en cours.
      // Les pompes déjà sollicitées sont reprises à leur régime précédent.
      const s=raw.model.state,u=raw.model.controls;
      const migrateForcedPriming=(loops,inventory)=>{
        const fraction=Math.max(0,Math.min(1,(inventory.loopLevelM-E.C.primaryPumpLowLevelM)/E.C.primaryPumpLowLevelBandM));
        for(const loop of loops)if(loop.forcedPrimingFraction===undefined)loop.forcedPrimingFraction=fraction;
      };
      migrateForcedPriming(s.loops,s.inventory);
      for(const r of raw.certificateArchive?.records??[]){
        migrateForcedPriming(r.snapshot.loops,r.snapshot.inventory);
        migrateForcedPriming(r.snapshot.primaryFlow.loops,r.snapshot.inventory);
      }
      if(s.risPumpSpeedFraction===undefined)s.risPumpSpeedFraction=
        s.risEnabled&&u.risPumpMode!=="off"&&(s.risAt!==null||u.risPumpMode==="on")?1:0;
      for(const r of raw.certificateArchive?.records??[])
        if(r.snapshot.risPumpSpeedFraction===undefined)r.snapshot.risPumpSpeedFraction=
          r.snapshot.risMpKgS+r.snapshot.risBpKgS>0?1:0;
      // Ajouter seulement les nouvelles mesures secondaires. Stocks, tuyaux
      // et arrêt GMPP déjà mémorisé restent ceux de la partie enregistrée.
      const migrateGv=g=>{
        for(const key of ["secondaryBreakAreaCm2","secondaryBreakKgS",
          "secondaryBreakReleasedKg","secondaryBreakEnergyJ"])
          if(g[key]===undefined)g[key]=0;
        if(g.waterMassRateKgS===undefined)g.waterMassRateKgS=g.feedKgS+g.asgKgS-g.steamKgS;
      };
      if(raw.model.controls.gvSecondaryBreakAreaCm2===undefined)
        raw.model.controls.gvSecondaryBreakAreaCm2=Array(4).fill(0);
      raw.model.state.gv.forEach(migrateGv);
      for(const r of raw.certificateArchive?.records??[]){
        r.snapshot.gvAll.forEach(migrateGv);migrateGv(r.snapshot.gvState);
      }
      raw.engineRevision=REVISION;
    }
    validateModel(E,raw.model);
    for(const mode of ["regul","protect"])validateEditor(raw.editors?.[mode],mode);
    if(!raw.ui||![1,5,20,50,200].includes(raw.ui.speed)
      ||!Number.isInteger(raw.ui.selectedGv)||raw.ui.selectedGv<1||raw.ui.selectedGv>4)
      throw new Error("Réglages d'affichage invalides.");
    if(!["rcp","core","pt","inventory","pzr","rods","gv"].includes(raw.ui.diagram))
      throw new Error("Synoptique invalide.");
    if(!["synoptiques","graphiques","regulation","protection","initiateurs","transitoires","conduiteAuto","modele"].includes(raw.ui.activeView)
      ||typeof raw.ui.historyFollowing!=="boolean"
      ||raw.ui.historyEndS!==null&&typeof raw.ui.historyEndS!=="number"
      ||!raw.ui.alarmLimits||typeof raw.ui.alarmLimits!=="object")throw new Error("Vue ou alarmes invalides.");
    for(const id of ["historyWindow","coreTrailWindow","ptTrailWindow"])
      if(!["300","1800","3600","14400",...(id==='historyWindow'?['custom']:[])].includes(raw.ui[id]))throw new Error("Fenêtre d'historique invalide.");
    if(!["powers","temperatures","secondaryTemperatures","pressures","levels","rods","flows","steam","custom"].includes(raw.ui.traceSet))
      throw new Error("Traces invalides.");
    if(raw.ui.chart){
      History.validate(raw.ui.chart,new Set(History.catalog(E,raw.model).map(d=>d.id)));
      if(raw.ui.chart.pinned?.time>raw.model.state.time+1e-6)throw new Error("Instant de lecture futur.");
    }else if(raw.ui.traceSet==='custom'||raw.ui.historyWindow==='custom')throw new Error("Sélection personnalisée absente.");
    if(raw.ui.autoConduite){
      if(!Auto)throw new Error("Module Conduite Auto absent.");
      Auto.validateSaved(raw.ui.autoConduite,new Set(Auto.measurementCatalog(E,History,raw.model).map(d=>d.id)));
    }
    for(const values of Object.values(raw.ui.alarmLimits))
      if(!Array.isArray(values)||values.length!==4||values.some(v=>v!==null&&typeof v!=="number"))
        throw new Error("Seuils d'alarme invalides.");
    if(raw.certificateArchive){
      const a=raw.certificateArchive;
      if(!Array.isArray(a.records)||a.records.length>7||!a.seen||typeof a.minimum!=="number")
        throw new Error("Archive de certificat invalide.");
      const keys=new Set();
      for(const r of a.records){
        if(!["initial","aar","is","relief","warning","minimum","final"].includes(r.key)||keys.has(r.key)
          ||!["inventory","pzr","core"].includes(r.diagram)||typeof r.label!=="string"
          ||typeof r.time!=="number"||!r.snapshot||!r.core||r.core.shape?.length!==32||r.core.linear?.length!==32)
          throw new Error("Instantané de certificat invalide.");
        const snapshotTemplate=E.instrumentSnapshot(E.make());snapshotTemplate.g3Display=null;
        // Liste de diagnostics RRA variable, distincte des canaux physiques.
        snapshotTemplate.rra.reasons=[];
        sameShape(r.snapshot,snapshotTemplate,"instantané de certificat");
        if(r.snapshot.rra.reasons.length>5||r.snapshot.rra.reasons.some(reason=>typeof reason!=="string"))
          throw new Error("Instantané de certificat : conditions RRA invalides.");
        if(r.time<0||r.time>raw.model.state.time||r.core.shape.some(v=>typeof v!=="number")
          ||r.core.linear.some(v=>typeof v!=="number"))throw new Error("Données du certificat invalides.");
        keys.add(r.key);
      }
    }
    return clone(raw);
  }
  function write(E,model,editors,ui,certificateArchive){
    const save={format:FORMAT,version:VERSION,engineRevision:REVISION,savedAt:new Date().toISOString(),
      model,editors,ui,certificateArchive};
    return read(E,clone(save));
  }
  return {FORMAT,VERSION,REVISION,MAX_STATE_BYTES,checkJson,validateModel,validateEditor,read,write};
});
