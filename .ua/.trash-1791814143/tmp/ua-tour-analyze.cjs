const fs=require('fs');const path=require('path');
try{
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const nodes=d.nodes||[],edges=d.edges||[],layers=d.layers||[];
const ids=new Set(nodes.map(n=>n.id));const byId={};nodes.forEach(n=>byId[n.id]=n);
const fin={},fout={},inS={},outS={};nodes.forEach(n=>{inS[n.id]=new Set();outS[n.id]=new Set();});
edges.forEach(e=>{if(e.source===e.target)return;if(outS[e.source])outS[e.source].add(e.target);if(inS[e.target])inS[e.target].add(e.source);});
nodes.forEach(n=>{fin[n.id]=inS[n.id].size;fout[n.id]=outS[n.id].size;});
const rank=(m,k)=>nodes.map(n=>({id:n.id,[k]:m[n.id],name:n.name})).sort((a,b)=>b[k]-a[k]).slice(0,20);
const fanInRanking=rank(fin,'fanIn'),fanOutRanking=rank(fout,'fanOut');
const outs=Object.values(fout).sort((a,b)=>b-a);const topOut=outs[Math.max(0,Math.floor(outs.length*0.1)-1)]||0;
const ins=Object.values(fin).sort((a,b)=>a-b);const lowIn=ins[Math.floor(ins.length*0.25)]||0;
const EP=['index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js','mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py','__main__.py','Application.java','Main.java','Program.cs','config.ru','index.php','App.swift','Application.kt','main.cpp','main.c'];
const cands=nodes.map(n=>{let s=0;const fp=(n.filePath||'').split(String.fromCharCode(92)).join('/');const depth=fp.split('/').length-1;
if(n.type==='document'){if(/^readme\.md$/i.test(fp))s+=5;else if(depth===0&&fp.endsWith('.md'))s+=2;}
else if(n.type==='file'){if(EP.includes(n.name))s+=3;if(depth<=1)s+=1;if(fout[n.id]>=topOut&&topOut>0)s+=1;if(fin[n.id]<=lowIn)s+=1;}
return {id:n.id,score:s,name:n.name,type:n.type,summary:n.summary};}).filter(c=>c.score>0).sort((a,b)=>b.score-a.score);
const entryPointCandidates=cands.slice(0,5);
const codeEP=cands.find(c=>c.type==='file');
const adj={};edges.forEach(e=>{if(e.type==='imports'||e.type==='calls'){(adj[e.source]=adj[e.source]||[]).push(e.target);}});
const order=[],depthMap={},byDepth={};
if(codeEP){const q=[codeEP.id];depthMap[codeEP.id]=0;while(q.length){const c=q.shift();order.push(c);(byDepth[depthMap[c]]=byDepth[depthMap[c]]||[]).push(c);for(const t of adj[c]||[]){if(!(t in depthMap)&&ids.has(t)){depthMap[t]=depthMap[c]+1;q.push(t);}}}}
const cat={documentation:['document'],infrastructure:['service','pipeline','resource'],data:['table','schema','endpoint'],config:['config']};
const nonCodeFiles={};for(const k in cat)nonCodeFiles[k]=nodes.filter(n=>cat[k].includes(n.type)).map(n=>({id:n.id,name:n.name,type:n.type,summary:n.summary}));
const rel={};edges.forEach(e=>{if(e.type==='imports'||e.type==='calls'){rel[e.source+'|'+e.target+'|'+e.type]=1;}});
let clusters=[];const seen=new Set();
edges.forEach(e=>{if((e.type==='imports'||e.type==='calls')&&rel[e.target+'|'+e.source+'|'+e.type]){const key=[e.source,e.target].sort().join('|');if(!seen.has(key)){seen.add(key);clusters.push(new Set([e.source,e.target]));}}});
const und={};edges.forEach(e=>{(und[e.source]=und[e.source]||new Set()).add(e.target);(und[e.target]=und[e.target]||new Set()).add(e.source);});
clusters.forEach(c=>{let ch=true;while(ch&&c.size<5){ch=false;for(const n of nodes){if(c.has(n.id))continue;let k=0;for(const m of c)if(und[n.id]&&und[n.id].has(m))k++;if(k>=2){c.add(n.id);ch=true;if(c.size>=5)break;}}}});
// fallback: if none, seed from high-connectivity pairs
if(!clusters.length){const pc={};edges.forEach(e=>{if(e.source===e.target)return;const k=[e.source,e.target].sort().join('|');pc[k]=(pc[k]||0)+1;});
Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k])=>{const c=new Set(k.split('|'));for(const n of nodes){if(c.size>=5)break;if(c.has(n.id))continue;let x=0;for(const m of c)if(und[n.id]&&und[n.id].has(m))x++;if(x>=2)c.add(n.id);}clusters.push(c);});}
const out=clusters.map(c=>{const a=[...c];let ec=edges.filter(e=>c.has(e.source)&&c.has(e.target)).length;return {nodes:a,edgeCount:ec};}).sort((a,b)=>b.edgeCount-a.edgeCount).slice(0,10);
const nodeSummaryIndex={};nodes.forEach(n=>nodeSummaryIndex[n.id]={name:n.name,type:n.type,filePath:n.filePath,summary:n.summary});
fs.writeFileSync(process.argv[3],JSON.stringify({scriptCompleted:true,entryPointCandidates,fanInRanking,fanOutRanking,bfsTraversal:{startNode:codeEP?codeEP.id:null,order,depthMap,byDepth},nonCodeFiles,clusters:out,layers:{count:layers.length,list:layers},nodeSummaryIndex,edgeTypes:[...new Set(edges.map(e=>e.type))],totalNodes:nodes.length,totalEdges:edges.length},null,2));
}catch(e){console.error(e.stack);process.exit(1);}
