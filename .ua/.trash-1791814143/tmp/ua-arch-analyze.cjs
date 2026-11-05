const fs=require('fs');
try{
const inp=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const nodes=inp.fileNodes, ids=new Set(nodes.map(n=>n.id));
const grp=n=>{const p=n.filePath.split('/');return p.length>1?(p[0]==='src'&&p.length>2?p[1]:p[0]):'root';};
const g2={},nt={},gOf={};
for(const n of nodes){const g=grp(n);gOf[n.id]=g;(g2[g]=g2[g]||[]).push(n.id);(nt[n.type]=nt[n.type]||[]).push(n.id);}
const fi={},fo={},inter={},intra={};
for(const e of inp.importEdges){fo[e.source]=(fo[e.source]||0)+1;fi[e.target]=(fi[e.target]||0)+1;
 const a=gOf[e.source],b=gOf[e.target];if(a===b){intra[a]=(intra[a]||0)+1}else{const k=a+'->'+b;inter[k]=(inter[k]||0)+1}}
const cross={};for(const e of inp.allEdges){if(!ids.has(e.source)||!ids.has(e.target)||e.type==='imports')continue;
 const t1=e.source.split(':')[0],t2=e.target.split(':')[0],k=t1+'|'+t2+'|'+e.type;cross[k]=(cross[k]||0)+1}
const pm={client:'service',context:'ui',hooks:'hooks',types:'types',utils:'utility'};
const patterns={};for(const g in g2)if(pm[g])patterns[g]=pm[g];
const interArr=Object.entries(inter).map(([k,c])=>{const[f,t]=k.split('->');return{from:f,to:t,count:c}});
const dens={};for(const g in g2){const tot=inp.importEdges.filter(e=>gOf[e.source]===g||gOf[e.target]===g).length;dens[g]={internalEdges:intra[g]||0,totalEdges:tot,density:tot?(intra[g]||0)/tot:0}}
const out={scriptCompleted:true,directoryGroups:g2,nodeTypeGroups:nt,
 crossCategoryEdges:Object.entries(cross).map(([k,c])=>{const[a,b,t]=k.split('|');return{fromType:a,toType:b,edgeType:t,count:c}}),
 interGroupImports:interArr,intraGroupDensity:dens,patternMatches:patterns,
 deploymentTopology:{hasDockerfile:false,hasCompose:false,hasK8s:false,hasTerraform:false,hasCI:false,infraFiles:[]},
 dataPipeline:{schemaFiles:[],migrationFiles:[],dataModelFiles:[],apiHandlerFiles:[]},
 docCoverage:{groupsWithDocs:1,totalGroups:Object.keys(g2).length,coverageRatio:+(1/Object.keys(g2).length).toFixed(2),undocumentedGroups:Object.keys(g2).filter(g=>g!=='root')},
 dependencyDirection:interArr.map(x=>({dependent:x.from,dependsOn:x.to})),
 fileStats:{totalFileNodes:nodes.length,filesPerGroup:Object.fromEntries(Object.entries(g2).map(([k,v])=>[k,v.length])),nodeTypeCounts:Object.fromEntries(Object.entries(nt).map(([k,v])=>[k,v.length]))},
 fileFanIn:fi,fileFanOut:fo};
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
}catch(e){console.error(e);process.exit(1)}
