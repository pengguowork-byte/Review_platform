'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const model = require('../assets/js/cloud-model.js');
const engine = require('../assets/js/review-engine.js');
const root = path.resolve(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));
function bank() {
  const data = model.empty();
  data.library.categories.push({id:'languages',name:'语言学习'});
  data.library.subjects.push({id:'english',name:'英语',categoryId:'languages',questions:[{id:'one',question:'问题一',answer:'答案一'}]});
  return data;
}
test('independent question fields and newly created modules merge without loss', () => {
  const base = bank(), local = copy(base), remote = copy(base);
  local.library.subjects[0].questions[0].question = '本机问题';
  remote.library.subjects[0].questions[0].answer = '远端答案';
  remote.preferences.categories.push({id:'module-new',name:'个人笔记'});
  const result = model.merge(base,local,remote);
  assert.equal(result.conflicts.length,0);
  assert.deepEqual(result.snapshot.library.subjects[0].questions[0],{id:'one',question:'本机问题',answer:'远端答案'});
  assert.equal(result.snapshot.preferences.categories[0].name,'个人笔记');
});
test('same-field changes and deletion versus edit require explicit conflict resolution', () => {
  const base = bank(), local = copy(base), remote = copy(base);
  local.preferences.names.languages = '我的英语'; remote.preferences.names.languages = '语言';
  const conflict = model.merge(base,local,remote);
  assert.equal(conflict.conflicts[0].path,'names/languages');
  assert.equal(model.merge(base,local,remote,{'names/languages':'remote'}).snapshot.preferences.names.languages,'语言');
  local.library.subjects = [];
  remote.library.subjects[0].questions[0].answer = '新的答案';
  const result = model.merge(base,local,remote);
  assert.ok(result.conflicts.some(c=>c.path==='subjects/english'));
});
test('cloud history keeps over 60 events, deduplicates event IDs and converges', () => {
  const base = engine.createCard();
  const local = copy(base), remote = copy(base);
  for(let i=0;i<90;i++) engine.apply(local,'fuzzy',40,90,false,1000+i,{id:'local-'+i,fullHistory:true});
  engine.apply(remote,'skilled',70,90,false,2000,{id:'remote-1',fullHistory:true});
  const merged = engine.merge(local,remote);
  assert.equal(merged.history.length,91); assert.equal(merged.quizzes,91);
  assert.deepEqual(engine.merge(merged,local),merged);
  assert.deepEqual(engine.merge(remote,local),merged);
  const a = engine.createCard(), b = engine.createCard();
  engine.apply(a,'fuzzy',40,90,false,100,{id:'a',fullHistory:true});
  engine.apply(b,'fuzzy',40,90,false,100,{id:'b',fullHistory:true});
  assert.equal(engine.merge(a,b).history.length,2);
});
test('unsafe object keys are rejected even when both snapshots are identical', () => {
  const bad = bank(); bad.preferences.names = JSON.parse('{"__proto__":{"x":1}}');
  assert.throws(()=>model.merge(model.empty(),bad,bad),/不安全/);
});

function harness(options={}) {
  const account = options.account === undefined ? 'user-one' : options.account;
  const entries = new Map(account ? [['knowledge-cloud-account',account]] : []);
  const listeners = {}, nodes = {}, timers = [];
  let row = options.remote ? {version:1,payload:copy(options.remote)} : null;
  let writes=0, reads=0, reloads=0;
  class Element {
    constructor(){ this.hidden=false; this.textContent=''; this.children=[]; this.events={}; this.value=''; }
    addEventListener(name,callback){this.events[name]=callback;}
    appendChild(child){this.children.push(child);return child;}
    replaceChildren(){this.children=[];}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const localStorage = {getItem:key=>entries.has(key)?entries.get(key):null,setItem:(key,val)=>entries.set(key,String(val)),removeItem:key=>entries.delete(key)};
  const document = {
    hidden:false,querySelector:()=>options.editing?{}:null,
    getElementById:id=>nodes[id]||(nodes[id]=new Element()),
    createElement:()=>new Element(),createTextNode:text=>({textContent:text}),
    addEventListener:(name,callback)=>(listeners[name]||(listeners[name]=[])).push(callback),
    dispatchEvent:event=>(listeners[event.type]||[]).forEach(callback=>callback(event))
  };
  const client = {
    auth:{getSession:async()=>({data:{session:account?{user:{id:account,email:'test@example.invalid'}}:null}}),onAuthStateChange:()=>{},signOut:async()=>{},signInWithPassword:async()=>({data:{user:{id:'user-one'}}})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>{reads++; if(options.fail) return {error:{message:'offline test'}};return {data:copy(row)};}})})}),
    rpc:async(name,args)=>{
      writes++;
      if(options.race && writes===1){row={version:2,payload:copy(options.race)};return {data:{accepted:false}};}
      if(options.inFlight && writes===1) options.inFlight(scope);
      if((row?row.version:0)!==args.expected_version)return {data:{accepted:false}};
      row={version:(row?row.version:0)+1,payload:copy(args.new_payload)};return {data:{accepted:true,version:row.version}};
    }
  };
  const scope = {
    localStorage,document,navigator:{onLine:options.online!==false},location:{reload:()=>reloads++},
    CloudModel:model,ReviewEngine:engine,LibraryPreferences:require('../assets/js/library-preferences.js'),
    KnowledgeLibrary:{validate:()=>{},refresh:()=>{document.structureUpdates=(document.structureUpdates||0)+1;}},KNOWLEDGE_CLOUD_CONFIG:options.disabled?{}:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_test'},
    supabase:{createClient:()=>client},CustomEvent:class {constructor(type,init){this.type=type;this.detail=init&&init.detail;}},
    Blob,AbortSignal,fetch:()=>{throw new Error('Unexpected real network');},atob,
    setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout:()=>{},setInterval:()=>{},
    addEventListener:(name,callback)=>(listeners[name]||(listeners[name]=[])).push(callback)
  };
  scope.window=scope; vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(root,'assets/js/knowledge-storage.js'),'utf8'),scope);
  const keys=['knowledge-library-v1','eb-review-system-v1','knowledge-library-preferences-v1'];
  function set(data,guest=false) {
    [data.library,data.progress,data.preferences].forEach((value,i)=>{
      const key=guest||!account?keys[i]:'knowledge-user:'+account+':'+keys[i]; entries.set(key,JSON.stringify(value));
    });
  }
  set(options.local||model.empty());
  if(options.base) entries.set(scope.KnowledgeStorage.metaKey('baseline'),JSON.stringify(options.base));
  vm.runInContext(fs.readFileSync(path.join(root,'assets/js/cloud-sync.js'),'utf8'),scope);
  return {scope,nodes,entries,set,timers,click:async id=>{await new Promise(resolve=>setImmediate(resolve));await nodes[id].events.click();await new Promise(resolve=>setImmediate(resolve));},get row(){return row;},get reads(){return reads;},get writes(){return writes;},get reloads(){return reloads;}};
}
test('controller retries a cloud version race and preserves both devices edits', async () => {
  const local=bank(), concurrent=bank(); concurrent.preferences.names.languages='云端模块名';
  local.library.subjects[0].questions.push({id:'two',question:'问题二',answer:'答案二'});
  const h=harness({local,base:bank(),remote:bank(),race:concurrent});
  await h.click('cloudSyncNow');
  assert.equal(h.writes,2);
  assert.equal(h.row.payload.library.subjects[0].questions.length,2);
  assert.equal(h.row.payload.preferences.names.languages,'云端模块名');
  assert.match(h.nodes.cloudStatus.textContent,/已同步/);
  assert.equal(h.scope.KnowledgeStorage.requireRefresh,false);assert.equal(h.scope.document.structureUpdates,1);
});
test('controller keeps changes made during an upload rather than replacing them', async () => {
  const local=bank();
  const h=harness({local,inFlight:scope=>{
    const next=copy(local); next.preferences.names.languages='上传期间改名';
    scope.KnowledgeStorage.setItem('knowledge-library-preferences-v1',JSON.stringify(next.preferences));
  }});
  await h.click('cloudSyncNow');
  assert.equal(h.row.payload.preferences.names.languages,'上传期间改名');
  assert.equal(h.writes,2);
});
test('offline and failed requests preserve local content and do not claim success', async () => {
  const offline=harness({local:bank(),online:false});
  await offline.click('cloudSyncNow');assert.equal(offline.reads,0);assert.match(offline.nodes.cloudStatus.textContent,/离线/);
  const failed=harness({local:bank(),fail:true});
  await failed.click('cloudSyncNow');assert.equal(failed.writes,0);assert.match(failed.nodes.cloudStatus.textContent,/失败/);
  assert.equal(JSON.parse(failed.scope.KnowledgeStorage.getItem('knowledge-library-v1')).subjects.length,1);
});
test('controller stops on a conflicting name until user resolves it', async () => {
  const local=bank(),remote=bank();local.preferences.names.languages='本机名称';remote.preferences.names.languages='云端名称';
  const h=harness({local,remote,base:bank()});await h.click('cloudSyncNow');
  assert.equal(h.writes,0);assert.equal(h.nodes.cloudDialog.open,true);assert.equal(h.nodes.cloudConflicts.children.length,1);
  const radio=h.nodes.cloudConflicts.children[0].children[2].children[0];radio.events.change();
  await h.click('cloudResolve');
  assert.equal(h.writes,0); // choosing the cloud copy requires no additional cloud write
  assert.equal(JSON.parse(h.scope.KnowledgeStorage.getItem('knowledge-library-preferences-v1')).names.languages,'云端名称');
});
test('account data never automatically imports guest content and is isolated', async () => {
  const h=harness();h.set(bank(),true);await h.click('cloudSyncNow');
  assert.equal(h.row,null);
  assert.equal(JSON.parse(h.entries.get('knowledge-library-v1')).subjects.length,1);
  await h.click('cloudMigrate');
  assert.equal(JSON.parse(h.scope.KnowledgeStorage.getItem('knowledge-library-v1')).subjects.length,1);
  h.entries.set('knowledge-cloud-account','user-two');
  assert.throws(()=>h.scope.KnowledgeStorage.setItem('eb-review-system-v1','{}'),/账号已变化/);
});
test('deployment output excludes server/private files and rejects privileged keys', () => {
  const env={...process.env};delete env.SUPABASE_URL;delete env.SUPABASE_PUBLISHABLE_KEY;
  const secret='eyJ.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.test';
  const blocked=spawnSync(process.execPath,['scripts/build-cloud.cjs'],{cwd:root,env:{...env,SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:secret},encoding:'utf8'});
  assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/forbidden/);
  execFileSync(process.execPath,['scripts/build-cloud.cjs'],{cwd:root,env});
  const dirs=fs.readdirSync(path.join(root,'dist'));
  assert.ok(!dirs.includes('server')&&!dirs.includes('deepseek.key')&&!dirs.includes('supabase')&&!dirs.includes('archive'));
  const worker=fs.readFileSync(path.join(root,'dist/sw.js'),'utf8');
  assert.ok(worker.includes("url.pathname.startsWith('/api/')"));assert.ok(!worker.includes('__PRECACHE_FILES__'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'dist/manifest.webmanifest'),'utf8'));
  for(const icon of manifest.icons)assert.ok(fs.existsSync(path.join(root,'dist',icon.src)));
});

test('incoming content waits while a quiz is open and applies without a page reload afterwards',async()=>{
 const local=bank(),remote=bank();remote.preferences.names.languages='新名称';const options={local,base:local,remote,editing:true};const h=harness(options);await h.click('cloudSyncNow');assert.equal(h.scope.KnowledgeStorage.requireRefresh,true);assert.equal(h.scope.document.structureUpdates,undefined);assert.equal(h.reloads,0);options.editing=false;await h.click('cloudReload');assert.equal(h.scope.document.structureUpdates,1);assert.equal(h.scope.KnowledgeStorage.requireRefresh,false);assert.equal(h.reloads,0);
});
