/* Catalogue des gestes du pupitre : aucune écriture de chemin de modèle reçue du réseau. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CenturionSessionControls=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const BUTTONS=['runButton','resetButton','allRodsDown','allRodsUp','allRodsRelease','asgStart','risPumpStart','risPumpStop','risPumpAuto','connectRra','rcvDilution','rcvBorication','forceTrip','forceRis','cancelInitiator','tripPrimaryPumps','startSecondaryBreak','isolateSecondaryBreak','startBreak','isolateBreak','startEjection','startWithdrawal','startVoltage','startEquipmentFault','clearEquipmentFaults','startTransient','stopTransient','pauseTransient','resumeTransient','interruptTransient','resetAlarms','toggleRegulationSynoptic','toggleProtectionSynoptic'];
  const FIELDS=['simSpeed','demandInput','turbineRateInput','campaignSelect','gcpCalibrationInput','rMode','rManualInput','chargeInput','halfCycle','gvSetpoint','heaterInput','sprayInput','auxiliarySprayInput','asgManual','asgAvailable','rManualOverride','rcvBoron','protectionsEnabled','risEnabled','risSource','mpA','mpB','bpA','bpB','gctaOpeningPressure','primaryPressureSetpoint','pzrLevelSetpoint','gctaOpeningPressureRate','primaryPressureSetpointRate','pzrLevelSetpointRate','primaryPressureSetpointManual','pzrLevelSetpointManual','tripPressure','risPressure','fluxAlarm','fluxTrip','fluxRateTrip','risBoron','mpScale','bpScale','fxyUngraped','fxyGraped','xenonScale','moderatorCoefficient','dopplerCoefficient','xenonWorth','naturalCirculationFlow'];
  const CONTEXT={startBreak:['breakArea','breakLoop','breakBranch'],isolateBreak:['breakArea','breakLoop','breakBranch'],startSecondaryBreak:['secondaryBreakGv','secondaryBreakArea'],isolateSecondaryBreak:['secondaryBreakGv','secondaryBreakArea'],startEjection:['ejectionWorth'],startEquipmentFault:['equipmentFaultSearch','equipmentFaultSelect','equipmentFaultMode'],startTransient:['transientSelect']};
  const DYNAMIC=[['gvFeedControls','input[data-gv]',el=>'gv:'+el.dataset.gv+':'+el.dataset.kind],['rodWorthControls','input[data-rod]',el=>'rod:'+el.dataset.rod],['axialShapeControls','input[data-axial-rod]',el=>'shape:'+el.dataset.axialRod],['alarmRows','input[data-alarm]',el=>'alarm:'+el.dataset.alarm+':'+el.dataset.limit],['equipmentFaultList','button[data-clear-fault]',el=>'fault:'+el.dataset.clearFault],['view-synoptiques','[data-relief-stage],[data-rcv-orifice],[data-asg-channel],[data-asg-train]',el=>['reliefStage','rcvOrifice','asgChannel','asgTrain'].filter(k=>el.dataset[k]!==undefined).map(k=>k+':'+el.dataset[k]).join('/')]];
  function create({document,isAuxiliary,request,onStatus=()=>{}}){
    let refs=new Map(),byElement=new Map();const sent=new Map(),timers=new Map();
    function refresh(){
      refs=new Map();byElement=new Map();
      const add=(key,el)=>{if(el){refs.set(key,el);byElement.set(el,key);}};
      for(const id of [...BUTTONS,...FIELDS,...new Set(Object.values(CONTEXT).flat())])add(id,document.getElementById(id));
      for(const [container,selector,key] of DYNAMIC)document.getElementById(container)?.querySelectorAll(selector).forEach(el=>add(key(el),el));
    }
    const value=el=>el.type==='checkbox'?el.checked:el.value;
    function validate(el,v){
      if(el.type==='checkbox'){if(typeof v!=='boolean')throw Error('Valeur booléenne attendue.');return v;}
      if(typeof v!=='string'||v.length>300)throw Error('Valeur de commande invalide.');
      if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===v))throw Error('Choix de commande invalide.');
      if(['number','range'].includes(el.type)){
        const number=Number(v);if(!v.trim()||!Number.isFinite(number)||el.min!==''&&number<Number(el.min)||el.max!==''&&number>Number(el.max))throw Error('Valeur hors des limites du pupitre.');
      }return v;
    }
    function set(el,v){v=validate(el,v);if(el.type==='checkbox')el.checked=v;else el.value=v;}
    function eventFor(el){return el.type==='checkbox'||el.tagName==='SELECT'?'change':'input';}
    function execute(action){
      refresh();const el=refs.get(action.target);
      if(!el)throw Error('Commande inconnue sur le maître.');
      const button=BUTTONS.includes(action.target)||action.target.startsWith('fault:');
      if(button){
        if(action.event!=='click')throw Error('Geste de commande invalide.');
        const allowed=CONTEXT[action.target]||[];
        if(Object.keys(action.context||{}).some(k=>!allowed.includes(k)))throw Error('Contexte de commande inconnu.');
        for(const key of allowed){const field=refs.get(key);if(!field||!Object.hasOwn(action.context||{},key))throw Error('Contexte de commande incomplet.');
          set(field,action.context[key]);field.dispatchEvent(new Event(eventFor(field),{bubbles:true}));refresh();}
        if(el.disabled)throw Error('Commande indisponible sur le maître.');el.click();
      }else{
        if(!FIELDS.includes(action.target)&&!action.target.includes(':'))throw Error('Champ local non pilotable à distance.');
        if(el.disabled)throw Error('Commande indisponible sur le maître.');if(action.event!==eventFor(el))throw Error('Geste de saisie invalide.');
        set(el,action.value);el.dispatchEvent(new Event(action.event,{bubbles:true}));
      }
      return {ok:true};
    }
    function read(){refresh();return [...refs].filter(([key])=>!Object.values(CONTEXT).some(list=>list.includes(key))).map(([key,el])=>({key,disabled:Boolean(el.disabled),...(!BUTTONS.includes(key)&&!key.startsWith('fault:')?{value:value(el)}:{})}));}
    function apply(rows){refresh();sent.clear();for(const row of rows||[]){const el=refs.get(row.key);if(!el)continue;if(row.value!==undefined&&document.activeElement!==el){try{set(el,row.value);}catch{}}
      if(typeof row.disabled==='boolean')el.disabled=row.disabled;
    }}
    function transmit(action){
      const signature=JSON.stringify(action);if(sent.get(action.target)===signature)return;sent.set(action.target,signature);
      Promise.resolve(request(action)).then(result=>{if(!result?.ok){sent.delete(action.target);onStatus(result?.message||'Commande refusée.',true);}}).catch(error=>{sent.delete(action.target);onStatus(error.message,true);});
    }
    function intercept(event){
      if(!isAuxiliary())return;refresh();let el=event.target;
      if(event.type==='click')el=el.closest?.('button,input')||el;
      const key=byElement.get(el);if(!key)return;
      const button=BUTTONS.includes(key)||key.startsWith('fault:');
      if(!button&&!FIELDS.includes(key)&&!key.includes(':'))return;
      if(event.type==='click'&&!button)return;
      if(event.type!=='click'&&(button||event.type!==eventFor(el)))return;
      event.preventDefault();event.stopImmediatePropagation();
      const action={kind:'ui',target:key,event:event.type};
      if(button){action.context=Object.fromEntries((CONTEXT[key]||[]).map(id=>[id,value(refs.get(id))]));sent.delete(key);transmit(action);}
      else{
        action.value=value(el);clearTimeout(timers.get(key));
        if(event.type==='input')timers.set(key,setTimeout(()=>transmit(action),80));else transmit(action);
      }
    }
    for(const type of ['click','input','change'])document.addEventListener(type,intercept,true);
    document.addEventListener('wheel',event=>{
      if(!isAuxiliary())return;refresh();const el=event.target;if(!byElement.has(el)||el.type!=='number')return;
      event.preventDefault();event.stopImmediatePropagation();const step=Number(el.step)>0?Number(el.step):el.id==='rcvBoron'?50:1;
      const min=el.min===''?-Infinity:Number(el.min),max=el.max===''?Infinity:Number(el.max);
      el.value=String(Math.max(min,Math.min(max,Number(el.value)+(event.deltaY<0?step:-step))));el.dispatchEvent(new Event('input',{bubbles:true}));
    },{capture:true,passive:false});
    return {execute,read,apply,refresh};
  }
  return {create,BUTTONS,FIELDS};
});
