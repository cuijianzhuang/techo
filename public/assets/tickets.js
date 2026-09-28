/* The ticket folder (/tickets/): every 机票, 车票 and 电影票 written in the diary, in clear pockets, a month to a
   leaf, newest first, each with a line of what the month held (flights, trains, films). #flight / #train /
   #cinema shows one kind. A ticket opens as it is in the diary. (账单 have a book of their own: /bills/.) */
(async function(){
  "use strict";
  const T=window.Techo,K=window.Keep,{el,parseDate}=T;
  const box=document.getElementById('folder'),stat=document.getElementById('stat'),tabs=document.getElementById('tabs');
  let entries;
  try{({entries}=await K.load('票夹'));}
  catch(err){console.warn('techo tickets:',err);K.say(box,'暂时翻不开票夹，过一会儿再来。<br><a href="/">回到手帐</a>');return;}

  const KINDS=[['all','全部'],['flight','机票'],['train','车票'],['cinema','电影票']];
  const tickets=[];
  entries.forEach(en=>T.cardsOf(en.body).forEach(c=>{if(['flight','train','cinema'].includes(c.kind))tickets.push({kind:c.kind,lines:c.lines,en});}));
  const count=(list,k)=>list.filter(t=>t.kind===k).length;
  // what a set of tickets comes to, in words
  function sum(list){
    const out=[],f=count(list,'flight'),tr=count(list,'train'),c=count(list,'cinema');
    if(f)out.push('飞了 '+f+' 趟');if(tr)out.push('火车 '+tr+' 趟');if(c)out.push('看了 '+c+' 场电影');
    return out.join(' · ');
  }
  if(!tickets.length){K.say(box,'票夹还空着。<br>在日记里写 <code>```机票</code>、<code>```车票</code> 或 <code>```电影票</code>，就会夹到这里。');return;}
  stat.textContent=tickets.length+' 张　·　'+sum(tickets);

  let at=(KINDS.find(k=>'#'+k[0]===location.hash)||KINDS[0])[0];
  function draw(){
    tabs.textContent='';
    KINDS.forEach(([k,label])=>{
      const n=k==='all'?tickets.length:count(tickets,k);
      if(k!=='all'&&!n)return;
      const b=el('button',null,label+' '+n);b.type='button';b.setAttribute('aria-pressed',String(at===k));
      b.onclick=()=>{at=k;history.replaceState(null,'',k==='all'?location.pathname:'#'+k);draw();};tabs.appendChild(b);
    });
    box.textContent='';
    const list=at==='all'?tickets:tickets.filter(t=>t.kind===at);
    // a leaf a month
    const months=new Map();
    list.forEach(t=>{const k=t.en.date.slice(0,7);if(!months.has(k))months.set(k,[]);months.get(k).push(t);});
    months.forEach((ts,k)=>{
      const [y,m]=k.split('-');
      const h=el('h2','kp-year',y+' 年 '+(+m)+' 月');h.appendChild(el('small',null,ts.length+' 张'));
      const leaf=el('section','tk-leaf'),pockets=el('div','tk-pockets');
      leaf.appendChild(el('p','tk-sum',sum(ts)));
      ts.forEach(t=>{
        const b=el('button','kp-pocket');b.type='button';
        const jp=el('div','jp'),tx=el('div','jtext');tx.appendChild(T.cardNode(t.kind,t.lines));jp.appendChild(tx);
        b.append(jp,el('span','tk-date',K.dayOf(t.en)+' · '+(t.en.title||'（无题）')));
        b.setAttribute('aria-label',{flight:'机票',train:'车票',cinema:'电影票'}[t.kind]+'，'+K.dayOf(t.en));
        b.onclick=()=>K.show(t.kind,t.lines,[t.en]);
        pockets.appendChild(b);
      });
      leaf.appendChild(pockets);box.append(h,leaf);
    });
  }
  draw();
})();
