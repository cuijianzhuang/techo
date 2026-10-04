/* The bills (/bills/): every 账单 written in the diary, added up. This month, this year and the average month
   as figures; a column a month (the last twelve with bills), each telling its sum on hover or focus and
   picking that month when pressed; the month picked (the latest at first, #YYYY-MM) by what it went on, then
   its receipts in pockets, each opening as it is in the diary. What a bill went on: its "* 分组: ¥" lines, or
   its lines with an amount when it has no groups, or else its title; what a bill came to: its "= 合计" line, or
   what those add up to. */
(async function(){
  "use strict";
  const T=window.Techo,K=window.Keep,{el,parseDate}=T;
  const box=document.getElementById('book'),stat=document.getElementById('stat');
  let entries;
  try{({entries}=await K.load('账本'));}
  catch(err){console.warn('techo bills:',err);K.say(box,'暂时翻不开账本，过一会儿再来。<br><a href="/">回到手帐</a>');return;}

  const bill=K.bill;
  const bills=[];
  entries.forEach(en=>T.cardsOf(en.body).forEach(c=>{if(c.kind==='receipt')bills.push(Object.assign({lines:c.lines,en,month:en.date.slice(0,7)},bill(c.lines)));}));
  if(!bills.length){K.say(box,'账本还空着。<br>在日记里写 <code>```账单</code>，就会记到这里。');return;}

  const money=v=>'¥'+(Math.round(v*100)/100).toLocaleString('zh-CN',{minimumFractionDigits:Math.round(v*100)%100?2:0,maximumFractionDigits:2});
  const byMonth=new Map();
  bills.forEach(b=>{if(!byMonth.has(b.month))byMonth.set(b.month,[]);byMonth.get(b.month).push(b);});
  const sumOf=list=>list.reduce((a,b)=>a+b.total,0);
  const now=new Date(),thisMonth=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0'),thisYear=String(now.getFullYear());
  const yearList=bills.filter(b=>b.month.startsWith(thisYear)),yearMonths=new Set(yearList.map(b=>b.month)).size;
  const monthName=k=>{const [y,m]=k.split('-');return y+' 年 '+(+m)+' 月';};
  stat.textContent=bills.length+' 张小票 · 记了 '+byMonth.size+' 个月';

  // the figures
  const tiles=el('section','bl-tiles');
  const tile=(label,value,note,hero)=>{const t=el('div','bl-tile'+(hero?' hero':''));t.append(el('span','bl-label',label),el('b','bl-value',value));if(note)t.appendChild(el('span','bl-note',note));return t;};
  const tm=byMonth.get(thisMonth)||[];
  tiles.append(tile('本月',money(sumOf(tm)),tm.length?tm.length+' 张小票':'这个月还没记',true),
    tile('今年',money(sumOf(yearList)),yearList.length+' 张小票'),
    tile('平均每月',money(yearMonths?sumOf(yearList)/yearMonths:0),yearMonths?'今年记了 '+yearMonths+' 个月':''));

  // a column a month: the months from the first bill's to the last, the last twelve of them
  const keys=[...byMonth.keys()].sort(),months=[];
  {let [y,m]=keys[0].split('-').map(Number);const [ly,lm]=keys[keys.length-1].split('-').map(Number);
    while(y<ly||(y===ly&&m<=lm)){months.push(y+'-'+String(m).padStart(2,'0'));if(++m>12){m=1;y++;}}}
  const shown=months.slice(-12),vals=shown.map(k=>sumOf(byMonth.get(k)||[]));
  // the scale: a round top and four steps to it
  const niceStep=v=>{const p=Math.pow(10,Math.floor(Math.log10(v||1))),f=v/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;};
  const step=niceStep(Math.max(...vals,1)/4),top=Math.ceil(Math.max(...vals,1)/step)*step;
  const chart=el('section','bl-chart');
  {const h=el('h2','kp-year','每月');const r=k=>k.replace('-','.');h.appendChild(el('small',null,shown.length>1?r(shown[0])+' – '+r(shown[shown.length-1]):r(shown[0])));chart.appendChild(h);}
  const plot=el('div','bl-plot'),axis=el('div','bl-axis'),cols=el('div','bl-cols');
  for(let v=top;v>=0;v-=step){const g=el('div','bl-grid');g.style.bottom=(v/top*100)+'%';g.appendChild(el('span',null,v>=10000?(v/10000)+' 万':v.toLocaleString('zh-CN')));axis.appendChild(g);}
  const tip=el('div','bl-tip');tip.setAttribute('role','status');tip.hidden=true;
  let at=(/^#(\d{4}-\d{2})$/.exec(location.hash)||[])[1];if(!byMonth.has(at))at=keys[keys.length-1];
  const colEls=[];
  shown.forEach((k,i)=>{
    const [y,m]=k.split('-'),v=vals[i];
    const c=el('button','bl-col');c.type='button';c.dataset.k=k;
    c.setAttribute('aria-label',monthName(k)+'，'+money(v)+(v?'':'（没有小票）'));
    const bar=el('i','bl-bar');bar.style.height=(v/top*100)+'%';if(!v)bar.classList.add('none');
    c.append(bar,el('span','bl-mo',(+m)+'月'));
    const show=()=>{tip.textContent='';tip.append(el('b',null,money(v)),el('span',null,monthName(k)+(v?' · '+(byMonth.get(k)||[]).length+' 张':'')));
      tip.hidden=false;const r=c.getBoundingClientRect(),pr=plot.getBoundingClientRect();
      tip.style.left=Math.min(pr.width-tip.offsetWidth,Math.max(0,r.left-pr.left+r.width/2-tip.offsetWidth/2))+'px';tip.style.bottom=(Math.max(8,v/top*180)+34)+'px';};
    c.addEventListener('pointerenter',show);c.addEventListener('focus',show);
    c.addEventListener('pointerleave',()=>{tip.hidden=true;});c.addEventListener('blur',()=>{tip.hidden=true;});
    c.onclick=()=>{if(!byMonth.has(k))return;at=k;history.replaceState(null,'','#'+k);drawMonth();};
    colEls.push(c);cols.appendChild(c);
  });
  plot.append(axis,cols,tip);chart.appendChild(plot);
  // the same numbers, without a chart
  const tbl=el('details','bl-table');tbl.appendChild(el('summary',null,'按月看数字'));
  {const t=el('table');const hr=el('tr');['月份','小票','一共'].forEach(h=>hr.appendChild(el('th',null,h)));t.appendChild(hr);
    [...keys].reverse().forEach(k=>{const r=el('tr');r.append(el('td',null,monthName(k)),el('td',null,String(byMonth.get(k).length)),el('td',null,money(sumOf(byMonth.get(k)))));t.appendChild(r);});
    tbl.appendChild(t);}
  chart.appendChild(tbl);

  // the month picked: what it went on, and its receipts
  const month=el('section','bl-month');
  function drawMonth(){
    colEls.forEach(c=>c.setAttribute('aria-pressed',String(c.dataset.k===at)));
    const list=byMonth.get(at),total=sumOf(list);
    month.textContent='';
    const h=el('h2','kp-year',monthName(at));h.appendChild(el('small',null,money(total)+' · '+list.length+' 张小票'));
    const cat=new Map();list.forEach(b=>b.cats.forEach(([n,v])=>cat.set(n,(cat.get(n)||0)+v)));
    const rows=[...cat.entries()].sort((a,b)=>b[1]-a[1]),max=rows.length?rows[0][1]:1;
    const ul=el('ul','bl-cats');ul.setAttribute('aria-label',monthName(at)+'花在哪');
    // the amount at the bar's end
    const pc=v=>{const p=v/total*100;return p>0&&p<1?'<1%':Math.round(p)+'%';};
    rows.forEach(([n,v])=>{const li=el('li');const tr=el('span','bl-track'),b=el('i');b.style.setProperty('--k',Math.max(0,v/max));
      tr.append(b,el('span','bl-amt',money(v)+(total?'　'+pc(v):'')));li.append(el('span','bl-name',n),tr);ul.appendChild(li);});
    const pockets=el('div','tk-pockets');
    list.forEach(b=>{
      const p=el('button','kp-pocket');p.type='button';
      const jp=el('div','jp'),tx=el('div','jtext');tx.appendChild(T.cardNode('receipt',b.lines));jp.appendChild(tx);
      p.append(jp,el('span','tk-date',K.dayOf(b.en)+' · '+(b.en.title||'（无题）')+' · '+money(b.total)));
      p.setAttribute('aria-label','账单 '+money(b.total)+'，'+K.dayOf(b.en));p.onclick=()=>K.show('receipt',b.lines,[b.en]);
      pockets.appendChild(p);
    });
    const leaf=el('section','tk-leaf');leaf.appendChild(pockets);
    month.append(h,el('h3','bl-sub','花在哪'),ul,el('h3','bl-sub','这个月的小票'),leaf);
  }
  box.textContent='';box.append(tiles,chart,month);
  drawMonth();
})();
