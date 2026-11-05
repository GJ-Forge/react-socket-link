const fs=require('fs');
try{
const [inp,out]=process.argv.slice(2);
const d=JSON.parse(fs.readFileSync(inp,'utf8'));
const nodes=d.nodes||[],edges=d.edges||[],layers=d.layers||[];
const ids=new Set(nodes.map(n=>n.id));const byId={};nodes.forEach(n=>byId[n.id]=n);
const fileOf=id=>{if(ids.has(id))return id;const m=id.match(/^(?:function|class):([^:]+):/);if(m){for(const p of['file:','config:','document:'])if(ids.has(p+m[1]))return p+m[1];}return null;};
const inS={},outS={};nodes.forEach(n=>{inS[n.id]=new Set();outS[n.id]=new Set();});
const fwd={};nodes.forEach(n=>fwd[n.id]=new Set());
const pairCount={};
for(const e of edges){const s=fileOf(e.source),t=fileOf(e.target);if(!s||!t||s===t)continue;
 outS[s].add(t);inS[t].add(s);
 if(e.type==='imports'||e.type==='calls')fwd[s].add(t);
 const k=[s,t].sort().join('|');pairCount[k]=(pairCount[k]||0)+1;}
const fanIn=nodes.map(n=>({id:n.id,fanIn:inS[n.id].size,name:n.name})).sort((a,b)=>b.fanIn-a.fanIn);
const fanOut=nodes.map(n=>({id:n.id,fanOut:outS[n.id].size,name:n.name})).sort((a,b)=>b.fanOut-a.fanOut);
const entryNames=new Set(['index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js','mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py','__main__.py','Application.java','Main.java','Program.cs','config.ru','index.php','App.swift','Application.kt','main.cpp','main.c']);
const foSorted=fanOut.map(x=>x.fanOut);const foThr=foSorted[Math.max(0,Math.ceil(nodes.length*0.1)-1)];
const fiAsc=fanIn.map(x=>x.fanIn).sort((a,b)=>a-b);const fiThr=fiAsc[Math.max(0,Math.floor(nodes.length*0.25)-1)];
const cands=nodes.map(n=>{let s=0;const fp=n.filePath||'';const depth=fp.split('/').length-1;
 if(n.type==='document'){if(/^README\.md$/i.test(fp))s+=5;else if(depth===0&&fp.endsWith('.md'))s+=2;}
 else if(n.type==='file'){if(entryNames.has(n.name))s+=3;if(depth<=1)s+=1;if(outS[n.id].size>=foThr&&outS[n.id].size>0)s+=1;if(inS[n.id].size<=fiThr)s+=1;}
 return {id:n.id,score:s,name:n.name,summary:n.summary,type:n.type};}).sort((a,b)=>b.score-a.score);
const start=cands.find(c=>c.type==='file');
const depthMap={},order=[];if(start){const q=[start.id];depthMap[start.id]=0;while(q.length){const c=q.shift();order.push(c);for(const t of fwd[c])if(!(t in depthMap)){depthMap[t]=depthMap[c]+1;q.push(t);}}}
const byDepth={};order.forEach(id=>{(byDepth[depthMap[id]]=byDepth[depthMap[id]]||[]).push(id);});
const cat={documentation:['document'],infrastructure:['service','pipeline','resource'],data:['table','schema','endpoint'],config:['config']};
const nonCode={};for(const k in cat)nonCode[k]=nodes.filter(n=>cat[k].includes(n.type)).map(n=>({id:n.id,name:n.name,type:n.type,summary:n.summary}));
// clusters
const clusters=[];const seen=new Set();
for(const a of nodes)for(const b of fwd[a.id])if(fwd[b].has(a.id)){const k=[a.id,b].sort().join('|');if(seen.has(k))continue;seen.add(k);clusters.push(new Set([a.id,b]));}
const und={};nodes.forEach(n=>und[n.id]=new Set([...inS[n.id],...outS[n.id]]));
if(!clusters.length){// fallback: seeds by fan-in hubs with mutual neighbours
 for(const h of fanIn.slice(0,6)){const c=new Set([h.id]);for(const n of nodes){if(c.size>=5)break;if(n.id!==h.id&&fwd[n.id].has(h.id)&&[...c].filter(x=>und[n.id].has(x)).length>=Math.min(2,c.size))c.add(n.id);}if(c.size>1)clusters.push(c);}}
for(const c of clusters){for(const n of nodes){if(c.size>=5)break;if(!c.has(n.id)&&[...c].filter(x=>und[n.id].has(x)).length>=2)c.add(n.id);}}
const cl=clusters.map(c=>{const arr=[...c];let ec=0;for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++)ec+=pairCount[[arr[i],arr[j]].sort().join('|')]||0;return{nodes:arr,edgeCount:ec};}).sort((a,b)=>b.edgeCount-a.edgeCount).slice(0,10);
const idx={};nodes.forEach(n=>idx[n.id]={name:n.name,type:n.type,summary:n.summary});
fs.writeFileSync(out,JSON.stringify({scriptCompleted:true,entryPointCandidates:cands.slice(0,5),fanInRanking:fanIn.slice(0,20),fanOutRanking:fanOut.slice(0,20),bfsTraversal:{startNode:start&&start.id,order,depthMap,byDepth},nonCodeFiles:nonCode,clusters:cl,layers:{count:layers.length,list:layers},nodeSummaryIndex:idx,totalNodes:nodes.length,totalEdges:edges.length},null,1));
}catch(e){console.error(e.stack);process.exit(1);}
