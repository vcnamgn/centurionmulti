(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CenturionAutoEditing=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  // Ouverture et clôture sont une paire, même pendant la construction du graphe.
  function selection(graph,ids){
    const included=new Set(ids),nodes=new Map(graph.nodes.map(n=>[n.id,n]));
    for(const id of included){const n=nodes.get(id);
      if(n?.type==='parallel'&&nodes.has(n.params.join))included.add(n.params.join);
      if(n?.type==='join'&&nodes.has(n.params.fork))included.add(n.params.fork);
    }
    return new Set([...included].filter(id=>nodes.has(id)));
  }
  function fragment(graph,ids){
    const included=selection(graph,ids);
    return {...clone(graph),nodes:clone(graph.nodes.filter(n=>included.has(n.id))),
      links:clone(graph.links.filter(l=>included.has(l.from)&&included.has(l.to)))};
  }
  function sequenceFragment(graph,starts){
    const included=new Set(),todo=[...starts],nodes=new Map(graph.nodes.map(n=>[n.id,n])),out=new Map();
    for(const l of graph.links){if(!out.has(l.from))out.set(l.from,[]);out.get(l.from).push(l.to);}
    while(todo.length){const id=todo.pop(),n=nodes.get(id);if(!n||included.has(id))continue;
      included.add(id);todo.push(...(out.get(id)||[]));
      if(n.type==='parallel'&&n.params.join)todo.push(n.params.join);
      if(n.type==='join'&&n.params.fork)todo.push(n.params.fork);
    }
    return fragment(graph,included);
  }
  function remap(source,target,makeId,{preserveDelay=false}={}){
    const copy=clone(source),map=new Map(),used=new Set([...target.nodes,...target.links].map(n=>n.id));
    const fresh=prefix=>{let id;do{id=makeId(prefix);}while(used.has(id));used.add(id);return id;};
    for(const n of copy.nodes)map.set(n.id,fresh('box'));
    const names=new Set(target.nodes.filter(n=>n.type==='start').map(n=>n.name.trim().toLowerCase()));
    for(const n of copy.nodes){n.id=map.get(n.id);
      if(n.type==='parallel')n.params.join=map.get(n.params.join)||null;
      if(n.type==='join')n.params.fork=map.get(n.params.fork)||null;
      if(preserveDelay&&n.params.stepDelayS==null)n.params.stepDelayS=source.stepDelayS;
      if(n.type==='start'){const base=n.name.trim();let name=base,index=2;
        while(names.has(name.toLowerCase())){const suffix=' ('+(index++)+')';name=base.slice(0,100-suffix.length)+suffix;}
        n.name=name;names.add(name.toLowerCase());
      }
    }
    for(const l of copy.links){l.id=fresh('link');l.from=map.get(l.from);l.to=map.get(l.to);}
    return copy;
  }
  function bounds(nodes,dimensions){
    const left=Math.min(...nodes.map(n=>n.x)),top=Math.min(...nodes.map(n=>n.y));
    return {x:left,y:top,w:Math.max(...nodes.map(n=>n.x+dimensions(n).w))-left,
      h:Math.max(...nodes.map(n=>n.y+dimensions(n).h))-top};
  }
  const overlaps=(a,b,gap=32)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
  // Recherche dans le rectangle réellement affiché. Si nécessaire, dézoomage
  // progressif pour laisser une place libre, sans déplacer les boîtes existantes.
  function place(nodes,existing,viewport,dimensions){
    if(!nodes.length)throw Error('Aucune boîte à ajouter.');
    const b=bounds(nodes,dimensions),obstacles=existing.map(n=>({x:n.x,y:n.y,...dimensions(n)}));
    let view={...viewport};const margin=24,gap=32,limit=19900;
    for(let attempt=0;attempt<18;attempt++){
      const xmin=Math.max(-limit,view.x+margin),ymin=Math.max(-limit,view.y+margin);
      const xmax=Math.min(limit-b.w,view.x+view.w-margin-b.w),ymax=Math.min(limit-b.h,view.y+view.h-margin-b.h);
      const xs=[xmin,...obstacles.flatMap(o=>[o.x+o.w+gap,o.x-b.w-gap])];
      const ys=[ymin,...obstacles.flatMap(o=>[o.y+o.h+gap,o.y-b.h-gap])];
      const candidates=[];
      for(const x of new Set(xs))for(const y of new Set(ys))if(x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax)candidates.push({x,y,w:b.w,h:b.h});
      candidates.sort((a,b)=>Math.hypot(a.x-xmin,a.y-ymin)-Math.hypot(b.x-xmin,b.y-ymin));
      const spot=candidates.find(c=>!obstacles.some(o=>overlaps(c,o,gap-0.01)));
      if(spot){for(const n of nodes){n.x+=spot.x-b.x;n.y+=spot.y-b.y;}return view;}
      const w=Math.min(39800,Math.max(view.w*1.4,b.w+2*margin)),h=Math.min(39800,Math.max(view.h*1.4,b.h+2*margin));
      if(w===view.w&&h===view.h)break;
      view={x:Math.max(-limit,Math.min(limit-w,view.x-(w-view.w)/2)),y:Math.max(-limit,Math.min(limit-h,view.y-(h-view.h)/2)),w,h};
    }
    throw Error('Le canevas est trop rempli pour ajouter ces boîtes sans chevauchement.');
  }
  return {selection,fragment,sequenceFragment,remap,bounds,overlaps,place};
});
