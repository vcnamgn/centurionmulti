/* Journaux bornés : événements physiques par essai et moments marquants de séance. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CenturionLogs=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function create({document=null,now=()=>new Date().toISOString(),maxRuns=12,maxEvents=300,maxSession=160}={}){
    let version=0,serial=0,runs=[],session=[],seen=new Set(),remote=null,dirty=true,lastSession='';
    const copy=value=>JSON.parse(JSON.stringify(value));
    function begin(label,time=0){runs.push({id:++serial,label:String(label),at:now(),time,events:[]});if(runs.length>maxRuns)runs.shift();seen=new Set();version++;dirty=true;}
    function note(text,time=0){const run=runs.at(-1);if(!run)return;run.events.push({time,text:String(text).slice(0,1000),kind:'conduite'});if(run.events.length>maxEvents)run.events.shift();version++;dirty=true;}
    function observe(model){if(!runs.length)begin('Démarrage',model.state.time);
      for(const event of model.state.events||[]){const key=JSON.stringify(event);if(seen.has(key))continue;seen.add(key);const run=runs.at(-1);run.events.push({...event,text:String(event.text||'').slice(0,1000)});if(run.events.length>maxEvents)run.events.shift();version++;dirty=true;}
      // Le moteur borne ses événements ; retenir aussi les signatures sur une fenêtre bornée.
      if(seen.size>1000)seen=new Set((model.state.events||[]).map(e=>JSON.stringify(e)));
    }
    function addSession(text){text=String(text).slice(0,500);if(text===lastSession)return;lastSession=text;session.push({at:now(),text});if(session.length>maxSession)session.shift();version++;dirty=true;}
    function snapshot(){return {runs,session};}
    function receive(data){if(!data||!Array.isArray(data.runs)||!Array.isArray(data.session))return;remote=copy(data);dirty=true;}
    function data(){return remote?{runs:remote.runs,session:[...remote.session,...session.map(e=>({...e,text:'Ce navigateur · '+e.text}))].sort((a,b)=>a.at.localeCompare(b.at)).slice(-maxSession)}:snapshot();}
    const clock=time=>{const n=Math.max(0,Math.floor(Number(time)||0));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(v=>String(v).padStart(2,'0')).join(':');};
    function render(){if(!document||!dirty)return;dirty=false;const value=data(),physical=document.getElementById('physicalLogs'),connection=document.getElementById('sessionLogs');if(!physical||!connection)return;
      physical.replaceChildren();connection.replaceChildren();
      for(const run of [...value.runs].reverse()){
        const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ol');
        details.open=run===value.runs.at(-1);summary.textContent=run.label+' · '+new Date(run.at).toLocaleString('fr-FR')+' · '+run.events.length+' événement(s)';details.appendChild(summary);
        for(const event of run.events){const item=document.createElement('li');item.textContent=clock(event.time)+' · '+event.text;list.appendChild(item);}
        if(!run.events.length){const item=document.createElement('li');item.textContent='Aucun événement physique marquant.';list.appendChild(item);}details.appendChild(list);physical.appendChild(details);
      }
      for(const event of value.session){const item=document.createElement('li');item.textContent=new Date(event.at).toLocaleTimeString('fr-FR')+' · '+event.text;connection.appendChild(item);}
      if(!value.session.length){const item=document.createElement('li');item.textContent='Aucun événement de séance.';connection.appendChild(item);}
    }
    begin('Démarrage');
    return {begin,note,observe,session:addSession,snapshot,receive,data,render,get version(){return version;}};
  }
  return {create};
});
