/* Dimensions des boîtes et adaptation des ports de conduite au tracé commun. */
(function(root,factory){const common=typeof module==='object'&&module.exports;const api=factory(common?require('./centurion-auto'):root.CenturionAuto,common?require('./centurion-orthogonal-routing'):root.CenturionOrthogonalRouting);if(common)module.exports=api;else root.CenturionAutoRouting=api;})(typeof window!=='undefined'?window:globalThis,function(A,O){
  'use strict';
  let measurements=[],commands=A.actionCatalog(),measureText=null;
  function configure(options){measurements=options.measurements||measurements;commands=options.commands||commands;measureText=options.measureText||measureText;}
  const fmt=v=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumFractionDigits:3}):'—';
  function instructions(n,runtime={}){
    const p=n.params,m=measurements.find(m=>m.id===p.variable);
    if(n.type==='test')return [m?.label||p.variable,`${p.operator} ${fmt(p.value)} ${m?.unit||''} · tol. ${fmt(p.tolerance)}`];
    if(n.type==='ranges')return [m?.label||p.variable,`${p.labels.length} plages · ${m?.unit||''}`];
    if(n.type==='action')return A.actionItems(p).map((a,i,items)=>{
      const c=commands.find(c=>c.id===a.command),value=c?.options?.find(([v])=>v===a.value)?.[1]||`${fmt(a.value)} ${c?.unit||''}`;
      return `${items.length>1?i+1+' · ':''}${c?.label||a.command} : ${value}`;
    });
    if(n.type==='wait')return [`${fmt(p.duration)} ${{seconds:'secondes',minutes:'minutes',hours:'heures'}[p.unit]}`];
    if(n.type==='info')return [p.message];
    if(n.type==='parallel')return [`${p.branches} branches indépendantes`,'Clôture obligatoire'];
    if(n.type==='join'){
      const groups=(runtime.groups||[]).filter(g=>g.join===n.id);
      return [groups.length?groups.map(g=>`${g.arrived.length}/${g.expected} branches terminées`).join(' · '):'Réunit tous les curseurs','Reprise après la dernière branche'];
    }
    return [n.type==='start'?'Point de départ de la séquence':'Termine la séquence'];
  }
  function textWidth(text,size=15,bold=false){
    if(measureText)return measureText(String(text),size,bold);
    return [...String(text)].reduce((sum,c)=>sum+size*(/[MW@%]/.test(c)?.9:/[il1.,:;!\s]/.test(c)?.34:/[A-Z0-9]/.test(c)?.67:.6),0)*(bold?1.08:1);
  }
  function wrapPixels(text,width,size=15,bold=false){
    const lines=[];
    for(const paragraph of String(text??'').split('\n')){
      let line='';
      for(let word of paragraph.trim().split(/\s+/).filter(Boolean)){
        if(line&&textWidth(line+' '+word,size,bold)>width){lines.push(line);line='';}
        while(textWidth(word,size,bold)>width){let cut=1;while(cut<word.length&&textWidth(word.slice(0,cut+1),size,bold)<=width)cut++;lines.push(word.slice(0,cut));word=word.slice(cut);}
        line+=(line?' ':'')+word;
      }
      if(line||!paragraph.trim())lines.push(line);
    }
    return lines;
  }
  function wrapText(text,limit=35,maxLines=4){
    const words=String(text??'').trim().split(/\s+/),lines=[];let line='';
    for(let word of words){
      if(line&&line.length+word.length+1>limit){lines.push(line);line='';}
      while(word.length>limit){lines.push(word.slice(0,limit));word=word.slice(limit);}
      line+=(line?' ':'')+word;
    }
    if(line)lines.push(line);
    return lines.length>maxLines?[...lines.slice(0,maxLines-1),lines[maxLines-1].slice(0,-1)+'…']:lines;
  }
  function textLayout(n,body=instructions(n)){
    const preferred=Math.max(textWidth(n.name,16,true),...body.flatMap(t=>String(t).split('\n').map(line=>textWidth(line))));
    const w=Math.max(n.type==='ranges'?380:320,Math.min(720,Math.ceil((preferred+36)/4)*4));
    const titleLines=wrapPixels(n.name,w-28,16,true),bodyLines=body.flatMap(t=>wrapPixels(t,w-28));
    return {w,titleLines,bodyLines,headerHeight:18+20*Math.max(1,titleLines.length)};
  }
  function boxHeader(n){return textLayout(n);}
  function ruleLayout(n,body){
    const header=textLayout(n,body),{w}=header,p=n.params,span=p.scale.max-p.scale.min,lanes=[];
    const markers=p.separators.map((value,index)=>{
      const x=14+(w-28)*(value-p.scale.min)/span;
      const width=Math.max(24,String(Number(value.toPrecision(3))).length*8+10);
      const labelX=Math.max(14+width/2,Math.min(w-14-width/2,x));
      let lane=lanes.findIndex(last=>labelX-last.x>=(width+last.width)/2+8);if(lane<0)lane=lanes.length;lanes[lane]={x:labelX,width};
      return {index,x,labelX,lane};
    });
    const barY=header.headerHeight+header.bodyLines.length*21+70+Math.max(0,lanes.length-1)*36;
    return {w,h:barY+72,barY,markers,...header};
  }
  function dimensions(n,body){
    if(n.type==='ranges')return ruleLayout(n,body);
    const header=textLayout(n,body),bodyHeight=Math.max(74,header.bodyLines.length*21+(n.type==='test'?74:40));
    return {h:header.headerHeight+bodyHeight,...header};
  }
  function portPoint(n,port,dimension=dimensions){
    const {w,h}=dimension(n);if(port==='in')return {x:n.x+w/2,y:n.y};
    if(port==='no-left'||port==='no-right')return {x:n.x+(port==='no-right'?w:0),y:n.y+h-30};
    if(n.type==='parallel'&&port.startsWith('branch:'))return {x:n.x+w*(Number(port.split(':')[1])+1)/(n.params.branches+1),y:n.y+h};
    if(n.type==='ranges'&&port.startsWith('range:'))return {x:n.x+w*(Number(port.split(':')[1])+1)/(n.params.labels.length+1),y:n.y+h};
    return {x:n.x+w/2,y:n.y+h};
  }
  const router=O.createRouter();
  function prepare(graph,dimension=dimensions){return router.prepare(graph.nodes.map(n=>({id:n.id,x:n.x,y:n.y,w:dimension(n).w,h:dimension(n).h})));}
  function route(graph,link,dimension=dimensions,scene=null){
    const from=graph.nodes.find(n=>n.id===link.from),to=graph.nodes.find(n=>n.id===link.to);
    if(!from||!to)return {points:[],blocked:true};
    return (scene||prepare(graph,dimension)).route({from:from.id,to:to.id,start:portPoint(from,link.port,dimension),end:portPoint(to,'in',dimension),
      startDirection:link.port==='no-left'?'left':link.port==='no-right'?'right':'down',endDirection:'up'});
  }
  return {configure,instructions,textWidth,wrapPixels,textLayout,dimensions,boxHeader,wrapText,ruleLayout,portPoint,prepare,route,path:O.path};
});
