(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.QuestionModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';function normalize(s){return String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();}
 function grade(q,value){if(!normalize(value))throw new Error('请先作答');if(q.type==='选择题')return String(q.answer).trim().toUpperCase()===String(value).trim().toUpperCase();if(q.type==='填空题')return String(q.answer).split('|').some(function(answer){return normalize(answer)===normalize(value);});throw new Error('简答题请自评或使用 AI 判分');}
 return{grade:grade};
});
