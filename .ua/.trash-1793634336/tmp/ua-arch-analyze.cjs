const fs=require('fs');
try{
const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const nodes=d.fileNodes,imp=d.importEdges||[],all=d.allEdges||[];
const ids=new Set(nodes.map(n=>n.id));
const paths=nodes.map(n=>n.filePath.split('/'));
let pre=[];if(paths.length){const f=paths[0];for(let i=0;i<f.length-1;i++){if(paths.every(p=>p.length>i+1&&p[i]===f[i]))pre.push(f[i]);else break;}}
const groupOf={},dg={},ntg={};
for(const n of nodes){const p=n.filePath.split('/').slice(pre.length);const g=p.length>1?p[0]:'root';groupOf[n.id]=g;(dg[g]=dg[g]||[]).push(n.id);(ntg[n.type]=ntg[n.type]||[]).push(n.id);}
const fin={},fout={},inter={},intra={};
for(const e of imp){if(!ids.has(e.source)||!ids.has(e.target))continue;fout[e.source]=(fout[e.source]||0)+1;fin[e.target]=(fin[e.target]||0)+1;
const a=groupOf[e.source],b=groupOf[e.target];for(const g of new Set([a,b])){intra[g]=intra[g]||{internalEdges:0,totalEdges:0};intra[g].totalEdges++;}
if(a===b)intra[a].internalEdges++;else{const k=a+'->'+b;inter[k]=(inter[k]||0)+1;}}
for(const g in intra)intra[g].density=+(intra[g].internalEdges/intra[g].totalEdges).toFixed(2);
const type=Object.fromEntries(nodes.map(n=>[n.id,n.type]));const cc={};
for(const e of all){if(!type[e.source]||!type[e.target]||type[e.source]===type[e.target])continue;const k=[type[e.source],type[e.target],e.type].join('|');cc[k]=(cc[k]||0)+1;}
const pm={api:['routes','api','controllers','endpoints','handlers'],service:['services','core','lib','domain','logic'],data:['models','db','data'],ui:['components','views','pages','ui'],utility:['utils','helpers','common','shared','tools'],test:['__tests__','test','tests','spec'],types:['types','interfaces','schemas'],hooks:['hooks'],documentation:['docs']};
const patternMatches={};for(const g in dg)for(const l in pm)if(pm[l].includes(g))patternMatches[g]=l;
const interArr=Object.entries(inter).map(([k,c])=>{const[f,t]=k.split('->');return{from:f,to:t,count:c}});
const dir=[];for(const x of interArr){const r=inter[x.to+'->'+x.from]||0;if(x.count>=r&&!(x.count===r&&x.from>x.to))dir.push({dependent:x.from,dependsOn:x.to});}
const fp=nodes.map(n=>n.filePath);
const docs=Object.keys(dg).filter(g=>dg[g].some(i=>/\.md$/i.test(i)));
const out={scriptCompleted:true,commonPrefix:pre.join('/'),directoryGroups:dg,nodeTypeGroups:ntg,
crossCategoryEdges:Object.entries(cc).map(([k,c])=>{const[a,b,t]=k.split('|');return{fromType:a,toType:b,edgeType:t,count:c}}),
interGroupImports:interArr,intraGroupDensity:intra,patternMatches,
deploymentTopology:{hasDockerfile:fp.some(p=>/Dockerfile/.test(p)),hasCompose:fp.some(p=>/docker-compose/.test(p)),hasK8s:false,hasTerraform:fp.some(p=>/\.tf$/.test(p)),hasCI:fp.some(p=>/\.github\/workflows|gitlab-ci|Jenkinsfile/.test(p)),infraFiles:fp.filter(p=>/Dockerfile|docker-compose|\.tf$|\.github|Makefile/.test(p))},
dataPipeline:{schemaFiles:fp.filter(p=>/\.(sql|graphql|gql|proto)$/.test(p)),migrationFiles:fp.filter(p=>/migrations\//.test(p)),dataModelFiles:[],apiHandlerFiles:[]},
docCoverage:{groupsWithDocs:docs.length,totalGroups:Object.keys(dg).length,coverageRatio:+(docs.length/Object.keys(dg).length).toFixed(2),undocumentedGroups:Object.keys(dg).filter(g=>!docs.includes(g))},
dependencyDirection:dir,
fileStats:{totalFileNodes:nodes.length,filesPerGroup:Object.fromEntries(Object.entries(dg).map(([g,a])=>[g,a.length])),nodeTypeCounts:Object.fromEntries(Object.entries(ntg).map(([g,a])=>[g,a.length]))},
fileFanIn:fin,fileFanOut:fout};
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2));
}catch(e){console.error(e.stack);process.exit(1);}
