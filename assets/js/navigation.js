(function(){
 'use strict';var aside=document.querySelector('aside');aside.id='knowledgeDirectory';
 var toggle=document.createElement('button');toggle.className='sync-btn mobile-directory';toggle.textContent='目录与学习统计';toggle.setAttribute('aria-controls',aside.id);toggle.setAttribute('aria-expanded','false');document.querySelector('.library-tools').prepend(toggle);
 function close(){aside.classList.remove('mobile-open');toggle.setAttribute('aria-expanded','false');}
 var closeButton=document.createElement('button');closeButton.className='sync-btn mobile-directory';closeButton.textContent='关闭目录';closeButton.onclick=close;aside.prepend(closeButton);
 toggle.onclick=function(){var open=aside.classList.toggle('mobile-open');toggle.setAttribute('aria-expanded',String(open));};
 aside.addEventListener('click',function(e){var sec=e.target.closest('.sec'),chap=e.target.closest('.chap');if(sec){var ul=sec.nextElementSibling;if(ul&&ul.tagName==='UL'){var hidden=ul.style.display==='none';ul.style.display=hidden?'':'none';sec.classList.toggle('collapsed',!hidden);}}else if(chap){e.preventDefault();var siblings=[],sib=chap.nextElementSibling;while(sib&&!sib.classList.contains('chap')){siblings.push(sib);sib=sib.nextElementSibling;}var visible=siblings.some(function(el){return el.style.display!=='none';});siblings.forEach(function(el){el.style.display=visible?'none':'';});chap.classList.toggle('collapsed',visible);}else if(e.target.closest('a'))close();});
 document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
})();
