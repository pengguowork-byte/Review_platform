(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LibraryModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var copy=function(v){return JSON.parse(JSON.stringify(v));};
  function text(v,max,label,optional){if(optional&&v==null)return '';if(typeof v!=='string'||(!optional&&!v.trim())||v.length>max)throw new Error(label+'需为'+(optional?'0':'1')+'–'+max+'个字符，超长内容不会截断');return v;}
  function validate(input,base,prefs){
    base=base||{categories:[],subjects:[]};prefs=prefs||{categories:[]};
    if(!input||input.version!==1||!Array.isArray(input.categories)||!Array.isArray(input.subjects))throw new Error('题库需包含 version:1、categories 和 subjects 数组');
    if(input.categories.length>100||input.subjects.length>100)throw new Error('最多100个模块或专题');
    var ids=new Set(),cardIds=new Set(),count=0;
    var categories=input.categories.map(function(c){if(!c||!/^[a-z][a-z0-9-]{0,63}$/.test(c.id)||ids.has(c.id))throw new Error('模块ID无效或重复');ids.add(c.id);return{id:c.id,name:text(c.name,60,'模块名称').trim()};});
    var cids=new Set(base.categories.concat(prefs.categories||[],categories).map(function(c){return c.id;}));ids=new Set();
    var subjects=input.subjects.map(function(s){
      if(!s||!/^[a-z][a-z0-9-]{0,63}$/.test(s.id)||ids.has(s.id)||base.subjects.some(function(b){return b.id===s.id;}))throw new Error('专题ID无效、重复或与内置专题冲突');
      ids.add(s.id);if(!cids.has(s.categoryId)||!Array.isArray(s.questions)||!s.questions.length)throw new Error('专题需要有效模块和非空题目列表');
      var qids=new Set();var questions=s.questions.map(function(q){
        if(!q||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(q.id)||qids.has(q.id))throw new Error('题目ID无效或重复');qids.add(q.id);var cardId=cid(s.id,q.id);if(cardIds.has(cardId))throw new Error('题目ID组合冲突，请调整专题或题目ID');cardIds.add(cardId);count++;
        var out={id:q.id,question:text(q.question,2000,'题干'),answer:text(q.answer,20000,'答案'),gist:text(q.gist,2000,'一句话结论',true)};
        if(q.type){if(!['选择题','填空题','简答题'].includes(q.type))throw new Error('不支持的题型');out.type=q.type;}
        if(q.options){if(!Array.isArray(q.options)||q.options.length>8)throw new Error('选项最多8个');out.options=q.options.map(function(o){return text(o,2000,'选项');});}
        if(out.type==='选择题'&&(!out.options||out.options.length<2||!new RegExp('^[A-'+String.fromCharCode(64+out.options.length)+']$').test(out.answer.trim().toUpperCase())))throw new Error('选择题需2–8个选项，答案为对应字母');
        if(q.explanation)out.explanation=text(q.explanation,20000,'解析');
        if(q.source)out.source=text(q.source,2000,'出处');
        return out;
      });return{id:s.id,name:text(s.name,60,'专题名称').trim(),categoryId:s.categoryId,questions:questions};
    });if(count>2000)throw new Error('自定义题库最多2000道题');return{version:1,categories:categories,subjects:subjects};
  }
  function cid(s,q){return 'custom-'+s+'-'+q;}
  function plan(current,incoming,mode){
    var next=copy(current),changes={added:[],changed:[],removed:[]};
    incoming.categories.forEach(function(c){var i=next.categories.findIndex(function(x){return x.id===c.id;});if(i<0)next.categories.push(c);else next.categories[i]=c;});
    incoming.subjects.forEach(function(s){
      var i=next.subjects.findIndex(function(x){return x.id===s.id;}),old=i<0?null:next.subjects[i],target=copy(s);
      s.questions.forEach(function(q){var prev=old&&old.questions.find(function(x){return x.id===q.id;});var item={id:cid(s.id,q.id),title:q.question,before:prev,after:q};
        if(!prev)changes.added.push(item);else if(JSON.stringify(prev)!==JSON.stringify(q))changes.changed.push(item);
      });
      if(old){old.questions.forEach(function(q){if(!s.questions.some(function(x){return x.id===q.id;})){if(mode==='replace')changes.removed.push({id:cid(s.id,q.id),title:q.question});else target.questions.push(q);}});next.subjects[i]=target;}else next.subjects.push(target);
    });return{library:next,changes:changes};
  }
  function edit(bank,subjectId,questionId,replacement){var out=copy(bank),s=out.subjects.find(function(x){return x.id===subjectId;});if(!s)throw new Error('专题不存在');var i=s.questions.findIndex(function(q){return q.id===questionId;});if(i<0)throw new Error('题目不存在');if(replacement)s.questions[i]=Object.assign({},replacement,{id:questionId});else s.questions.splice(i,1);if(!s.questions.length)out.subjects=out.subjects.filter(function(x){return x.id!==subjectId;});return out;}
  return{validate:validate,plan:plan,edit:edit,cid:cid,copy:copy};
});
