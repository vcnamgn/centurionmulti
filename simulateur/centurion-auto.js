/* Conduites séquentielles : données uniquement, temps simulé, commandes du pupitre. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CenturionAuto=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const FORMAT='Centurion-Conduite-Auto',VERSION=3;
  const STEP_DELAYS=[0,1,2,5];
  const TYPES=['start','test','ranges','action','info','wait','parallel','join','end'];
  const OPERATORS=['=','!=','>','>=','<','<='];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const text=(value,max=240)=>typeof value==='string'&&value.length<=max;
  const identifier=value=>text(value,240)&&/^[\w.:-]+$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
  const DURATION_UNITS={seconds:1,minutes:60,hours:3600};
  function emptyGraph(){return {format:FORMAT,version:VERSION,name:'Ma conduite',stepDelayS:2,nodes:[],links:[]};}
  function node(type,id,x=180,y=80){
    const params=type==='test'?{variable:'pressure',operator:'<=',value:31,tolerance:0.1}
      :type==='ranges'?{variable:'pzrLevel',scale:{min:0,max:100},separators:[15,70],labels:['Bas','Normal','Haut']}
      :type==='action'?{command:'turbine.target',value:100}
      :type==='info'?{message:'Information de conduite'}
      :type==='wait'?{duration:10,unit:'seconds'}
      :type==='parallel'?{branches:2,join:null}:type==='join'?{fork:null}:{};
    return {id,type,x,y,name:{start:'Nouvelle séquence',test:'Comparaison',ranges:'Plages de mesure',action:'Action',
      info:'Information',wait:'Attente',parallel:'Effectuer les X actions en parallèle',join:'Attendre la fin de toutes les actions simultanées',end:'Fin de séquence'}[type],params:{...params,stepDelayS:null}};
  }
  function ports(n){
    return n.type==='end'?[]:n.type==='parallel'?Array.from({length:n.params.branches},(_,i)=>`branch:${i}`):n.type==='test'?['yes','no-left','no-right']
      :n.type==='ranges'?n.params.labels.map((_,i)=>`range:${i}`):['next'];
  }
  // L'échelle sert au dessin ; les plages extrêmes restent ouvertes vers ±∞.
  function ruleScale(measurement){
    const range=measurement?.range;
    if(Array.isArray(range)&&range.length===2&&range.every(finite)&&range[0]<range[1])return {min:range[0],max:range[1]};
    const unit=measurement?.unit||'';
    const fallback=unit==='TOR'?[0,1]:unit==='°C'?[0,350]:unit==='bar'?[0,180]:unit==='ppm'?[0,7000]:unit.includes('pas')?[0,260]:[0,100];
    return {min:fallback[0],max:fallback[1]};
  }
  function roundRuleValue(value){return finite(value)?Number(value.toPrecision(3)):value;}
  function ruleStep(scale){return 10**(Math.floor(Math.log10(scale.max-scale.min))-2);}
  function ruleSegments(p){
    const bounds=[p.scale.min,...p.separators,p.scale.max];
    return p.labels.map((label,i)=>({label,min:bounds[i],max:bounds[i+1]}));
  }
  function setRuleSeparator(p,index,value){
    const low=index?p.separators[index-1]:p.scale.min,high=index<p.separators.length-1?p.separators[index+1]:p.scale.max;
    if(!Number.isInteger(index)||index<0||index>=p.separators.length||!finite(value)||value<=low||value>=high)
      throw Error('Le repère doit rester strictement entre '+low+' et '+high+'.');
    p.separators[index]=value;
  }
  function setRuleScale(p,scale,rebase=false){
    if(!scale||!finite(scale.min)||!finite(scale.max)||!finite(scale.max-scale.min)||scale.min>=scale.max)throw Error('Échelle de règle invalide.');
    let separators=p.separators;
    if(rebase){const old=p.scale,span=old.max-old.min;
      separators=p.separators.map(v=>roundRuleValue(scale.min+(v-old.min)/span*(scale.max-scale.min)));
    }
    if(separators.some((v,i)=>v<=scale.min||v>=scale.max||i&&v<=separators[i-1]))
      throw Error('L’échelle doit contenir tous les repères, sans les confondre.');
    p.scale={...scale};p.separators=separators;
  }
  function splitRule(graph,n){
    const p=n.params,segments=ruleSegments(p);
    if(p.labels.length>=8)throw Error('Une règle contient au plus 8 plages.');
    const index=segments.findIndex(r=>r.max-r.min===Math.max(...segments.map(r=>r.max-r.min))),r=segments[index];
    const middle=roundRuleValue((r.min+r.max)/2);
    if(middle<=r.min||middle>=r.max)throw Error('Cette plage est trop étroite pour ajouter un repère à trois chiffres significatifs.');
    p.separators.splice(index,0,middle);p.labels.splice(index+1,0,'Plage '+(p.labels.length+1));
    for(const l of graph.links)if(l.from===n.id&&l.port.startsWith('range:')&&Number(l.port.split(':')[1])>index)
      l.port='range:'+(Number(l.port.split(':')[1])+1);
    // La nouvelle plage doit être raccordée explicitement : pas de commande dupliquée implicitement.
    return index;
  }
  function removeRuleSeparator(graph,n,index){
    const p=n.params;if(!Number.isInteger(index)||index<0||index>=p.separators.length)throw Error('Repère inconnu.');
    p.separators.splice(index,1);p.labels.splice(index+1,1);
    graph.links=graph.links.filter(l=>!(l.from===n.id&&l.port==='range:'+(index+1)));
    for(const l of graph.links)if(l.from===n.id&&l.port.startsWith('range:')&&Number(l.port.split(':')[1])>index+1)
      l.port='range:'+(Number(l.port.split(':')[1])-1);
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
    if(!raw||raw.format!==FORMAT||![1,2,VERSION].includes(raw.version)||!text(raw.name,100)
      ||!Array.isArray(raw.nodes)||raw.nodes.length>500||!Array.isArray(raw.links)||raw.links.length>1500)
      throw Error('Fichier de conduite incompatible.');
    const graph=migrateGraph(raw),nodes=new Map(),starts=new Set(),commands=new Map(actionCatalog().map(d=>[d.id,d]));
    if(!STEP_DELAYS.includes(graph.stepDelayS))throw Error('Durée minimale d’étape invalide.');
    for(const n of graph.nodes){
      if(!identifier(n.id)||nodes.has(n.id)||!TYPES.includes(n.type)||!text(n.name,100)||!n.name.trim()
        ||!finite(n.x)||!finite(n.y)||Math.abs(n.x)>20000||Math.abs(n.y)>20000||!n.params||typeof n.params!=='object')throw Error('Boîte de conduite invalide.');
      nodes.set(n.id,n);const p=n.params;
      if(p.stepDelayS!==undefined&&p.stepDelayS!==null&&!STEP_DELAYS.includes(p.stepDelayS))throw Error('Durée minimale de boîte invalide.');
      if(n.type==='start'){
        if(starts.has(n.name.trim().toLowerCase()))throw Error('Les départs doivent avoir des noms distincts.');
        starts.add(n.name.trim().toLowerCase());
      }
      if(['test','ranges'].includes(n.type)){
        if(!text(p.variable,120)||variables&&!variables.has(p.variable))throw Error('Mesure invalide : '+n.name);
        if(n.type==='test'&&(!OPERATORS.includes(p.operator)||!finite(p.value)||!finite(p.tolerance)||p.tolerance<0))throw Error('Comparaison ou tolérance invalide.');
        if(n.type==='ranges'){
          if(!p.scale||!finite(p.scale.min)||!finite(p.scale.max)||!finite(p.scale.max-p.scale.min)||p.scale.min>=p.scale.max
            ||!Array.isArray(p.labels)||!p.labels.length||p.labels.length>8||p.labels.some(v=>!text(v,60))
            ||!Array.isArray(p.separators)||p.separators.length!==p.labels.length-1
            ||p.separators.some((v,i)=>!finite(v)||v<=p.scale.min||v>=p.scale.max||i&&v<=p.separators[i-1]))
            throw Error('Repères non ordonnés ou échelle de règle invalide.');
        }
      }
      if(['action','info','wait'].includes(n.type))validateAction({...p,type:n.type},commands);
      if(n.type==='parallel'&&(!Number.isInteger(p.branches)||p.branches<2||p.branches>8||p.join!==null&&!identifier(p.join)))
        throw Error('Une ouverture parallèle doit avoir 2 à 8 branches et une clôture associée.');
      if(n.type==='join'&&p.fork!==null&&!identifier(p.fork))throw Error('Ouverture associée à la clôture invalide.');
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
  function classify(value,p){
    if(!finite(value))throw Error('La mesure sélectionnée est indisponible.');
    const index=p.separators.findIndex(v=>value<v);
    return 'range:'+(index<0?p.separators.length:index);
  }
  function migrateGraph(raw){
    const g=clone(raw);g.stepDelayS??=2;
    if(g.version<3)for(const n of g.nodes.filter(n=>n.type==='ranges'&&Array.isArray(n.params?.ranges))){
      const p=n.params,old=p.ranges,segments=[],mapping=[];
      if(!old.length||old.length>8||old.some((r,i)=>!text(r.label,60)||!finite(r.min)||!finite(r.max)||r.min>=r.max||i&&r.min<old[i-1].max))
        throw Error('Anciennes plages non ordonnées ou superposées.');
      const low=g.links.some(l=>l.from===n.id&&l.port==='no-left'),high=g.links.some(l=>l.from===n.id&&l.port==='no-right');
      const margin=(old.at(-1).max-old[0].min)/10;
      if(low)segments.push({label:'Sous l’échelle',min:old[0].min-margin,max:old[0].min});
      for(let i=0;i<old.length;i++){
        if(i&&old[i].min>old[i-1].max)segments.push({label:'Intervalle libre',min:old[i-1].max,max:old[i].min});
        mapping[i]=segments.length;segments.push(old[i]);
      }
      if(high)segments.push({label:'Au-dessus de l’échelle',min:old.at(-1).max,max:old.at(-1).max+margin});
      if(segments.length>8)throw Error('L’ancienne règle dépasse 8 plages après conversion de ses intervalles et sorties latérales.');
      for(const l of g.links.filter(l=>l.from===n.id)){
        if(l.port==='no-left')l.port='range:0';
        else if(l.port==='no-right')l.port='range:'+(segments.length-1);
        else if(/^range:\d+$/.test(l.port))l.port='range:'+mapping[Number(l.port.split(':')[1])];
      }
      n.params={variable:p.variable,stepDelayS:p.stepDelayS??null,scale:{min:segments[0].min,max:segments.at(-1).max},
        separators:segments.slice(0,-1).map(r=>r.max),labels:segments.map(r=>r.label)};
    }
    if(g.version===1){
      function expand(n,actions){
        if(!actions.length||actions.length>24)throw Error('Ancien lot parallèle invalide.');
        const chunks=actions.length>8?Array.from({length:Math.ceil(actions.length/8)},(_,i)=>actions.slice(i*8,i*8+8)):null;
        const join=node('join',n.id+':join',n.x,n.y+(chunks?680:320));join.params.fork=n.id;
        n.params={branches:Math.max(2,chunks?chunks.length:actions.length),join:join.id,stepDelayS:n.params.stepDelayS??null};
        for(const l of g.links)if(l.from===n.id){l.from=join.id;l.port='next';}
        for(let i=0;i<n.params.branches;i++){
          const a=actions[i]||{type:'info',message:'Branche libre'},child=node(chunks?'parallel':a.type,n.id+':branch:'+i,n.x+i*(chunks?2400:300),n.y+160);
          if(!chunks){child.params={...a,stepDelayS:null};delete child.params.type;}g.nodes.push(child);
          g.links.push({id:n.id+':split:'+i,from:n.id,port:'branch:'+i,to:child.id},
            {id:n.id+':close:'+i,from:child.id,port:'next',to:join.id});
          if(chunks)expand(child,chunks[i]);
        }
        g.nodes.push(join);
      }
      for(const n of [...g.nodes].filter(n=>n.type==='parallel')){
        if(!Array.isArray(n.params.actions))throw Error('Ancien lot parallèle invalide.');
        const commands=new Map(actionCatalog().map(d=>[d.id,d]));n.params.actions.forEach(a=>validateAction(a,commands));
        expand(n,n.params.actions);
      }
    }
    g.version=VERSION;
    return g;
  }
  function validateExecution(graph,startId){
    const nodes=new Map(graph.nodes.map(n=>[n.id,n])),out=id=>graph.links.filter(l=>l.from===id),checked=new Set();
    function forkCheck(n,ancestors=[]){
      if(ancestors.includes(n.id))throw Error('Ouvertures parallèles cycliques sans clôture.');
      if(checked.has(n.id))return;
      const j=nodes.get(n.params.join);
      if(j?.type!=='join'||j.params.fork!==n.id)throw Error('Clôture obligatoire pour « '+n.name+' ».');
      const shared=new Set();
      for(const port of ports(n)){
        const first=out(n.id).find(l=>l.port===port);if(!first)throw Error('Reliez toutes les branches de « '+n.name+' ».');
        const seen=new Set(),pending=[first.to];let reaches=false;
        while(pending.length){
          const id=pending.pop();if(id===j.id){reaches=true;continue;}if(seen.has(id))continue;seen.add(id);
          const b=nodes.get(id);if(!b||['start','end','join'].includes(b.type))throw Error('Chaque branche doit rejoindre sa clôture, sans fin intermédiaire.');
          if(b.type==='parallel'){
            forkCheck(b,[...ancestors,n.id]);const following=out(b.params.join);
            if(!following.length)throw Error('Clôture imbriquée sans suite vers la clôture extérieure.');
            pending.push(...following.map(l=>l.to));continue;
          }
          const links=out(id);if(!links.length||b.type==='test'&&!links.some(l=>l.port==='yes'))throw Error('Branche sans chemin complet vers sa clôture : '+b.name);
          pending.push(...links.map(l=>l.to));
        }
        if(!reaches)throw Error('Une branche ne rejoint pas la clôture.');
        for(const id of seen){if(shared.has(id))throw Error('Les branches doivent rester distinctes jusqu’à leur clôture.');shared.add(id);}
      }
      checked.add(n.id);
    }
    const pending=[startId],seen=new Set();
    while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const n=nodes.get(id);
      if(n.type==='join')throw Error('Une clôture doit être atteinte depuis son ouverture parallèle.');
      if(n.type==='parallel'){forkCheck(n);pending.push(...out(n.params.join).map(l=>l.to));}
      else pending.push(...out(id).map(l=>l.to));
    }
  }
  function token(id,current,stack=[]){return {id,current,stack,entered:false,elapsed:0,remaining:0,lastValue:null,lastPort:null,joined:false};}
  function idle(){return {status:'idle',sequence:null,current:null,entered:false,elapsed:0,totalElapsed:0,remaining:0,
    message:'Aucune séquence active',error:null,lastValue:null,lastPort:null,history:[],eventSerial:0,
    tokens:[],groups:[],nextToken:1,nextGroup:1,activeNodes:[]};}
  function start(graph,id,variables=null){
    graph=validate(graph,variables);const n=graph.nodes.find(n=>n.id===id&&n.type==='start');
    if(!n)throw Error('Sélectionnez un départ nommé.');validateExecution(graph,id);
    return {...idle(),tokens:[token('t1',id)],nextToken:2,status:'running',sequence:id,current:id,activeNodes:[id],message:n.name};
  }
  function record(r,n,event,t=null){
    r.history.push({node:n.id,name:n.name,event,time:r.totalElapsed,serial:++r.eventSerial,...(t?{token:t.id}:{})});
    if(r.history.length>200)r.history.shift();
  }
  function syncRuntime(r){
    const t=r.tokens[0];r.current=t?.current??r.current;r.entered=t?.entered??r.entered;r.elapsed=t?.elapsed??r.elapsed;
    r.remaining=Math.max(0,...r.tokens.map(t=>t.remaining));r.lastValue=t?.lastValue??null;r.lastPort=t?.lastPort??null;
    r.activeNodes=[...new Set(r.tokens.map(t=>t.current))];
  }
  function tick(r,graph,dt,read,execute){
    if(r.status!=='running'||!finite(dt)||dt<=0)return r;
    const nodes=new Map(graph.nodes.map(n=>[n.id,n])),links=new Map(graph.links.map(l=>[l.from+'/'+l.port,l]));
    r.totalElapsed+=dt;
    try{
      // Vérifier ensemble les commandes entrant dans le même pas, avant d’en appliquer une.
      const commands=r.tokens.filter(t=>!t.entered&&nodes.get(t.current)?.type==='action').map(t=>nodes.get(t.current).params),used=new Set();
      for(const p of commands){if(used.has(p.command))throw Error('Deux branches simultanées ciblent la même commande.');used.add(p.command);execute(p.command,p.value,true);}
      for(const t of [...r.tokens]){
        const n=nodes.get(t.current);if(!n)throw Error('Boîte active absente.');
        const entered=t.entered;
        if(!entered){t.entered=true;t.elapsed=0;record(r,n,'entrée',t);
          if(n.type==='action')execute(n.params.command,n.params.value,false);
          if(n.type==='info')record(r,n,n.params.message,t);
        }else t.elapsed+=dt;
        const minimum=n.params.stepDelayS??graph.stepDelayS??2;
        const duration=Math.max(minimum,n.type==='wait'?n.params.duration*DURATION_UNITS[n.params.unit]:0);
        t.remaining=Math.max(0,duration-t.elapsed);r.message=n.type==='info'?n.params.message:n.name;
        if(t.remaining>1e-8)continue;
        if(n.type==='join'&&!t.joined){
          const frame=t.stack.at(-1),group=r.groups.find(g=>g.id===frame?.group);
          if(!group||group.join!==n.id)throw Error('Clôture atteinte sans ouverture correspondante.');
          if(!group.arrived.includes(frame.branch))group.arrived.push(frame.branch);
          continue;
        }
        if(n.type==='parallel'){
          if(r.tokens.length-1+n.params.branches>256||r.groups.length>=128)throw Error('Trop de branches simultanées (256 curseurs maximum).');
          const group={id:'g'+r.nextGroup++,fork:n.id,join:n.params.join,parentStack:clone(t.stack),expected:n.params.branches,arrived:[]};
          r.groups.push(group);r.tokens=r.tokens.filter(b=>b.id!==t.id);record(r,n,'ouverture',t);
          for(let i=0;i<n.params.branches;i++){
            const l=links.get(n.id+'/branch:'+i);if(!l)throw Error('Branche parallèle non reliée.');
            r.tokens.push(token('t'+r.nextToken++,l.to,[...t.stack,{group:group.id,branch:i}]));
          }
          continue;
        }
        if(n.type==='end'){
          if(t.stack.length)throw Error('Fin de branche avant la clôture obligatoire.');
          record(r,n,'fin',t);r.tokens=r.tokens.filter(b=>b.id!==t.id);continue;
        }
        let port='next';
        if(n.type==='test'){
          t.lastValue=read(n.params.variable);const yes=compare(t.lastValue,n.params.operator,n.params.value,n.params.tolerance);
          port=yes?'yes':links.has(n.id+'/no-left')?'no-left':'no-right';
          if(!yes&&!links.has(n.id+'/'+port))continue;
        }else if(n.type==='ranges'){
          t.lastValue=read(n.params.variable);port=classify(t.lastValue,n.params);
          if(!links.has(n.id+'/'+port))continue;
        }
        const l=links.get(n.id+'/'+port);t.lastPort=port;record(r,n,port,t);
        if(l){t.current=l.to;t.entered=false;t.elapsed=0;t.remaining=0;t.lastValue=null;t.joined=false;}
        else {if(t.stack.length)throw Error('Branche terminée avant sa clôture.');r.tokens=r.tokens.filter(b=>b.id!==t.id);}
      }
      for(const g of [...r.groups])if(g.arrived.length===g.expected){
        const elapsed=Math.min(...r.tokens.filter(t=>t.stack.at(-1)?.group===g.id).map(t=>t.elapsed));
        r.tokens=r.tokens.filter(t=>t.stack.at(-1)?.group!==g.id);
        const t=token('t'+r.nextToken++,g.join,g.parentStack);t.joined=true;t.entered=true;t.elapsed=elapsed;
        r.tokens.push(t);r.groups=r.groups.filter(b=>b.id!==g.id);record(r,nodes.get(g.join),'toutes les branches terminées',t);
      }
      syncRuntime(r);
      if(!r.tokens.length){r.status='complete';r.message='Séquence terminée';}
    }catch(error){r.status='error';r.error=error.message;r.message=error.message;
      const n=nodes.get(r.tokens[0]?.current);if(n)record(r,n,'erreur');syncRuntime(r);}
    return r;
  }
  function validateSaved(saved,variables=null){
    if(!saved||typeof saved!=='object')throw Error('État de conduite absent.');
    if(!saved.runtime||typeof saved.runtime!=='object')throw Error('Mémoire de conduite invalide.');
    const graph=validate(saved.graph,variables),r=clone(saved.runtime);
    if(!r||!['idle','running','paused','stopped','complete','error'].includes(r.status)
      ||typeof r.entered!=='boolean'||!finite(r.elapsed)||r.elapsed<0||!finite(r.totalElapsed)||r.totalElapsed<0
      ||!finite(r.remaining)||r.remaining<0||!text(r.message,2000)||r.error!==null&&!text(r.error,2000)
      ||r.lastValue!==null&&!finite(r.lastValue)||r.lastPort!==null&&!text(r.lastPort,40)||!Array.isArray(r.history)||r.history.length>200)
      throw Error('Mémoire de conduite invalide.');
    if(r.sequence!==null&&!graph.nodes.some(n=>n.id===r.sequence&&n.type==='start')
      ||r.current!==null&&!graph.nodes.some(n=>n.id===r.current)||['running','paused'].includes(r.status)&&(r.current===null||r.sequence===null))throw Error('Séquence de conduite absente.');
    for(const h of r.history)if(!identifier(h.node)||!text(h.name,100)||!text(h.event,2000)||!finite(h.time)||h.time<0||h.time>r.totalElapsed+1e-8)throw Error('Journal de conduite invalide.');
    if(!r.tokens){
      const old=saved.graph.nodes.find(n=>n.id===r.current);
      r.tokens=['running','paused'].includes(r.status)?[Object.assign(token('t1',r.current),{entered:r.entered,elapsed:r.elapsed,remaining:r.remaining})]:[];
      r.groups=[];r.nextToken=2;r.nextGroup=1;r.eventSerial=r.history.length;
      // Les ordres d’un ancien lot déjà entré ont été exécutés : ne pas les rejouer.
      if(old?.type==='parallel'&&r.entered&&Array.isArray(old.params.actions)){
        r.groups=[];r.tokens=[];r.nextGroup=1;
        function resumeLegacy(n,items,parentStack){
          const g={id:'g'+r.nextGroup++,fork:n.id,join:n.params.join,parentStack,expected:n.params.branches,arrived:[]};r.groups.push(g);
          const chunks=items.length>8?Array.from({length:Math.ceil(items.length/8)},(_,i)=>items.slice(i*8,i*8+8)):null;
          for(let i=0;i<n.params.branches;i++){
            const stack=[...parentStack,{group:g.id,branch:i}],child=graph.nodes.find(b=>b.id===n.id+':branch:'+i);
            if(chunks){resumeLegacy(child,chunks[i],stack);continue;}
            const a=items[i],t=token('t'+r.nextToken++,a?.type==='wait'?child.id:g.join,stack);
            t.entered=true;t.elapsed=r.elapsed;t.remaining=a?.type==='wait'?Math.max(0,a.duration*DURATION_UNITS[a.unit]-r.elapsed):0;r.tokens.push(t);
          }
        }
        resumeLegacy(graph.nodes.find(n=>n.id===r.current),old.params.actions,[]);
      }
      syncRuntime(r);
    }
    if(!Array.isArray(r.tokens)||r.tokens.length>256||!Array.isArray(r.groups)||r.groups.length>128
      ||![r.nextToken,r.nextGroup,r.eventSerial].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Curseurs de conduite invalides.');
    const ids=new Set(),groups=new Map(r.groups.map(g=>[g.id,g]));
    if(groups.size!==r.groups.length)throw Error('Synchronisations parallèles dupliquées.');
    for(const g of r.groups){const n=graph.nodes.find(n=>n.id===g.fork);
      if(!identifier(g.id)||n?.type!=='parallel'||n.params.join!==g.join||g.expected!==n.params.branches
        ||!Array.isArray(g.arrived)||new Set(g.arrived).size!==g.arrived.length||g.arrived.some(v=>!Number.isInteger(v)||v<0||v>=g.expected)||!Array.isArray(g.parentStack))throw Error('Synchronisation parallèle invalide.');
    }
    function stackValid(stack){return Array.isArray(stack)&&stack.length<=128&&stack.every(f=>groups.has(f.group)&&Number.isInteger(f.branch)&&f.branch>=0&&f.branch<groups.get(f.group).expected);}
    for(const t of r.tokens){
      if(!identifier(t.id)||ids.has(t.id)||!graph.nodes.some(n=>n.id===t.current)||typeof t.entered!=='boolean'||typeof t.joined!=='boolean'
        ||!finite(t.elapsed)||t.elapsed<0||!finite(t.remaining)||t.remaining<0||t.lastValue!==null&&!finite(t.lastValue)||!stackValid(t.stack))throw Error('Curseur de conduite invalide.');ids.add(t.id);
    }
    if(r.tokens.some(t=>!/^t\d+$/.test(t.id)||Number(t.id.slice(1))>=r.nextToken)
      ||r.groups.some(g=>!/^g\d+$/.test(g.id)||Number(g.id.slice(1))>=r.nextGroup))throw Error('Compteurs de curseurs incompatibles.');
    const branches=new Set();
    for(const t of r.tokens){const f=t.stack.at(-1);if(!f)continue;const key=f.group+'/'+f.branch;
      if(branches.has(key))throw Error('Curseurs de branche dupliqués.');branches.add(key);}
    for(const g of r.groups)for(const branch of g.arrived)
      if(!r.tokens.some(t=>t.current===g.join&&t.stack.at(-1)?.group===g.id&&t.stack.at(-1)?.branch===branch))throw Error('Arrivée à la clôture incohérente.');
    if(r.groups.some(g=>!stackValid(g.parentStack))||['running','paused'].includes(r.status)&&!r.tokens.length)throw Error('Curseurs de conduite absents.');
    syncRuntime(r);return {graph,runtime:r};
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
    compare,classify,ruleScale,roundRuleValue,ruleStep,ruleSegments,setRuleSeparator,setRuleScale,splitRule,removeRuleSeparator,
    STEP_DELAYS,migrateGraph,validateExecution,idle,start,tick,validateSaved,executeCommand};
});
