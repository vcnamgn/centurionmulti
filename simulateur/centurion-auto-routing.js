/* Connecteurs orthogonaux : visibilité sur une grille de coordonnées des obstacles. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CenturionAutoRouting=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function ruleLayout(n){
    const w=320,p=n.params,span=p.scale.max-p.scale.min,lanes=[];
    const markers=p.separators.map((value,index)=>{
      const x=14+(w-28)*(value-p.scale.min)/span;
      let lane=lanes.findIndex(last=>x-last>=22);if(lane<0)lane=lanes.length;lanes[lane]=x;
      return {index,x,lane};
    });
    const barY=98+Math.max(0,lanes.length-1)*22;
    return {w,h:barY+70,barY,markers};
  }
  function dimensions(n){return n.type==='ranges'?ruleLayout(n):{w:260,h:n.type==='test'||n.type==='parallel'||n.type==='join'?112:92};}
  function portPoint(n,port){
    const {w,h}=dimensions(n);if(port==='in')return {x:n.x+w/2,y:n.y};
    if(port==='no-left'||port==='no-right')return {x:n.x+(port==='no-right'?w:0),y:n.y+h/2};
    if(n.type==='parallel'&&port.startsWith('branch:'))return {x:n.x+w*(Number(port.split(':')[1])+1)/(n.params.branches+1),y:n.y+h};
    if(n.type==='ranges'&&port.startsWith('range:'))return {x:n.x+w*(Number(port.split(':')[1])+1)/(n.params.labels.length+1),y:n.y+h};
    return {x:n.x+w/2,y:n.y+h};
  }
  function simplify(points){return points.filter((p,i)=>!i||i===points.length-1||!((points[i-1].x===p.x&&p.x===points[i+1].x)||(points[i-1].y===p.y&&p.y===points[i+1].y)));}
  function route(graph,link){
    const from=graph.nodes.find(n=>n.id===link.from),to=graph.nodes.find(n=>n.id===link.to);
    if(!from||!to)return {points:[],blocked:true};
    const s=portPoint(from,link.port),e=portPoint(to,'in'),side=link.port==='no-left'?-1:link.port==='no-right'?1:0;
    const a={x:s.x+side*24,y:s.y+(side?0:24)},b={x:e.x,y:e.y-24};
    const rects=graph.nodes.map(n=>{const d=dimensions(n);return {left:n.x-12,right:n.x+d.w+12,top:n.y-12,bottom:n.y+d.h+12};});
    const inside=p=>rects.some(r=>p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom);
    const clear=(p,q)=>!rects.some(r=>p.y===q.y?p.y>r.top&&p.y<r.bottom&&Math.max(p.x,q.x)>r.left&&Math.min(p.x,q.x)<r.right
      :p.x>r.left&&p.x<r.right&&Math.max(p.y,q.y)>r.top&&Math.min(p.y,q.y)<r.bottom);
    // Les seules traversées des rectangles source/destination sont les petits accès aux ports.
    const foreign=graph.nodes.filter(n=>n.id!==from.id&&n.id!==to.id).map(n=>{const d=dimensions(n);return {left:n.x-12,right:n.x+d.w+12,top:n.y-12,bottom:n.y+d.h+12};});
    const stubBlocked=(p,q)=>foreign.some(r=>p.y===q.y?p.y>r.top&&p.y<r.bottom&&Math.max(p.x,q.x)>r.left&&Math.min(p.x,q.x)<r.right
      :p.x>r.left&&p.x<r.right&&Math.max(p.y,q.y)>r.top&&Math.min(p.y,q.y)<r.bottom);
    if(inside(a)||inside(b)||stubBlocked(s,a)||stubBlocked(b,e))return {points:[s,a],blocked:true};
    const xs=[...new Set([a.x,b.x,...rects.flatMap(r=>[r.left,r.right])])].sort((a,b)=>a-b);
    const ys=[...new Set([a.y,b.y,...rects.flatMap(r=>[r.top,r.bottom])])].sort((a,b)=>a-b);
    const key=(x,y,dir)=>`${x},${y},${dir}`,point=(x,y)=>({x:xs[x],y:ys[y]});
    const x0=xs.indexOf(a.x),y0=ys.indexOf(a.y),x1=xs.indexOf(b.x),y1=ys.indexOf(b.y);
    const heuristic=(x,y)=>Math.abs(xs[x]-b.x)+Math.abs(ys[y]-b.y),heap=[];
    function push(v){let i=heap.push(v)-1;while(i){const p=(i-1)>>1;if(heap[p].score<=v.score)break;heap[i]=heap[p];i=p;}heap[i]=v;}
    function pop(){const v=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return v;}
    const first={x:x0,y:y0,dir:side?0:1,cost:0,score:heuristic(x0,y0),parent:null};push(first);
    const best=new Map([[key(x0,y0,first.dir),0]]);let explored=0;
    while(heap.length&&explored++<20000){
      const c=pop();if(c.cost!==best.get(key(c.x,c.y,c.dir)))continue;
      if(c.x===x1&&c.y===y1){const path=[];for(let p=c;p;p=p.parent)path.push(point(p.x,p.y));return {points:simplify([s,...path.reverse(),e]),blocked:false};}
      for(const [dx,dy,dir] of [[-1,0,0],[1,0,0],[0,-1,1],[0,1,1]]){
        const x=c.x+dx,y=c.y+dy;if(x<0||y<0||x>=xs.length||y>=ys.length)continue;
        const p=point(c.x,c.y),q=point(x,y);if(inside(q)||!clear(p,q))continue;
        const cost=c.cost+Math.abs(p.x-q.x)+Math.abs(p.y-q.y)+(dir!==c.dir?18:0),k=key(x,y,dir);
        if(cost>=(best.get(k)??Infinity))continue;best.set(k,cost);push({x,y,dir,cost,score:cost+heuristic(x,y),parent:c});
      }
    }
    return {points:[s,a],blocked:true};
  }
  function path(points){return points.map((p,i)=>i===0?`M${p.x} ${p.y}`:p.x===points[i-1].x?`V${p.y}`:`H${p.x}`).join('');}
  return {dimensions,ruleLayout,portPoint,route,path};
});
