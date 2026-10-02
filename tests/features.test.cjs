'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const libraryModel=require('../assets/js/library-model.js');
function bank(){return{version:1,categories:[{id:'science',name:'科学'}],subjects:[{id:'algebra',name:'代数',categoryId:'science',questions:[{id:'q1',question:'问题一',answer:'答案一',gist:''},{id:'q2',question:'问题二',answer:'答案二',gist:''}]}]};}
test('library editing, deletion, moving subjects and export validation preserve stable IDs',()=>{
  const input=bank();const edited=libraryModel.edit(input,'algebra','q1',{question:'修正问题',answer:'修正答案'});
  assert.equal(edited.subjects[0].questions[0].id,'q1');assert.equal(input.subjects[0].questions[0].question,'问题一');
  const removed=libraryModel.edit(edited,'algebra','q1',null);assert.equal(removed.subjects[0].questions.length,1);
  assert.equal(libraryModel.edit(removed,'algebra','q2',null).subjects.length,0);
  edited.categories.push({id:'personal',name:'笔记'});edited.subjects[0].categoryId='personal';
  assert.equal(libraryModel.validate(JSON.parse(JSON.stringify(edited))).subjects[0].categoryId,'personal');
});
test('import preview separates adds/updates/removals and defaults to retaining missing questions',()=>{
  const original=bank(),incoming=bank();incoming.subjects[0].questions=[{id:'q1',question:'新问题',answer:'新答案',gist:''},{id:'q3',question:'新增',answer:'答案',gist:''}];
  const merged=libraryModel.plan(original,incoming,'merge');assert.equal(merged.changes.added.length,1);assert.equal(merged.changes.changed.length,1);assert.equal(merged.changes.removed.length,0);assert.equal(merged.library.subjects[0].questions.length,3);
  const replaced=libraryModel.plan(original,incoming,'replace');assert.equal(replaced.changes.removed.length,1);assert.equal(replaced.library.subjects[0].questions.length,2);
  incoming.subjects[0].questions[0].answer='长'.repeat(20001);assert.throws(()=>libraryModel.validate(incoming),/不会截断/);
  assert.equal(incoming.subjects[0].questions[0].answer.length,20001);
});
test('content replacement reset is a durable review event and survives merging old progress',()=>{
  const engine=require('../assets/js/review-engine.js'),old=engine.createCard();engine.apply(old,'mastered',95,100,false,1000,{id:'old',fullHistory:true});
  const replacement=JSON.parse(JSON.stringify(old));engine.apply(replacement,null,null,null,true,2000,{id:'reset',fullHistory:true});
  const merged=engine.merge(old,replacement);assert.equal(merged.level,null);assert.equal(merged.gate,0);assert.equal(merged.due,0);assert.equal(merged.lastScore,undefined);
  assert.equal(libraryModel.plan(bank(),bank(),'merge').changes.changed.length,0);
});
test('confirmed extraction rows enter the library directly with current file filtering',()=>{
  let incoming,toast;
  const scope={window:{KnowledgeLibrary:{categories:[{id:'science',name:'科学'}],importText:text=>incoming=JSON.parse(text)}},console};
  vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'assets/js/extract-exports.js'),'utf8'),scope);
  const ctx={st:{filterFile:'f1',files:[{id:'f1',name:'课本',categoryId:'science'},{id:'f2',name:'其他',categoryId:'science'}],points:[],questions:[{id:'q1',fileId:'f1',status:'已确认',question:'问题',answer:'答案'},{id:'q2',fileId:'f1',status:'待确认',question:'未确认',answer:'答案'},{id:'q3',fileId:'f2',status:'已确认',question:'未选文件',answer:'答案'}]},toast:text=>toast=text};
  const exports=scope.window.extractExports(ctx);exports.addToLibrary();
  assert.equal(incoming.subjects.length,1);assert.equal(incoming.subjects[0].questions.length,1);assert.equal(incoming.subjects[0].questions[0].id,'q1');
  ctx.st.questions=[];incoming=null;exports.addToLibrary();assert.equal(incoming,null);assert.match(toast,/确认/);
});

test('long documents cover all chunks, retry failed batches and retain successful batches',async()=>{
 const gen=require('../assets/js/extract-generation.js');const blocks=Array.from({length:55},(_,i)=>({text:'正文'+i,pageFrom:i+1}));let calls=0,received=[];
 const result=await gen.run(blocks,async b=>{calls++;if(b[0].pageFrom===11&&calls===2)throw new Error('temporary');return b;},async rows=>received.push(...rows));
 assert.equal(result.done,55);assert.equal(received.length,55);assert.equal(calls,7);assert.equal(result.failures.length,0);
 const failed=await gen.run(blocks,async b=>{if(b[0].pageFrom===21)throw new Error('persistent');return b;},async()=>{});
 assert.equal(failed.done,45);assert.equal(failed.failures[0].blocks.length,10);assert.equal(failed.failures[0].blocks[0].pageFrom,21);
 assert.equal(gen.key({question:'  同一  题目 '}),gen.key({question:'同一 题目'}));
});

test('module review strategies preserve history and choose distinct next review intervals',()=>{
 const engine=require('../assets/js/review-engine.js');for(const [strategy,interval] of [['default',7],['language',1],['concept',3],['practice',2]]){const c=engine.createCard();engine.apply(c,'skilled',80,100,false,1000,{id:'a',strategy});engine.apply(c,'skilled',80,100,false,2000,{id:'b',strategy});assert.equal(c.interval,interval);assert.equal(engine.merge(c,c).due,c.due);}
});
test('timestamp-based recent modules converge across devices and keep the newest five',()=>{
 const cloud=require('../assets/js/cloud-model.js');const a=cloud.empty(),b=cloud.empty();a.preferences={names:{},categories:[],recent:['a','b','c'],lastUsed:{a:100,b:90,c:80},strategies:{a:'language'}};b.preferences={names:{},categories:[],recent:['d','e','f'],lastUsed:{d:110,e:105,f:95},strategies:{}};
 const ab=cloud.merge(cloud.empty(),a,b).snapshot,ba=cloud.merge(cloud.empty(),b,a).snapshot;assert.deepEqual(ab.preferences.recent,['d','e','a','f','b']);assert.deepEqual(ab.preferences,ba.preferences);assert.equal(ab.preferences.strategies.a,'language');
});

test('choice and fill questions retain metadata and grade without a remote AI service',()=>{
 const model=require('../assets/js/question-model.js');const b=bank();b.subjects[0].questions=[{id:'q',question:'选择',answer:'B',type:'选择题',options:['一','二'],explanation:'解析',source:'课本第1页'}];const q=libraryModel.validate(b).subjects[0].questions[0];assert.equal(q.type,'选择题');assert.deepEqual(q.options,['一','二']);assert.equal(q.explanation,'解析');assert.equal(model.grade(q,'b'),true);assert.equal(model.grade(q,'A'),false);assert.throws(()=>model.grade(q,''),/作答/);assert.equal(model.grade({type:'填空题',answer:'Hello|你好'},'  ＨＥＬＬＯ '),true);assert.equal(model.grade({type:'填空题',answer:'Hello'},'再见'),false);
});

test('complete backups round trip library, progress and module preferences without credentials or originals',()=>{
 const backup=require('../assets/js/backup-model.js'),engine=require('../assets/js/review-engine.js');const c=engine.createCard();engine.apply(c,'skilled',80,90,false,1000);const snapshot={version:1,library:bank(),progress:{cards:{'custom-algebra-q1':c}},preferences:{names:{science:'科学笔记'},categories:[],recent:['science'],lastUsed:{science:1000},strategies:{science:'concept'}},originalPdf:'private.pdf',token:'secret'};
 const packed=backup.pack(snapshot);assert.equal(JSON.stringify(packed).includes('private.pdf'),false);assert.equal(JSON.stringify(packed).includes('secret'),false);const restored=backup.validate(JSON.parse(JSON.stringify(packed)));assert.deepEqual(restored.library,libraryModel.validate(bank()));assert.deepEqual(restored.progress,snapshot.progress);assert.deepEqual(restored.preferences,snapshot.preferences);packed.data.progress.cards.x={history:[{ts:'invalid',level:'skilled'}]};assert.throws(()=>backup.validate(packed),/学习记录/);assert.throws(()=>backup.validate({version:1}),/完整备份/);
});

test('backup controller previews before writing, merges records, rejects bad files and can undo restoration',async()=>{
 const cloud=require('../assets/js/cloud-model.js'),backup=require('../assets/js/backup-model.js'),prefs=require('../assets/js/library-preferences.js');const entries=new Map(),nodes={};let reloads=0,exported;
 class Node{constructor(){this.value='';this.disabled=false;this.textContent='';}append(){}setAttribute(){}showModal(){}close(){}}
 const storage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),batch:values=>Object.entries(values).forEach(([k,v])=>entries.set(k,v))};
 const local=cloud.empty();local.library=bank();local.preferences.names.science='本机名称';entries.set('knowledge-library-v1',JSON.stringify(local.library));entries.set('knowledge-library-preferences-v1',JSON.stringify(local.preferences));entries.set('eb-review-system-v1',JSON.stringify(local.progress));
 const scope={window:{KnowledgeStorage:storage,KnowledgeLibrary:{getCustom:()=>JSON.parse(storage.getItem('knowledge-library-v1'))},LibraryPreferences:prefs,BackupModel:backup,CloudModel:cloud,KnowledgeDownload:(name,data)=>exported=data},document:{createElement:()=>new Node(),body:{append:()=>{}},querySelector:()=>new Node(),getElementById:id=>nodes[id]||(nodes[id]=new Node())},location:{reload:()=>reloads++},Blob,console};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(root,'assets/js/backup.js'),'utf8'),scope);
 nodes.backupExport.onclick();assert.equal(exported.format,'knowledge-review-backup');const restore=cloud.empty();restore.library=bank();restore.preferences.names.science='恢复名称';restore.library.subjects[0].questions.push({id:'q3',question:'恢复题目',answer:'恢复答案',gist:''});nodes.backupPaste=new Node();nodes.backupMode=new Node();nodes.backupPaste.value=JSON.stringify(backup.pack(restore));nodes.backupPreview.onclick();assert.equal(nodes.backupApply.disabled,false);assert.match(nodes.backupSummary.textContent,/3 道题/);assert.equal(storage.getItem('knowledge-library-v1'),JSON.stringify(local.library));nodes.backupMode.value='merge';nodes.backupApply.onclick();assert.equal(reloads,1);assert.equal(JSON.parse(storage.getItem('knowledge-library-v1')).subjects[0].questions.length,3);assert.equal(JSON.parse(storage.getItem('knowledge-library-preferences-v1')).names.science,'恢复名称');nodes.backupUndo.onclick();assert.equal(JSON.parse(storage.getItem('knowledge-library-v1')).subjects[0].questions.length,2);
 await nodes.backupFile.onchange({target:{files:[{size:10,text:async()=>'{bad'}],value:'selected'}});assert.equal(nodes.backupApply.disabled,true);assert.equal(JSON.parse(storage.getItem('knowledge-library-v1')).subjects[0].questions.length,2);
});

test('backup rejects invalid current mastery even with a valid empty history',()=>{const backup=require('../assets/js/backup-model.js'),cloud=require('../assets/js/cloud-model.js');const value=backup.pack(cloud.empty());value.data.progress.cards.bad={level:'invalid',history:[]};assert.throws(()=>backup.validate(value),/学习记录/);});

test('failed extraction persistence is reported and later batches continue',async()=>{const gen=require('../assets/js/extract-generation.js');const blocks=Array.from({length:11},(_,i)=>({text:'body',pageFrom:i+1}));const result=await gen.run(blocks,async()=>[],async(rows,b)=>{if(b[0].pageFrom===1)throw new Error('storage full');});assert.equal(result.done,1);assert.equal(result.failures.length,1);assert.equal(result.failures[0].message,'storage full');});
