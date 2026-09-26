/* Picks the book: the three.js book (book3d.js) where WebGL works and motion is welcome, otherwise the
   page-flip book (StPageFlip + book.js). The owner picks in 手帐设置 (bookMode): "auto" (the default) gives
   phones the page-flip book, which shows the live page as it turns and is light on memory, and everything
   bigger the 3D book; "3d" / "flip" use one everywhere. ?book=3d / ?book=flip force one. If the 3D book fails to start it
   hands over to the page-flip book. */
(function(){
  "use strict";
  // ?book= wins (for trying one out); otherwise the owner's choice in 手帐设置 → 翻页方式
  var set=(window.TECHO_DATA&&window.TECHO_DATA.settings)||{};
  // a phone: a touch screen too narrow for a spread either way up (a tablet or a narrow desktop window isn't)
  var phone=Math.min(screen.width,screen.height)<640&&!!(window.matchMedia&&matchMedia('(pointer: coarse)').matches);
  var mode=set.bookMode||'auto';
  var q=new URLSearchParams(location.search).get('book')||(mode==='flip'||(mode==='auto'&&phone)?'flip':null);
  function script(src){return new Promise(function(res,rej){var s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.body.appendChild(s);});}
  function flip(){return script('/vendor/page-flip.browser.js').then(function(){return script('/assets/book.js');});}
  function webgl(){try{var c=document.createElement('canvas');return !!(window.WebGLRenderingContext&&(c.getContext('webgl2')||c.getContext('webgl')));}catch(e){return false;}}
  var reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!(q==='3d'||(q!=='flip'&&!reduced&&webgl()))){flip();return;}
  var load;
  // kept out of this file's syntax, so a browser without dynamic import() still gets the page-flip book
  try{load=new Function('u','return import(u)');}catch(e){flip();return;}
  load('/assets/book3d.js').then(function(m){return m.start();}).catch(function(err){
    console.warn('techo: 3D book failed, using the page-flip book',err);
    var host=document.querySelector('.book3d');if(host)host.remove();
    document.body.classList.remove('is-3d');
    // the 3D book may already have used up the page sources: then a clean reload is the way back
    if(document.getElementById('static'))flip();
    else{var u=new URL(location.href);u.searchParams.set('book','flip');location.replace(u.href);}
  });
})();
