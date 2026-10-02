(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ExtractGeneration=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function batches(blocks){var out=[],batch=[],size=0;blocks.forEach(function(b){if(batch.length&&(batch.length>=10||size+String(b.text).length>24000)){out.push(batch);batch=[];size=0;}batch.push(b);size+=String(b.text).length;});if(batch.length)out.push(batch);return out;}
  function key(row){return String(row.question||row.title||'').trim().replace(/\s+/g,' ');}
  async function run(blocks,call,onBatch,onProgress){var groups=batches(blocks),done=0,failures=[];for(var i=0;i<groups.length;i++){var rows,error;for(var attempt=0;attempt<2;attempt++){try{rows=await call(groups[i]);error=null;break;}catch(e){error=e;}}if(error)failures.push({index:i,blocks:groups[i],message:error.message});else{try{await onBatch(rows,groups[i]);done+=groups[i].length;}catch(e){failures.push({index:i,blocks:groups[i],message:e.message});}}if(onProgress)onProgress({done:done,total:blocks.length,batch:i+1,batches:groups.length,failures:failures});}return{done:done,total:blocks.length,failures:failures};}
  return{batches:batches,key:key,run:run};
});
