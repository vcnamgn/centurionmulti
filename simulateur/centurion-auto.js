/* Conduites séquentielles : données uniquement, temps simulé, commandes du pupitre. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CenturionAuto=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const FORMAT='Centurion-Conduite-Auto',VERSION=1;
  const TYPES=['start','test','ranges','action','info','wait','parallel','end'];
  const OPERATORS=['=','!=','>','>=','<','<='];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,max=240)=>typeof value==='string'&&value.length<=max;
  const identifier=value=>text(value,100)&&/^[\w.:-]+$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
  const DURATION_UNITS={seconds:1,minutes:60,hours:3600};
  function emptyGraph(){return {format:FORMAT,version:VERSION,name:'Ma conduite',nodes:[],links:[]};}
  function node(type,id,x=180,y=80){
    const params=type==='test'?{variable:'pressure',operator:'<=',value:31,tolerance:0.1}
      :type==='ranges'?{variable:'pzrLevel',tolerance:0,ranges:[{label:'Bas',min:0,max:15},{label:'Normal',min:15,max:70},{label:'Haut',min:70,max:100}]}
      :type==='action'?{command:'turbine.target',value:100}
      :type==='info'?{message:'Information de conduite'}
      :type==='wait'?{duration:10,unit:'seconds'}
      :type==='parallel'?{actions:[{type:'action',command:'turbine.target',value:100},{type:'wait',duration:10,unit:'seconds'}]}:{};
    return {id,type,x,y,name:{start:'Nouvelle séquence',test:'Comparaison',ranges:'Plages de mesure',action:'Action',
      info:'Information',wait:'Attente',parallel:'Actions en parallèle',end:'Fin de séquence'}[type],params};
  }
  function ports(n){
    return n.type==='end'?[]:n.type==='test'?['yes','no-left','no-right']
      :n.type==='ranges'?[...n.params.ranges.map((_,i)=>`range:${i}`),'no-left','no-right']:['next'];
  }
  function actionCatalog(){
    const defs=[];
    const add=(id,label,unit,min,max,options=null)=>defs.push({id,label,unit,min,max,options});
    const bool=(id,label)=>add(id,label,'TOR',0,1,[[1,'En service / oui'],[0,'Hors service / non']]);
    const rate=(id,label,gcta=false,unit='%/min')=>add(id,label,unit,0,200,
      [...(gcta?[0.25]:[]),0.5,1,2,5,10,200].map(v=>[v,String(v).replace('.',',')+' '+unit]).concat([[null,'Instantanée']]));
    add('turbine.target','PTUR · puissance turbine demandée','%',0,110);rate('turbine.rate','PTUR · pente');
    bool('regulation.enabled','Activer les régulations CC');bool('protection.enabled','Activer les protections CC');
    add('protection.disable','Désactiver les protections','',0,0,[[1,'Désactiver']]);
    bool('rods.manual','Groupe R en manuel');add('rods.R','Position du groupe R','pas extraits',0,260);
    add('gcp.calibration','Décalibrage GCP','% PN',0,8);
    add('rods.all','Tous les groupes, y compris arrêt','pas',0,260,[[0,'Descendre à 0 pas'],[260,'Lever à 260 pas'],[null,'Retour à la conduite']]);
    add('gv.level','Consigne niveau GV','%',0,100);
    for(const [id,label,min,max,unit] of [['gcta','Pression d’ouverture GCT-A',1,100,'bar'],['pressure','Consigne pression primaire',1,180,'bar'],['level','Consigne niveau PZR',0,100,'%']]){
      add(`setpoint.${id}`,label,unit,min,max);rate(`rate.${id}`,label+' · rampe',id==='gcta',unit+'/min');
      if(id!=='gcta')bool(`setpoint.${id}.manual`,label+' · référence manuelle');
    }
    for(let i=1;i<=4;i++){
      add(`gv.${i}.are`,`ARE · ouverture GV${i}`,'%',0,100);bool(`gv.${i}.vvp`,`VVP ${i}20VV · ouverture`);
      bool(`asg.${i}`,`Alimentation ASG GV${i}`);
    }
    add('heater','Puissance chaufferettes','kW',0,2500);add('spray','Aspersion réglante · ouverture','%',0,100);
    add('spray.aux','Aspersion auxiliaire RCV','m³/h',0,8);
    for(let i=1;i<=3;i++){bool(`relief.${i}`,`Soupapes PZR · étage ${i}`);bool(`rcv.orifice.${i}`,`Orifice RCV ${i}`);}
    add('rcv.charge','Charge RCV demandée','m³/h',0,60);add('rcv.boron','CB manuelle de charge RCV','ppm',0,7000);
    add('rcv.injection','Dilution / borication par la charge','',0,0,[['off','Arrêter'],['dilution','Dilution · 0 ppm'],['borication','Borication · 7 000 ppm']]);
    bool('asg.manual','ASG en manuel');bool('asg.A','Voie ASG A · GV1 et GV2');bool('asg.B','Voie ASG B · GV3 et GV4');
    add('asg.start','Ordre de démarrage ASG','',0,0,[[1,'Démarrer']]);
    add('ris.mode','Pompes RIS','',0,0,[['on','Démarrer'],['off','Arrêter'],['auto','Sur demande IS']]);
    add('ris.source','Source RIS','',0,0,[['direct','Injection directe PTR'],['recirculation','Puisards']]);
    add('gmpp.stop','Déclenchement des quatre GMPP','',0,0,[[1,'Déclencher']]);
    add('rra.connect','Connexion du RRA','',0,0,[[1,'Connecter si conditions remplies']]);
    return defs;
  }
  function measurementCatalog(E,H,model){
    return [...H.catalog(E,model),
      ...[['RP','Réacteur en production'],['AN/GV','Arrêt normal sur GV'],['CIA','Conduite incidentelle / accidentelle']]
        .map(([code,label])=>({id:'operating.'+code,label:'État · '+label,tag:code,unit:'TOR',group:'État',
          value:(_point,m)=>Number(E.reactorOperatingState(m.state).code===code)})),
      {id:'rra.allowed',label:'Conditions de connexion du RRA remplies',tag:'RRA',unit:'TOR',group:'État',value:(_p,m)=>Number(E.rraConditions(m.state).allowed)},
      {id:'time',label:'Durée simulée',tag:'TEMPS',unit:'s',group:'État',value:(_p,m)=>m.state.time}];
  }
  function validateAction(a,commands){
    if(!a||!['action','info','wait'].includes(a.type))throw Error('Type d’action parallèle invalide.');
    if(a.type==='action'){
      const def=commands.get(a.command);
      if(!def)throw Error('Commande inconnue : '+a.command);
      if(def.options?!def.options.some(([v])=>v===a.value):!finite(a.value)||a.value<def.min||a.value>def.max)
        throw Error('Valeur de commande invalide : '+def.label);
    }else if(a.type==='info'){
      if(!text(a.message,2000))throw Error('Texte d’information invalide.');
    }else if(!finite(a.duration)||a.duration<0||a.duration>1e6||!Object.hasOwn(DURATION_UNITS,a.unit))throw Error('Durée d’attente invalide.');
  }
  function validate(raw,variables=null){
    if(typeof raw==='string'){
      if(raw.length>2e6)throw Error('Conduite trop volumineuse (2 Mo maximum).');
      raw=JSON.parse(raw);
    }
    if(!raw||raw.format!==FORMAT||raw.version!==VERSION||!text(raw.name,100)
      ||!Array.isArray(raw.nodes)||raw.nodes.length>500||!Array.isArray(raw.links)||raw.links.length>1500)
      throw Error('Fichier de conduite incompatible.');
    const graph=clone(raw),nodes=new Map(),starts=new Set(),commands=new Map(actionCatalog().map(d=>[d.id,d]));
    for(const n of graph.nodes){
      if(!identifier(n.id)||nodes.has(n.id)||!TYPES.includes(n.type)||!text(n.name,100)||!n.name.trim()
        ||!finite(n.x)||!finite(n.y)||Math.abs(n.x)>20000||Math.abs(n.y)>20000||!n.params||typeof n.params!=='object')throw Error('Boîte de conduite invalide.');
      nodes.set(n.id,n);const p=n.params;
      if(n.type==='start'){
        if(starts.has(n.name.trim().toLowerCase()))throw Error('Les départs doivent avoir des noms distincts.');
        starts.add(n.name.trim().toLowerCase());
      }
      if(['test','ranges'].includes(n.type)){
        if(!text(p.variable,120)||variables&&!variables.has(p.variable)||!finite(p.tolerance)||p.tolerance<0)throw Error('Mesure ou tolérance invalide : '+n.name);
        if(n.type==='test'&&(!OPERATORS.includes(p.operator)||!finite(p.value)))throw Error('Comparaison invalide.');
        if(n.type==='ranges'){
          if(!Array.isArray(p.ranges)||!p.ranges.length||p.ranges.length>8)throw Error('Une règle doit avoir de 1 à 8 plages.');
          p.ranges.forEach((r,i)=>{
            if(!text(r.label,60)||!finite(r.min)||!finite(r.max)||r.min>=r.max||i&&r.min<p.ranges[i-1].max)throw Error('Plages non ordonnées ou superposées.');
          });
        }
      }
      if(['action','info','wait'].includes(n.type))validateAction({...p,type:n.type},commands);
      if(n.type==='parallel'){
        if(!Array.isArray(p.actions)||!p.actions.length||p.actions.length>24)throw Error('Une boîte parallèle doit contenir de 1 à 24 actions.');
        p.actions.forEach(a=>validateAction(a,commands));
        const seen=new Set();for(const a of p.actions.filter(a=>a.type==='action')){
          if(seen.has(a.command))throw Error('Deux ordres parallèles ciblent la même commande.');seen.add(a.command);
        }
      }
    }
    const used=new Set(),ids=new Set();
    for(const link of graph.links){
      const from=nodes.get(link.from),to=nodes.get(link.to),key=link.from+'/'+link.port;
      if(!identifier(link.id)||ids.has(link.id)||!from||!to||to.type==='start'||!ports(from).includes(link.port)||used.has(key))throw Error('Liaison invalide ou sortie déjà reliée.');
      ids.add(link.id);used.add(key);
    }
    for(const n of graph.nodes)if(n.type==='test'&&used.has(n.id+'/no-left')&&used.has(n.id+'/no-right'))
      throw Error('Reliez une seule sortie négative par comparaison (gauche ou droite).');
    return graph;
  }
  function sequences(graph){return graph.nodes.filter(n=>n.type==='start').map(n=>({id:n.id,name:n.name}));}
  function compare(value,operator,target,tolerance=0){
    if(!finite(value))throw Error('La mesure sélectionnée est indisponible.');
    return operator==='='?Math.abs(value-target)<=tolerance:operator==='!='?Math.abs(value-target)>tolerance
      :operator==='>'?value>target+tolerance:operator==='>='?value>=target-tolerance
        :operator==='<'?value<target-tolerance:value<=target+tolerance;
  }
  function classify(value,ranges,tolerance=0){
    if(!finite(value))throw Error('La mesure sélectionnée est indisponible.');
    if(value<ranges[0].min-tolerance)return 'no-left';
    if(value>ranges.at(-1).max+tolerance)return 'no-right';
    for(let i=0;i<ranges.length;i++){
      const r=ranges[i],low=r.min-(i===0?tolerance:0),high=r.max+(i===ranges.length-1?tolerance:0);
      if(value>=low&&(value<high||i===ranges.length-1&&value<=high))return `range:${i}`;
    }
    return 'no-right';
  }
  function idle(){return {status:'idle',sequence:null,current:null,entered:false,elapsed:0,totalElapsed:0,remaining:0,
    message:'Aucune séquence active',error:null,lastValue:null,lastPort:null,history:[]};}
  function start(graph,id,variables=null){
    validate(graph,variables);const n=graph.nodes.find(n=>n.id===id&&n.type==='start');
    if(!n)throw Error('Sélectionnez un départ nommé.');
    return {...idle(),status:'running',sequence:id,current:id,message:n.name};
  }
  function record(runtime,n,event){
    runtime.history.push({node:n.id,name:n.name,event,time:runtime.totalElapsed});
    if(runtime.history.length>100)runtime.history.shift();
  }
  function tick(runtime,graph,dt,read,execute){
    if(runtime.status!=='running'||!finite(dt)||dt<=0)return runtime;
    const n=graph.nodes.find(n=>n.id===runtime.current);
    if(!n){runtime.status='error';runtime.error='Boîte active absente.';return runtime;}
    runtime.totalElapsed+=dt;runtime.message=n.name;
    try{
      if(!runtime.entered){
        runtime.entered=true;runtime.elapsed=0;record(runtime,n,'entrée');
        const actions=n.type==='parallel'?n.params.actions:['action','info','wait'].includes(n.type)?[{...n.params,type:n.type}]:[];
        // Les commandes sont validées ensemble avant application du lot.
        for(const a of actions.filter(a=>a.type==='action'))execute(a.command,a.value,true);
        for(const a of actions){
          if(a.type==='action')execute(a.command,a.value,false);
          if(a.type==='info'){runtime.message=a.message;record(runtime,n,a.message);}
        }
        runtime.remaining=Math.max(0,...actions.filter(a=>a.type==='wait').map(a=>a.duration*DURATION_UNITS[a.unit]));
      }
      runtime.elapsed+=dt;
      let port='next';
      if(n.type==='end'){runtime.status='complete';runtime.message=n.name;record(runtime,n,'fin');return runtime;}
      if(n.type==='test'){
        runtime.lastValue=read(n.params.variable);
        const yes=compare(runtime.lastValue,n.params.operator,n.params.value,n.params.tolerance);
        port=yes?'yes':graph.links.some(l=>l.from===n.id&&l.port==='no-left')?'no-left':'no-right';
        if(!yes&&!graph.links.some(l=>l.from===n.id&&l.port===port))return runtime;
      }else if(n.type==='ranges'){
        runtime.lastValue=read(n.params.variable);port=classify(runtime.lastValue,n.params.ranges,n.params.tolerance);
        if(!graph.links.some(l=>l.from===n.id&&l.port===port))return runtime;
      }else if(n.type==='wait'||n.type==='parallel'){
        const duration=n.type==='wait'?n.params.duration*DURATION_UNITS[n.params.unit]
          :Math.max(0,...n.params.actions.filter(a=>a.type==='wait').map(a=>a.duration*DURATION_UNITS[a.unit]));
        runtime.remaining=Math.max(0,duration-runtime.elapsed);if(runtime.remaining>1e-8)return runtime;
      }
      runtime.lastPort=port;const link=graph.links.find(l=>l.from===n.id&&l.port===port);
      record(runtime,n,port);
      if(link){runtime.current=link.to;runtime.entered=false;runtime.elapsed=0;runtime.lastValue=null;}
      else {runtime.status='complete';runtime.message='Séquence terminée';}
    }catch(error){runtime.status='error';runtime.error=error.message;runtime.message=error.message;record(runtime,n,'erreur');}
    return runtime;
  }
  function validateSaved(saved,variables=null){
    if(!saved||typeof saved!=='object')throw Error('État de conduite absent.');
    const graph=validate(saved.graph,variables),r=saved.runtime;
    if(!r||!['idle','running','paused','stopped','complete','error'].includes(r.status)
      ||typeof r.entered!=='boolean'||!finite(r.elapsed)||r.elapsed<0||!finite(r.totalElapsed)||r.totalElapsed<0
      ||!finite(r.remaining)||r.remaining<0||!text(r.message,2000)||r.error!==null&&!text(r.error,2000)
      ||r.lastValue!==null&&!finite(r.lastValue)||r.lastPort!==null&&!text(r.lastPort,40)||!Array.isArray(r.history)||r.history.length>100)
      throw Error('Mémoire de conduite invalide.');
    if(r.sequence!==null&&!graph.nodes.some(n=>n.id===r.sequence&&n.type==='start')
      ||r.current!==null&&!graph.nodes.some(n=>n.id===r.current)||['running','paused'].includes(r.status)&&(r.current===null||r.sequence===null))throw Error('Séquence de conduite absente.');
    for(const h of r.history)if(!text(h.node,100)||!text(h.name,100)||!text(h.event,2000)||!finite(h.time)||h.time<0||h.time>r.totalElapsed+1e-8)throw Error('Journal de conduite invalide.');
    return clone({graph,runtime:r});
  }
  function executeCommand(ctx,id,value,checkOnly=false){
    const {E,model}=ctx,u=model.controls,s=model.state,def=actionCatalog().find(d=>d.id===id);
    validateAction({type:'action',command:id,value},new Map(def?[[id,def]]:[]));
    if(s.endState)throw Error('La simulation est terminée.');
    const manualOnly=['heater','spray','rcv.charge'];
    if(ctx.regulationActive&&(manualOnly.includes(id)||/^gv\.\d\.are$/.test(id)))throw Error('Commande pilotée par CC-RÉGUL : désactivez d’abord les régulations.');
    if(id==='rods.R'){
      if(s.tripDemandAt!==null||u.allRodsTargetPas!==null)throw Error('Les grappes sont prises par un ordre prioritaire.');
      if(ctx.regulationActive&&!u.rManualOverride)throw Error('Passez d’abord le groupe R en manuel.');
    }
    if(id==='turbine.target'&&E.isTransientActive(model))throw Error('PTUR est commandée par un transitoire : interrompez ce programme.');
    if(id==='rods.all'&&s.tripDemandAt!==null)throw Error('La chute AAR est prioritaire sur la commande des groupes.');
    if(id==='rcv.injection'&&u.rcvInjectionGraphMode!==null)throw Error('Dilution/borication pilotée par CC-RÉGUL.');
    if(/^asg\.[1-4AB]$/.test(id)&&!u.asgManual)throw Error('Passez d’abord ASG en manuel.');
    if(id==='rra.connect'&&!E.rraConditions(s).allowed)throw Error('Connexion RRA impossible : '+E.rraConditions(s).reasons.join(' ; '));
    if(checkOnly)return;
    if(id==='regulation.enabled')return ctx.setRegulationActive(Boolean(value));
    if(id==='protection.enabled')return ctx.setProtectionActive(Boolean(value));
    if(id==='protection.disable')return ctx.setProtectionActive(false);
    if(id==='turbine.target')return E.setManualTurbineDemand(model,value);
    if(id==='turbine.rate'){u.manualTurbineRatePctMin=value;return;}
    if(id==='rods.manual')return ctx.setRManualOverride(Boolean(value));
    if(id==='rods.R'){u.rManualPas=value;u.rMode='manual';return;}
    if(id==='rods.all')return E.commandAllRods(model,value);
    if(id==='gcp.calibration'){u.gcpCalibrationPct=value;return;}
    if(id==='gv.level'){u.gvLevelSetpointPct=value;return;}
    const set=/^setpoint\.(gcta|pressure|level)$/.exec(id),rate=/^rate\.(gcta|pressure|level)$/.exec(id);
    if(set)return E.setManualSetpoint(model,set[1],value);
    if(rate){u.setpointRamps[rate[1]].rate=value;return;}
    const mode=/^setpoint\.(pressure|level)\.manual$/.exec(id);
    if(mode){const name=mode[1],c=E.SETPOINT_CONTROLS[name];
      if(value)E.setManualSetpoint(model,name,name==='level'?s.nrefPct:s.prefBar);
      else {u[c.manual]=false;u.setpointRamps[name].target=null;}return;}
    const gv=/^gv\.([1-4])\.(are|vvp)$/.exec(id);
    if(gv){u[gv[2]==='are'?'gvManualFeedPct':'gvSteamValvePct'][Number(gv[1])-1]=gv[2]==='are'?value:value?100:0;return;}
    if(id==='heater'){u.manualHeaterKW=value;return;}
    if(id==='spray'){u.manualSprayPct=value;return;}
    if(id==='spray.aux'){u.manualAuxiliarySprayM3h=value;return;}
    const relief=/^relief\.([1-3])$/.exec(id),orifice=/^rcv\.orifice\.([1-3])$/.exec(id);
    if(relief){u.manualReliefStages[Number(relief[1])-1]=Boolean(value);return;}
    if(orifice){u.rcvLetdownOrifices[Number(orifice[1])-1]=Boolean(value);return;}
    if(id==='rcv.charge'){u.rcvChargeM3h=value;return;}
    if(id==='rcv.boron')return E.prepareRcvTank(model,0,value);
    if(id==='rcv.injection')return E.setRcvInjection(model,value);
    if(id==='asg.manual'){u.asgTrainEnabled=s.gv.map(g=>g.asgRunning&&g.levelPct<=90);u.asgManual=Boolean(value);return;}
    if(id==='asg.start'){u.asgManual=false;return E.initiate(model,'asg');}
    const asg=/^asg\.([1-4AB])$/.exec(id);
    if(asg){const indices=asg[1]==='A'?[0,1]:asg[1]==='B'?[2,3]:[Number(asg[1])-1];
      for(const i of indices)u.asgTrainEnabled[i]=Boolean(value)&&s.gv[i].levelPct<=90;return;}
    if(id==='ris.mode')return E.setRisOperation(model,value);
    if(id==='ris.source'){u.risSourceMode=value;return;}
    if(id==='gmpp.stop')return E.tripPrimaryPumps(model);
    if(id==='rra.connect')return E.connectRra(model);
    throw Error('Commande non raccordée : '+id);
  }
  return {FORMAT,VERSION,TYPES,OPERATORS,DURATION_UNITS,emptyGraph,node,ports,actionCatalog,measurementCatalog,validate,sequences,
    compare,classify,idle,start,tick,validateSaved,executeCommand};
});
