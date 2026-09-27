/* Admin for the journal: write pages, upload photos to R2, edit contact info. */
(function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const $=id=>document.getElementById(id);
  const main=$('main'),list=$('list');
  let entries=[],settings={},jots=[],bookLocked=false,newLock=null,aiKeySet=false;
  const dayLocks=new Set();      // dates locked as a whole day (from 随手记)
  let sel=null;            // entry id | 'new' | 'settings' | 'jots' | null
  let draft=null;          // working copy of the selected thing
  let base='';             // JSON of draft when loaded, to detect changes
  let busy=false;

  $('today').textContent='今天是 '+T.todayStr();

  /* ---------- API ---------- */
  async function api(path,opt){
    const r=await fetch(path,Object.assign({credentials:'same-origin',headers:{accept:'application/json'}},opt||{}));
    let body=null;try{body=await r.json();}catch(e){}
    if(r.status===401){gate();throw new Error('需要登录');}
    if(!r.ok)throw new Error((body&&body.error)||('请求失败（'+r.status+'）'));
    return body;
  }
  const LOGIN_MSG={denied:'这个 GitHub 账号没有权限。',cancelled:'登录取消了。',expired:'登录超时了，再点一次。',failed:'GitHub 登录没成功，稍后再试。'};
  // read ?login=… (set by the GitHub callback) once, then drop it so a reload doesn't repeat the message
  const loginWhy=new URLSearchParams(location.search).get('login');
  if(location.search)history.replaceState(null,'',location.pathname);
  function gate(){
    $('gate').hidden=false;$('logout').hidden=true;
    if(loginWhy&&LOGIN_MSG[loginWhy])$('gateMsg').textContent=LOGIN_MSG[loginWhy];
    $('gateDate').textContent=T.todayStr().replace(/-/g,'.');
    document.body.classList.add('gated');
    // the journal's own name, as on its cover (settings are public)
    fetch('/api/settings').then(r=>r.ok?r.json():null).then(d=>{
      const t=d&&d.settings&&d.settings.coverTitle;if(!t)return;
      const n=$('gateName'),i=t.indexOf('.');n.textContent='';
      if(i<0)n.textContent=t;else n.append(t.slice(0,i),el('b',null,'.'),t.slice(i+1));
    }).catch(()=>{});
  }
  $('logout').onclick=async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch(e){}location.reload();};
  const sendJson=(method,path,obj)=>api(path,{method,headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(obj)});

  /* ---------- list: search, filter by status, grouped by month ---------- */
  let listQuery='',listFilter='all';
  const FILTERS=[['all','全部'],['draft','草稿'],['published','已发布']];
  const plain=en=>[en.title,en.latin,en.aside,en.body,en.note,en.place,en.weather,en.quote,en.date,en.date.replace(/-0?/g,'/')].join('\n').toLowerCase();
  function drawList(){
    list.textContent='';
    const nd=entries.filter(e=>e.status==='draft').length;
    $('countLabel').textContent='已写的页 · '+entries.length;
    const fl=$('lfilter');fl.textContent='';
    FILTERS.forEach(([k,label])=>{
      const n=k==='all'?entries.length:k==='draft'?nd:entries.length-nd;
      const b=el('button',null,label+' '+n);b.type='button';b.setAttribute('aria-pressed',listFilter===k?'true':'false');
      b.onclick=()=>{listFilter=k;drawList();};
      fl.appendChild(b);
    });
    const q=listQuery.trim().toLowerCase();
    const shown=T.sortEntries(entries).reverse().filter(en=>
      (listFilter==='all'||(listFilter==='draft')===(en.status==='draft'))&&(!q||plain(en).includes(q)));
    if(!shown.length){
      list.appendChild(el('div','lempty',entries.length?'没有找到。':'还没有写过。点上面「新写一页」开始。'));
    }
    let month='';
    shown.forEach(en=>{
      const d=T.parseDate(en.date),m=d?d.y+' 年 '+d.mo+' 月':'';
      if(m!==month){month=m;list.appendChild(el('div','lmonth',m));}
      const it=el('button','item'+(en.status==='draft'?' draft':''));it.type='button';it.dataset.id=en.id;
      it.setAttribute('aria-current',sel===en.id?'true':'false');
      const t=el('b',null,en.title||'（无题）');
      if(en.status==='draft')t.appendChild(el('em','tag','草稿'));
      const meta=el('span',null,(d?d.mo+'/'+d.d:en.date)+((en.photos&&en.photos.length)||en.photoKey?' · 有照片':'')+(en.locked?' · 🔒 单独上锁':dayLocks.has(en.date)?' · 🔒 这一天上锁':''));
      const gist=T.plainText(en.body);
      it.append(t,meta);
      if(gist)it.appendChild(el('i','gist',gist.length>30?gist.slice(0,30)+'…':gist));
      (en.stickers||[]).slice(0,2).forEach(k=>{const g=T.stickerSvg(k,18);if(g){g.classList.add('lstk');it.appendChild(g);}});
      it.onclick=()=>select(en.id);
      list.appendChild(it);
    });
    $('newBtn').setAttribute('aria-current',sel==='new'?'true':'false');
    $('settingsBtn').setAttribute('aria-current',sel==='settings'?'true':'false');
    $('jotsBtn').setAttribute('aria-current',sel==='jots'?'true':'false');
  }
  $('q').addEventListener('input',e=>{listQuery=e.target.value;drawList();});
  $('newBtn').onclick=()=>select('new');
  $('jotsBtn').onclick=()=>select('jots');
  $('settingsBtn').onclick=()=>select('settings');

  const dirty=()=>draft&&JSON.stringify(stripLocal(draft))!==base;
  function stripLocal(d){
    const c=Object.assign({},d);delete c.photoUrl;
    // photos being uploaded carry a local preview url: not part of the page
    if(Array.isArray(c.photos))c.photos=c.photos.map(p=>({key:p.key,cap:p.cap||''}));
    return c;
  }

  /* switching away from unsaved changes asks first, inline */
  function select(id,force){
    if(busy)return;
    if(!force&&dirty()&&id!==sel){
      const box=main.querySelector('.unsaved');if(box)box.remove();
      const u=el('div','unsaved');u.append('这一页有改动还没保存。');
      const sv=el('button','b small pri','保存');sv.type='button';sv.onclick=async()=>{if(await save())select(id,true);};
      const ds=el('button','b small','放弃改动');ds.type='button';ds.onclick=()=>select(id,true);
      const st=el('button','b small','继续编辑');st.type='button';st.onclick=()=>u.remove();
      u.append(sv,ds,st);
      const f=main.querySelector('.form');(f||main).prepend(u);
      return;
    }
    sel=id;
    if(id==='settings'){draft=Object.assign({},settings);}
    else if(id==='jots'){draft=null;}
    else if(id==='new'){newLock=null;draft={date:T.todayStr(),title:'',latin:'',stamp:'',aside:'',body:'',note:'',mood:'mug',quote:'',quoteSrc:'',photoKey:'',photoCap:'',photos:[],place:'',geo:'',weather:'',stickers:[],status:'published'};}
    else{const en=entries.find(e=>e.id===id);draft=en?Object.assign({},en,{photos:(en.photos||[]).map(p=>Object.assign({},p))}):null;}
    base=draft?JSON.stringify(stripLocal(draft)):'';
    drawList();drawForm();
    // a phone shows one thing at a time: start it from the top
    if(matchMedia('(max-width:700px)').matches)window.scrollTo(0,0);
  }

  /* ---------- form ---------- */
  let pvbox=null,pvcap=null,pvAt=0,pvT=0,statusEl=null;
  function status(msg,kind){if(statusEl){statusEl.textContent=msg||'';statusEl.className='status'+(kind?' '+kind:'');}}
  function field(label,key,type,opts){
    opts=opts||{};
    const l=el('label');l.append(label);
    let inp;
    if(type==='textarea'){inp=el('textarea');inp.rows=opts.rows||9;}
    else if(type==='select'){inp=el('select');opts.options.forEach(([v,t])=>{const o=el('option',null,t);o.value=v;inp.appendChild(o);});}
    else{inp=el('input');inp.type=type||'text';}
    inp.id='f-'+key;inp.value=draft[key]||'';
    if(opts.max)inp.maxLength=opts.max;
    if(opts.ph)inp.placeholder=opts.ph;
    const on=()=>{draft[key]=inp.value;changed();};
    inp.addEventListener('input',on);inp.addEventListener('change',on);
    l.appendChild(inp);
    if(opts.hint)l.appendChild(el('span','hintx',opts.hint));
    return l;
  }
  function changed(){
    // laying a long page out over several takes a moment: not on every keystroke
    clearTimeout(pvT);pvT=setTimeout(drawPreview,150);
    const d=dirty();
    status(d?'有改动还没保存（⌘/Ctrl+S 保存）':'');
    const a=main.querySelector('.actbar');if(a)a.classList.toggle('dirty',!!d);
  }
  function drawPreview(){
    if(!pvbox||!draft||sel==='settings')return;
    pvbox.textContent='';
    // as it will be in the book: as many pages as it takes, one at a time with ‹ › when there are more
    const ps=T.entryPages(draft,'r');
    pvAt=Math.min(pvAt,ps.length-1);
    ps.forEach((p,i)=>{if(i===pvAt)pvbox.appendChild(p);else p.remove();});
    if(!pvcap)return;
    pvcap.textContent='';
    if(ps.length<2){pvcap.append('预览 · 保存后会按日期排进手帐');return;}
    const go=(d,t)=>{const b=el('button','pvgo',t);b.type='button';b.disabled=pvAt+d<0||pvAt+d>=ps.length;
      b.setAttribute('aria-label',d<0?'上一页':'下一页');b.onclick=()=>{pvAt+=d;drawPreview();};return b;};
    pvcap.append(go(-1,'‹'),' 第 '+(pvAt+1)+' / '+ps.length+' 页（一页写不下，接着往后排）',go(1,'›'));
  }
  /* a group of fields: a card with a title. fold: folded away until opened, its title saying what's in it */
  function card(title,nodes,opt){
    opt=opt||{};
    const c=el(opt.fold?'details':'section','card');
    if(opt.fold&&opt.open)c.open=true;
    const h=el(opt.fold?'summary':'h3','ctitle');h.append(title);
    if(opt.sum)h.appendChild(el('span','csum',opt.sum));
    c.appendChild(h);
    if(opt.hint)c.appendChild(el('div','hintx',opt.hint));
    nodes.forEach(n=>{if(n)c.appendChild(n);});
    return c;
  }
  /* the bar at the foot of a form, always in reach: what happened, and what to do (buttons) */
  function actBar(buttons){
    const a=el('div','actbar');a.appendChild(statusEl);buttons.forEach(x=>a.appendChild(x));
    return a;
  }
  /* on a phone the list and a page take turns: this goes back to the list */
  function backBtn(){const b=el('button','b small back','← 列表');b.type='button';b.onclick=()=>select(null);return b;}
  function head(title,extra){
    const h=el('div','fhead');h.append(backBtn(),el('h2',null,title));
    if(extra)h.appendChild(extra);
    return h;
  }
  function drawForm(){
    main.textContent='';pvbox=null;pvcap=null;pvAt=0;statusEl=el('div','status');
    document.body.classList.toggle('detail',!!sel);
    if(sel==='jots'){drawJots();return;}
    if(!sel||!draft){drawHome();return;}
    const f=el('form','form');f.noValidate=true;
    f.addEventListener('submit',e=>{e.preventDefault();save();});
    if(sel==='settings'){
      // each section a card; the chips at the top go straight to one
      const nav=el('nav','secnav');nav.setAttribute('aria-label','设置分区');
      const cards=[];
      const sect=(t,hint,nodes)=>{
        const c=card(t,nodes,{hint});c.id='set-'+cards.length;cards.push(c);
        const b=el('button','chip on',t);b.type='button';b.onclick=()=>c.scrollIntoView({behavior:'smooth',block:'start'});nav.appendChild(b);
        return c;
      };
      f.append(head('手帐设置'),nav,
        sect('网站','浏览器标签上的标题，和搜索、分享链接里显示的一句介绍。',[
          field('网站标题','siteTitle','text',{max:40}),
          field('一句介绍','siteDesc','text',{max:120})]),
        sect('封面',null,[
          coverStyleField(),
          field('封面大字','coverTitle','text',{max:16,hint:'第一个「.」会变成绿色的小圆点，比如 cui.log'}),
          field('大字下面的一行','coverSub','text',{max:40}),
          coverStickerField(),
          coverPhotoField()]),
        sect('纸张','手帐里每一页纸的纹路和颜色（封面、封底和环衬不变）。',[paperField()]),
        sect('扉页','翻开封面后第一页的 README。',[
          field('whoami（名字）','readmeName','text',{max:30}),
          field('cat role（在做什么）','readmeRole','text',{max:40}),
          field('ls ~/life（生活里有什么）','readmeLife','text',{max:60}),
          field('从哪天开始记','readmeSince','text',{max:20,ph:'2026-09'}),
          field('小咖旁边那句话','readmeSign','text',{max:30})]),
        sect('封底',null,[
          field('封底大字','backTitle','text',{max:12}),
          field('封底下方小字','backImprint','textarea',{rows:2,max:80,hint:'可以换行'})]),
        sect('加密','给整本手帐设一个口令。',[lockField('book')]),
        sect('翻页方式','首页的书怎么翻。',[bookModeField()]),
        sect('示例页',null,[samplesField()]),
        sect('地图','Mapbox：足迹地图页（/map/）、日记页上的小地图、编辑页的选点地图和地名查询。',[mapField()]),
        sect('AI','写草稿和补全用的模型：「随手记」里的「现在就写一页」、每晚的自动草稿、编辑页的「AI 补全」。只给后台看，不会出现在主页上。',[aiField()]),
        sect('联系方式','显示在「写信给我」那一页。',[
          field('邮箱','email','email',{ph:'you@example.com',max:120}),
          field('GitHub 地址','github','url',{ph:'https://github.com/你的用户名',hint:'要以 https:// 开头',max:200}),
          field('链接上显示的文字（可空）','githubText','text',{ph:'github.com/你的用户名',max:60})]));
      const s=el('button','b pri','保存设置');s.type='submit';
      f.append(actBar([s]));main.appendChild(f);return;
    }
    const isDraft=draft.status==='draft';
    f.appendChild(head(sel==='new'?'新的一页':isDraft?'草稿':'编辑这一页',isDraft?el('span','tagd','草稿 · 主页上看不到'):null));
    const r1=el('div','row');r1.append(dateField(),field('页眉小字','aside','text',{ph:'比如：下了一整天雨',max:30}));
    const r2=el('div','row');r2.append(field('标题（手写大字）','title','text',{ph:'今天的标题',max:30,hint:'8 个字以内最好看'}),field('英文小注','latin','text',{ph:'a small note in English',max:60}));
    const r3=el('div','row');r3.append(field('印章（一个字）','stamp','text',{ph:'记',max:2}),
      field('小咖','mood','select',{options:[['mug','醒着'],['sleep','睡着'],['none','不出场']]}));
    const r4=el('div','row');r4.append(field('页脚引文','quote','text',{ph:'一句喜欢的话',max:120}),field('引文出处','quoteSrc','text',{ph:'作者《书名》',max:60}));
    // 上锁: the day's lock (from 随手记), this page's own, or one for a new page
    const locks=[];let locked=false;
    if(sel!=='new'){
      if(dayLocks.has(draft.date)){
        locked=true;
        const n=el('div','lockf');n.appendChild(el('div','hintx','🔒 这一天在随手记里上了锁：这一天的页都要用那个口令打开（这一页若再单独上锁，就用它自己的口令）。'));
        const bar=el('div','bar'),off=el('button','b small warn','取消这一天的锁');off.type='button';
        off.onclick=async()=>{if(busy)return;busy=true;try{await sendJson('PUT','/api/admin/locks/'+encodeURIComponent('d-'+draft.date),{password:null});dayLocks.delete(draft.date);drawList();drawForm();status('这一天不上锁了。','ok');}catch(e){status(e.message||'没有保存成功','err');}finally{busy=false;}};
        bar.appendChild(off);n.appendChild(bar);locks.push(n);
      }
      const en=entries.find(e=>e.id===sel);if(en&&en.locked)locked=true;
      locks.push(lockField(sel));
    }else{locks.push(newLockField());locked=!!newLock;}
    const pw=[draft.place,draft.weather].filter(Boolean).join(' · ');
    f.append(
      card('这一页',[r1,r2,suggestField()]),
      card('正文',[mdField()]),
      card('照片',[photoField()]),
      card('插画和小物',[stickerField(),r3,field('贴一张便签（可空）','note','text',{ph:'一句话，像纸条一样贴在正文下面',max:60})]),
      card('页脚引文',[r4],{fold:true,open:!!draft.quote,sum:draft.quote?'「'+([...draft.quote].length>12?[...draft.quote].slice(0,12).join('')+'…':draft.quote)+'」':'可空'}),
      card('地点和天气',[placeField()],{fold:true,open:!!pw,sum:pw||'可空，写在页眉右上角'}),
      card('上锁',locks,{fold:true,open:locked,sum:locked?'🔒 已上锁':'不上锁'}));
    const s=el('button','b pri',isDraft?'发布这一页':sel==='new'?'保存这一页':'保存修改');s.type='button';
    s.onclick=()=>{draft.status='published';save();};
    const s2=el('button','b',isDraft||sel==='new'?'存为草稿':'改回草稿');s2.type='button';
    s2.onclick=()=>{draft.status='draft';save();};
    // on a narrow screen the page isn't beside the form: open it big (Techo.reader)
    const see=el('button','b pvbtn','预览');see.type='button';
    see.onclick=()=>{const ps=T.entryPages(draft,'r');T.reader(ps);ps.forEach(p=>p.remove());};
    // deleting is rare: at the foot of the page, not in the bar
    const danger=el('div','bar danger');
    // a published page's link for sharing: chat apps show its card, title and first words
    const saved=sel!=='new'&&entries.find(e=>e.id===sel);
    if(saved&&saved.status==='published'){
      const url=location.origin+'/p/'+saved.id,sh=el('span','sharelink');
      const cp=el('button','b small','复制分享链接');cp.type='button';
      cp.onclick=()=>{const t=cp.textContent;navigator.clipboard.writeText(url).then(()=>{cp.textContent='已复制';setTimeout(()=>{cp.textContent=t;},1500);},()=>status(url));};
      sh.append(cp,el('span','hintx',saved.locked||dayLocks.has(saved.date)||bookLocked?'上了锁：分享出去只看得到「上了锁的一页」':url));
      danger.appendChild(sh);
    }
    if(sel!=='new'){
      const del=el('button','b warn small','删除这一页');del.type='button';
      del.onclick=()=>{
        const c=el('span','confirm','删除后不能恢复，确定？');
        const yes=el('button','b warn small','删除');yes.type='button';
        const no=el('button','b small','取消');no.type='button';
        c.append(yes,no);del.replaceWith(c);
        no.onclick=()=>c.replaceWith(del);
        yes.onclick=remove;
      };
      danger.appendChild(del);
    }
    f.append(danger,actBar([s,s2,see]));
    const pv=el('div','pv');pvbox=el('div','pvbox');
    pvcap=el('div','pvcap');
    pv.append(pvbox,pvcap);
    main.append(f,pv);drawPreview();fitPreview(pv);
    if(sel==='new')setTimeout(()=>{const t=$('f-title');if(t)t.focus();},0);
  }

  /* The preview is as big as its column and the screen allow: the whole page in view beside the form (it
     stays put as the form scrolls), from half its size up to a little over its own. The column is never
     narrower than 300px: the form gives way first. */
  let pvWatch=null;
  function fitPreview(pv){
    if(pvWatch)pvWatch.disconnect();
    const fit=()=>{
      if(!pv.isConnected)return;
      // all of it on screen before the page is scrolled too: below the header, with its caption under it
      const top=pv.getBoundingClientRect().top+scrollY,w=pv.clientWidth,h=innerHeight-Math.min(top,100)-44;
      const k=Math.max(.5,Math.min(1.25,w/530,h/740));
      pv.style.setProperty('--pvk',k.toFixed(3));
    };
    pvWatch=new ResizeObserver(fit);pvWatch.observe(pv);
    fit();
  }
  addEventListener('resize',()=>{const pv=main.querySelector('.pv');if(pv)fitPreview(pv);});

  /* ---------- 今天: what's there to do ----------
     Today's page (or a way to start it), a line for 随手记, the drafts waiting to be published (one tap each),
     and how much has been written. */
  const WDN='日一二三四五六';
  function drawHome(){
    const f=el('div','form today'),today=T.todayStr(),t=T.parseDate(today);
    const month=today.slice(0,7),pub=entries.filter(e=>e.status!=='draft');
    const drafts=T.sortEntries(entries.filter(e=>e.status==='draft')).reverse();
    f.append(el('h2',null,'今天'),
      el('div','hintx',t.y+' 年 '+t.mo+' 月 '+t.d+' 日 · 周'+WDN[t.wd]+'　·　已发布 '+pub.length+' 页，这个月 '+pub.filter(e=>e.date.slice(0,7)===month).length+' 页'+(drafts.length?'，草稿 '+drafts.length+' 页':'')));
    // today's page
    const mine=entries.filter(e=>e.date===today);
    const pageNodes=mine.map(en=>{
      const b=el('button','item'+(en.status==='draft'?' draft':''));b.type='button';
      b.append(el('b',null,en.title||'（无题）'),el('span',null,en.status==='draft'?'草稿，还没发布':'已发布'));
      b.onclick=()=>select(en.id);return b;
    });
    const nb=el('button','b '+(mine.length?'':'pri'),mine.length?'再写一页':'新写一页');nb.type='button';nb.onclick=()=>select('new');
    const bar1=el('div','bar');bar1.appendChild(nb);
    f.appendChild(card('今天这一页',[mine.length?null:el('div','hand','今天还没写。'),...pageNodes,bar1]));
    // 随手记
    const ta=el('textarea');ta.rows=2;ta.maxLength=1000;ta.placeholder='想到什么就记一句，今晚会写成一页草稿';ta.id='f-jot-home';ta.setAttribute('aria-label','记一句');
    const add=el('button','b pri small','记下');add.type='button';
    const more=el('button','b small','全部随手记');more.type='button';more.onclick=()=>select('jots');
    const said=el('span','hintx');
    const bar2=el('div','bar');bar2.append(add,more,said);
    const count=el('span');
    add.onclick=async()=>{
      const text=ta.value.trim();if(!text){ta.focus();return;}
      if(busy)return;busy=true;add.disabled=true;
      try{const r=await sendJson('POST','/api/admin/jots',{text});jots.unshift(r.jot);ta.value='';said.textContent='记下了。';paintCount();}
      catch(e){said.textContent=e.message||'没记上，稍后再试。';}
      finally{busy=false;add.disabled=false;}
    };
    const paintCount=()=>{const n=jots.filter(j=>!j.usedIn&&new Date(j.createdAt).toDateString()===new Date().toDateString()).length;count.textContent=n?'今天记了 '+n+' 句':'';};
    const jc=card('随手记',[ta,bar2]);jc.querySelector('.ctitle').appendChild(el('span','csum',''));jc.querySelector('.csum').appendChild(count);
    f.appendChild(jc);
    api('/api/admin/jots').then(r=>{jots=r.jots||[];paintCount();}).catch(()=>{});
    // drafts waiting
    if(drafts.length){
      const rows=drafts.map(en=>{
        const r=el('div','drow'),d=T.parseDate(en.date);
        const open=el('button','item');open.type='button';open.append(el('b',null,en.title||'（无题）'),el('span',null,d?d.mo+'/'+d.d:en.date));open.onclick=()=>select(en.id);
        const go=el('button','b small','发布');go.type='button';go.onclick=()=>publish(en,go);
        r.append(open,go);return r;
      });
      f.appendChild(card('等着发布的草稿',rows,{hint:'看过没问题就发布；想改就点标题打开。'}));
    }
    f.appendChild(statusEl);
    main.appendChild(f);
  }
  /* The page's share card (/p/<id>): drawn here, as the book draws the page, and uploaded. Only for a page
     that's out and not locked (a locked one shares nothing); quietly, as the page is already saved. */
  let cardLib=null;
  async function refreshCard(en){
    if(!en||en.status!=='published'||en.locked||bookLocked||dayLocks.has(en.date))return;
    try{
      if(!cardLib)cardLib=new Promise((res,rej)=>{const s=document.createElement('script');s.src='/assets/card.js';s.onload=()=>res(window.TechoCard);s.onerror=()=>{cardLib=null;rej(new Error('card.js'));};document.head.appendChild(s);});
      const lib=await cardLib,page=T.entryPages(en,'r')[0];
      const blob=await lib.make(page,en,settings);page.remove();
      await api('/api/admin/entries/'+encodeURIComponent(en.id)+'/card',{method:'PUT',headers:{'content-type':'image/jpeg',accept:'application/json'},body:blob});
    }catch(e){console.warn('techo: share card',e);}
  }
  /* publish a draft from the list of them, as it is */
  async function publish(en,btn){
    if(busy)return;busy=true;btn.disabled=true;status('正在发布……');
    try{
      const r=await sendJson('PUT','/api/admin/entries/'+encodeURIComponent(en.id),stripLocal(Object.assign({},en,{status:'published'})));
      const i=entries.findIndex(e=>e.id===en.id);r.entry.locked=en.locked;if(i>=0)entries[i]=r.entry;
      busy=false;drawList();drawForm();status('「'+(r.entry.title||'（无题）')+'」已发布，主页刷新就能看到。','ok');
      refreshCard(r.entry);
    }catch(e){btn.disabled=false;status(e.message||'没发布成功','err');}
    finally{busy=false;}
  }

  /* ---------- date: a paper calendar instead of the browser's picker ---------- */
  const WD='日一二三四五六',MOE=['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sept.','Oct.','Nov.','Dec.'];
  const iso=d=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  const utc=s=>{const d=T.parseDate(s);return d?new Date(Date.UTC(d.y,d.mo-1,d.d)):null;};
  function dateField(){
    const wrap=el('div','datef');
    const lab=el('label');lab.append('日期');
    const btn=el('button','dbtn');btn.type='button';btn.id='f-date';
    btn.setAttribute('aria-haspopup','dialog');btn.setAttribute('aria-expanded','false');
    lab.appendChild(btn);wrap.appendChild(lab);
    const show=()=>{
      const d=T.parseDate(draft.date);btn.textContent='';
      if(!d){btn.appendChild(el('b',null,'选一天'));}
      else btn.append(el('b',null,draft.date.replace(/-/g,'.')),el('span','dwd'+(d.wd===0||d.wd===6?' we':''),'周'+WD[d.wd]));
      btn.appendChild(el('i','dico'));
    };
    show();
    let pop=null,focus=null;   // focus: the UTC date the keyboard is on
    const outside=e=>{if(!wrap.contains(e.target))close();};
    function close(back){
      if(!pop)return;pop.remove();pop=null;btn.setAttribute('aria-expanded','false');
      document.removeEventListener('pointerdown',outside,true);
      if(back)btn.focus();
    }
    function pick(d){draft.date=iso(d);show();changed();close(true);}
    function render(){
      pop.textContent='';
      const y=focus.getUTCFullYear(),mo=focus.getUTCMonth();
      const head=el('div','dhead');
      const t=el('div','dtitle');t.append(el('b',null,String(mo+1)),el('span',null,'月'),el('i',null,MOE[mo]+' '+y));
      t.id='dtitle';
      const nav=(txt,label,dm)=>{const b=el('button','dnav',txt);b.type='button';b.setAttribute('aria-label',label);b.onclick=()=>{focus=new Date(Date.UTC(y,mo+dm,1));render();};return b;};
      head.append(nav('‹','上个月',-1),t,nav('›','下个月',1));
      const grid=el('div','dgrid');grid.setAttribute('role','grid');grid.setAttribute('aria-labelledby','dtitle');
      '一二三四五六日'.split('').forEach((c,i)=>grid.appendChild(el('span','h'+(i>4?' we':''),c)));
      const first=new Date(Date.UTC(y,mo,1)),start=new Date(first-((first.getUTCDay()+6)%7)*864e5);
      const sel=draft.date,today=T.todayStr(),fk=iso(focus);
      for(let i=0;i<42;i++){
        const d=new Date(+start+i*864e5),k=iso(d),wd=d.getUTCDay();
        const b=el('button','dday'+(d.getUTCMonth()!==mo?' out':'')+(wd===0||wd===6?' we':'')+(k===today?' today':''),String(d.getUTCDate()));
        b.type='button';b.tabIndex=k===fk?0:-1;b.dataset.k=k;
        b.setAttribute('aria-label',d.getUTCFullYear()+'年'+(d.getUTCMonth()+1)+'月'+d.getUTCDate()+'日 周'+WD[wd]+(k===today?'（今天）':''));
        b.setAttribute('aria-pressed',k===sel?'true':'false');
        b.onclick=()=>pick(d);
        grid.appendChild(b);
      }
      grid.addEventListener('keydown',e=>{
        const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];
        if(step){e.preventDefault();focus=new Date(+focus+step*864e5);}
        else if(e.key==='PageUp'||e.key==='PageDown'){e.preventDefault();focus=new Date(Date.UTC(focus.getUTCFullYear(),focus.getUTCMonth()+(e.key==='PageUp'?-1:1),Math.min(focus.getUTCDate(),28)));}
        else if(e.key==='Home'||e.key==='End'){e.preventDefault();focus=new Date(+focus+((e.key==='Home'?0:6)-(focus.getUTCDay()+6)%7)*864e5);}
        else return;
        if(focus.getUTCMonth()!==mo||focus.getUTCFullYear()!==y)render();
        else grid.querySelectorAll('.dday').forEach(b=>b.tabIndex=b.dataset.k===iso(focus)?0:-1);
        const f=pop.querySelector('.dday[tabindex="0"]');if(f)f.focus();
      });
      const foot=el('div','dfoot');
      const tb=el('button','dlink','回到今天');tb.type='button';tb.onclick=()=>pick(utc(today));
      const cb=el('button','dlink quiet','关闭');cb.type='button';cb.onclick=()=>close(true);
      foot.append(tb,cb);
      pop.append(head,grid,foot);
    }
    function open(){
      focus=utc(draft.date)||utc(T.todayStr());
      pop=el('div','dpop');pop.setAttribute('role','dialog');pop.setAttribute('aria-label','选择日期');
      pop.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}});
      wrap.appendChild(pop);render();btn.setAttribute('aria-expanded','true');
      document.addEventListener('pointerdown',outside,true);
      const f=pop.querySelector('.dday[tabindex="0"]');if(f)f.focus();
    }
    btn.onclick=()=>pop?close():open();
    return wrap;
  }

  /* ---------- 手帐设置: cover stickers, cover pictures, sample pages ---------- */
  const COVER_STICKERS=[['mug','小咖'],['nas','NAS'],['cloud','云'],['film','胶卷'],['ticket','机票']];
  const csv=v=>String(v||'').split(',').filter(Boolean);
  /* 封面款式: each style as a little cover with this journal's title on it; the covers, endpapers and the 3D
     book's boards all change with it */
  function coverStyleField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:6px';l.textContent='封面款式（封面、封底和环衬一起换）';
    const w=el('div','cvpick');w.setAttribute('role','radiogroup');w.setAttribute('aria-label','封面款式');
    const title=draft.coverTitle||'cui.log',dot=title.indexOf('.');
    Object.entries(T.COVERS).forEach(([k,name])=>{
      const o=el('label','cvopt');
      const r=el('input');r.type='radio';r.name='f-cover';r.value=k;r.checked=(draft.coverStyle||'slate')===k;
      r.onchange=()=>{if(r.checked){draft.coverStyle=k;changed();}};
      const mini=el('div','cvmini'),pg=el('div','page cover');pg.setAttribute('aria-hidden','true');T.coverStyle(pg,k);
      const deb=el('div','deboss');
      if(dot<0)deb.textContent=title;else deb.append(title.slice(0,dot),el('span',null,'.'),title.slice(dot+1));
      pg.append(el('div','spine'),deb,el('div','sub',draft.coverSub||''));
      mini.appendChild(pg);
      o.append(r,mini,el('span',null,name));w.appendChild(o);
    });
    wrap.append(l,w);return wrap;
  }
  /* 纸张: the pattern and the colour, each shown as a little page in the other's current choice */
  function paperField(){
    const wrap=el('div');wrap.style.cssText='display:grid;gap:14px';
    const minis=[];
    const repaint=()=>minis.forEach(([pg,pat,tone])=>T.paperStyle(pg,pat||draft.paperStyle||'grid',tone||draft.paperTone||'cream'));
    const group=(label,key,opts,kind)=>{
      const g=el('div');
      const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:6px';l.textContent=label;
      const w=el('div','cvpick pppick');w.setAttribute('role','radiogroup');w.setAttribute('aria-label',label);
      const cur=draft[key]||Object.keys(opts)[0];
      Object.entries(opts).forEach(([k,name])=>{
        const o=el('label','cvopt');
        const r=el('input');r.type='radio';r.name='f-'+key;r.value=k;r.checked=cur===k;
        r.onchange=()=>{if(r.checked){draft[key]=k;repaint();changed();}};
        const mini=el('div','cvmini ppmini page r');mini.setAttribute('aria-hidden','true');
        minis.push([mini,kind==='pattern'?k:null,kind==='tone'?k:null]);
        o.append(r,mini,el('span',null,name));w.appendChild(o);
      });
      g.append(l,w);return g;
    };
    wrap.append(group('纹路','paperStyle',T.PAPERS,'pattern'),group('纸色','paperTone',T.TONES,'tone'));
    // 夜间书页: the paper darkens with the system's dark mode
    const nl=el('label','check1'),nb=el('input');nb.type='checkbox';nb.id='f-nightPaper';nb.checked=draft.nightPaper!=='off';
    nb.onchange=()=>{draft.nightPaper=nb.checked?'auto':'off';changed();};
    nl.append(nb,el('span',null,'夜间书页：系统是深色模式时，纸页也变暗'));
    wrap.append(nl,el('div','hintx','关掉的话，深色模式下只有桌面变暗，纸还是白天的样子。'));
    repaint();return wrap;
  }
  function coverStickerField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';l.textContent='封面上原来的贴纸（点一下隐藏 / 显示）';
    const row=el('div','chips');row.setAttribute('role','group');row.setAttribute('aria-label','封面上原来的贴纸');
    COVER_STICKERS.forEach(([k,label])=>{
      const b=el('button','chip',label);b.type='button';
      const paint=()=>b.setAttribute('aria-pressed',csv(draft.coverHide).includes(k)?'false':'true');
      b.onclick=()=>{const h=csv(draft.coverHide);draft.coverHide=(h.includes(k)?h.filter(x=>x!==k):h.concat(k)).join(',');paint();changed();};
      paint();row.appendChild(b);
    });
    wrap.append(l,row);return wrap;
  }
  function coverPhotoField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';
    l.textContent='我的贴纸（最多 4 张，会带白边贴在封面上；透明背景的 PNG 效果最好）';
    const row=el('div','cphotos');
    const paint=()=>{
      row.textContent='';
      const keys=csv(draft.coverPhotos);
      keys.forEach(k=>{
        const t=el('div','cphoto');t.style.backgroundImage='url("/img/'+k+'")';
        const x=el('button','cx','×');x.type='button';x.setAttribute('aria-label','拿掉这张');
        x.onclick=()=>{draft.coverPhotos=csv(draft.coverPhotos).filter(y=>y!==k).join(',');paint();changed();};
        t.appendChild(x);row.appendChild(t);
      });
      if(keys.length<4){
        const fb=el('span','b small filebtn','添加图片');
        const inp=el('input');inp.type='file';inp.accept='image/png,image/webp,image/jpeg,image/gif';inp.setAttribute('aria-label','添加封面贴纸');
        fb.appendChild(inp);row.appendChild(fb);
        inp.addEventListener('change',async()=>{
          const file=inp.files&&inp.files[0];if(!file)return;
          fb.firstChild.textContent='上传中……';status('正在上传……');
          try{
            const blob=await shrink(file,600,true);
            const r=await api('/api/admin/photos',{method:'POST',headers:{'content-type':blob.type,accept:'application/json'},body:blob});
            draft.coverPhotos=csv(draft.coverPhotos).concat(r.key).join(',');paint();changed();
            status('图片已上传，记得保存设置。','ok');
          }catch(e){fb.firstChild.textContent='添加图片';status(e.message||'上传失败','err');}
        });
      }
    };
    paint();wrap.append(l,row);return wrap;
  }
  /* a password for the whole book ('book') or this one day (its id). Saved at once, apart from the form:
     only a hash is kept, so a forgotten password is simply set again here */
  function lockField(scope){
    const book=scope==='book',day=/^d-/.test(scope)?scope.slice(2):null,en=book||day?null:entries.find(e=>e.id===scope);
    const on=book?bookLocked:day?dayLocks.has(day):!!(en&&en.locked);
    const w=el('div','lockf');
    w.appendChild(el('div','hintx',on
      ?(book?'🔒 整本已上锁：主页上的日记只露出日期，读者输入口令才能看（单独上锁的那几天仍要用各自的口令）。'
        :day?'🔒 今天写成的那一页会上锁：不管是你点「现在就写一页」，还是每晚自动写的，都要用这个口令打开。'
            :'🔒 这一页已单独上锁：只露出日期，要用这里的口令打开，整本的口令打不开它。')
      :(book?'上锁后，主页上所有日记只露出日期，读者在封面输入口令才能看；示例页也会收起来。'
        :day?'今天用随手记写成的那一页要不要上锁？设了口令，写好发布后读者只看得到日期。'
            :'单独上锁后，这一页只露出日期，要用这里设的口令打开（和整本的口令分开）。')));
    const row=el('div','row');
    const mk=(ph,id)=>{const i=el('input');i.type='password';i.autocomplete='new-password';i.placeholder=ph;i.id=id;i.maxLength=128;return i;};
    const p1=mk(on?'新口令（至少 4 个字符）':'口令（至少 4 个字符）','lk1-'+scope),p2=mk('再输一遍','lk2-'+scope);
    const l1=el('label','fld');l1.append(el('span',null,on?'改成新口令':'口令'),p1);
    const l2=el('label','fld');l2.append(el('span',null,'确认'),p2);
    row.append(l1,l2);w.appendChild(row);
    const bar=el('div','bar');
    const go=el('button','b small',on?'改口令':(book?'给整本上锁':day?'今天这一页上锁':'给这一页上锁'));go.type='button';
    const send=async(password,done)=>{
      if(busy)return;busy=true;status('正在保存……');
      try{
        await sendJson('PUT','/api/admin/locks/'+encodeURIComponent(scope),{password});
        const now=password!==null;
        if(book)bookLocked=now;else if(day){if(now)dayLocks.add(day);else dayLocks.delete(day);}else if(en)en.locked=now;
        drawList();if(sel==='jots')drawJots(true);else drawForm();status(done,'ok');
      }catch(e){status(e.message||'没有保存成功','err');}
      finally{busy=false;}
    };
    go.onclick=()=>{
      if([...p1.value].length<4){status('口令至少 4 个字符。','err');p1.focus();return;}
      if(p1.value!==p2.value){status('两次输入的口令不一样。','err');p2.focus();return;}
      send(p1.value,on?'口令已改好；读者需要用新口令重新打开。':'已上锁。');
    };
    bar.appendChild(go);
    if(on){
      const off=el('button','b small warn','取消上锁');off.type='button';
      off.onclick=()=>send(null,book?'整本已取消上锁。':day?'今天这一页不上锁了。':'这一页已取消上锁。');
      bar.appendChild(off);
    }
    w.appendChild(bar);
    return w;
  }
  /* a new page can be locked as it's saved: the password waits here until the page exists */
  function newLockField(){
    const w=el('div','lockf');
    w.appendChild(el('div','hintx','想让这一页只给知道口令的人看，就在这里设口令；不填就不上锁。保存时一起生效。'));
    const row=el('div','row');
    const mk=(ph,id)=>{const i=el('input');i.type='password';i.autocomplete='new-password';i.placeholder=ph;i.id=id;i.maxLength=128;return i;};
    const p1=mk('口令（至少 4 个字符，可不填）','nl1'),p2=mk('再输一遍','nl2');
    if(newLock){p1.value=newLock.p1;p2.value=newLock.p2;}
    const upd=()=>{newLock=p1.value||p2.value?{p1:p1.value,p2:p2.value}:null;};
    p1.oninput=p2.oninput=upd;
    const l1=el('label','fld');l1.append(el('span',null,'口令'),p1);
    const l2=el('label','fld');l2.append(el('span',null,'确认'),p2);
    row.append(l1,l2);w.appendChild(row);
    return w;
  }
  function bookModeField(){
    const w=el('div');
    [['auto','自动','手机用平面翻页（翻动时和静止时一模一样，也更省内存），平板和电脑用立体的书（默认）'],['3d','立体的书','有厚度和光影，纸从页角卷起翻过去；手机上也用它'],['flip','平面翻页','轻一些的翻页效果；不支持立体效果的设备也会用它']].forEach(([v,name,hint])=>{
      const l=el('label','check1');
      const r=el('input');r.type='radio';r.name='f-bookmode';r.value=v;r.checked=(draft.bookMode||'auto')===v;
      r.onchange=()=>{if(r.checked){draft.bookMode=v;changed();}};
      l.append(r,el('span',null,name));w.append(l,el('div','hintx',hint));
    });
    return w;
  }
  /* 手帐设置 → AI: the format the endpoint speaks, the endpoint (empty: Anthropic's own / OpenAI's own), a model,
     whether the Worker has its key, and 测试连接 (with what's typed, before saving) */
  const AI_FORMATS={
    anthropic:{ph:'https://api.anthropic.com',hint:'留空就是 Claude 官方接口。中转或其他厂商的 Anthropic 兼容地址填到 /v1 之前，比如 https://api.deepseek.com/anthropic',model:'claude-opus-5'},
    openai:{ph:'https://api.openai.com/v1',hint:'填到 /v1（不用加 /chat/completions），比如 https://api.deepseek.com、https://dashscope.aliyuncs.com/compatible-mode/v1；留空是 OpenAI 官方',model:'gpt-5 / deepseek-chat / qwen-plus …'},
  };
  function aiField(){
    const w=el('div');w.style.cssText='display:grid;gap:10px';
    const fmt=AI_FORMATS[draft.aiFormat==='openai'?'openai':'anthropic'];
    const pick=field('接口格式','aiFormat','select',{options:[['anthropic','Anthropic（Claude 官方、中转、各家 /anthropic 地址）'],['openai','OpenAI（/chat/completions：OpenAI、DeepSeek、通义、Kimi、中转…）']]});
    pick.querySelector('select').addEventListener('change',()=>drawForm());   // the hints follow the format
    const row=el('div','row');
    row.append(field('接口地址（可空）','aiBaseUrl','url',{ph:fmt.ph,max:200,hint:fmt.hint}),
      field('模型','aiModel','text',{ph:fmt.model,max:80,hint:draft.aiFormat==='openai'?'填那边的模型名':'留空是 claude-opus-5'}));
    const key=el('div','hintx',aiKeySet?'✓ 已配置 key（Worker 密钥 AI_API_KEY 或 ANTHROPIC_API_KEY）':'✗ 还没有 key：运行 npx wrangler secret put AI_API_KEY，填这个接口的 key');
    key.style.color=aiKeySet?'var(--olive)':'var(--red)';
    const acts=el('div','photo-actions'),t=el('button','b small','测试连接'),out=el('span','hintx');
    t.type='button';acts.append(t,out);
    t.onclick=async()=>{
      t.disabled=true;out.textContent='正在问……';out.style.color='';
      try{
        const r=await sendJson('POST','/api/admin/ai/test',{aiFormat:draft.aiFormat||'anthropic',aiBaseUrl:draft.aiBaseUrl||'',aiModel:draft.aiModel||''});
        out.textContent='✓ 连上了：'+r.model+' 回复「'+(r.reply||'（空）')+'」';out.style.color='var(--olive)';
      }catch(e){out.textContent='✗ '+(e.message||'没连上');out.style.color='var(--red)';}
      finally{t.disabled=false;}
    };
    w.append(pick,row,key,acts);
    return w;
  }
  /* 手帐设置 → 地图: the Mapbox token, and whether pages get a little map */
  function mapField(){
    const w=el('div');w.style.cssText='display:grid;gap:10px';
    w.appendChild(field('Mapbox access token','mapboxToken','text',{ph:'pk.eyJ1Ijoi…',max:300,
      hint:'用公开的 token（pk. 开头）：在 account.mapbox.com 的 Tokens 里新建一个，URL restrictions 填你的域名，别人拿去也用不了。留空就没有地图。'}));
    const l=el('label','check1');
    const cb=el('input');cb.type='checkbox';cb.id='f-mapOnPage';cb.checked=draft.mapOnPage!=='hide';
    cb.onchange=()=>{draft.mapOnPage=cb.checked?'show':'hide';changed();};
    l.append(cb,el('span',null,'有坐标的日记页上贴一张小地图'));
    w.appendChild(l);
    return w;
  }
  function samplesField(){
    const l=el('label','check1');
    const cb=el('input');cb.type='checkbox';cb.id='f-samples';cb.checked=draft.samples!=='hide';
    cb.onchange=()=>{draft.samples=cb.checked?'show':'hide';changed();};
    l.append(cb,el('span',null,'显示开头的示例页（9/25–9/29）'));
    const w=el('div');w.append(l,el('div','hintx','隐藏后，「写信给我」那一页会移到最后一篇日记后面，联系方式还在。'));
    return w;
  }

  /* ---------- doodles ---------- */
  function stickerField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';
    l.textContent='小插画：最多两个，翻到这页时会一笔一笔画出来';
    const grid=el('div','stkpick');grid.setAttribute('role','group');grid.setAttribute('aria-label','小插画');
    const cur=()=>Array.isArray(draft.stickers)?draft.stickers:[];
    const paint=()=>grid.querySelectorAll('button').forEach(bt=>bt.setAttribute('aria-pressed',cur().includes(bt.dataset.k)?'true':'false'));
    T.stickerList.forEach(({key,label})=>{
      const bt=el('button');bt.type='button';bt.dataset.k=key;bt.title=label;
      bt.append(T.stickerSvg(key,26),el('span',null,label));
      bt.onclick=()=>{
        let a=cur().slice();
        if(a.includes(key))a=a.filter(k=>k!==key);
        else{a.push(key);if(a.length>2)a.shift();}
        draft.stickers=a;paint();changed();
      };
      grid.appendChild(bt);
    });
    paint();wrap.append(l,grid);return wrap;
  }

  /* ---------- jots: loose lines for tonight's page ---------- */
  let jotsToday=null;
  function drawJots(again){
    if(again){main.textContent='';statusEl=el('div','status');}
    const f=el('form','form');f.noValidate=true;
    const hint=el('div','hintx','白天想到什么就记一句。每晚 22:00 Claude 会把今天记下的这些和当天的聊天一起写成一页草稿；电脑没开的话，23:30 网站会自己用随手记写。');
    const ta=el('textarea');ta.rows=4;ta.maxLength=1000;ta.placeholder='比如：午饭那家面馆换了老板，汤还是一样好喝。';ta.id='f-jot';
    const l=el('label');l.append('新的一句',ta);
    const b=el('div','bar');const s=el('button','b pri','记下');s.type='submit';b.appendChild(s);
    const cw=el('button','b','现在就用今天的随手记写一页');cw.type='button';cw.onclick=compose;b.appendChild(cw);
    const ul=el('div','jots');
    const paint=()=>{
      ul.textContent='';
      if(!jots.length){ul.appendChild(el('div','hintx','还没有记过。'));return;}
      jots.forEach(j=>{
        const d=new Date(j.createdAt);
        const row=el('div','jot'+(j.usedIn?' used':''));
        const meta=el('span','when',(d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+(j.usedIn?' · 已写进手帐':''));
        const x=el('button','b small','删掉');x.type='button';
        x.onclick=async()=>{
          try{await api('/api/admin/jots/'+encodeURIComponent(j.id),{method:'DELETE'});jots=jots.filter(k=>k.id!==j.id);paint();}
          catch(e){status(e.message||'删除失败','err');}
        };
        row.append(el('p',null,j.text),meta,x);ul.appendChild(row);
      });
    };
    f.addEventListener('submit',async e=>{
      e.preventDefault();
      const text=ta.value.trim();if(!text){ta.focus();return;}
      if(busy)return;busy=true;status('正在记……');
      try{const r=await sendJson('POST','/api/admin/jots',{text});jots.unshift(r.jot);ta.value='';paint();status('记下了。','ok');}
      catch(err){status(err.message||'没记上，稍后再试。','err');}
      finally{busy=false;}
    });
    async function compose(){
      if(busy)return;busy=true;cw.disabled=true;status('Claude 正在写，大约要半分钟……');
      try{
        const r=await api('/api/admin/compose',{method:'POST'});
        entries.push(r.entry);
        busy=false;select(r.entry.id,true);status('写好了，这是草稿。看过没问题就点「发布这一页」。','ok');
      }catch(e){status(e.message||'没写成，稍后再试。','err');}
      finally{busy=false;cw.disabled=false;}
    }
    // today's page, written from these, can be locked before it's written
    const lk=el('div');
    const paintLock=()=>{lk.textContent='';if(!jotsToday)return;
      const on=dayLocks.has(jotsToday);
      lk.appendChild(card('今天这一页上锁',[lockField('d-'+jotsToday)],{fold:true,open:on,sum:on?'🔒 已上锁':'不上锁'}));};
    f.append(head('随手记'),hint,l,b,statusEl,ul,lk);main.appendChild(f);paint();paintLock();
    (async()=>{try{const r=await api('/api/admin/jots');jots=r.jots||[];
      if(r.today){jotsToday=r.today;if(r.todayLocked)dayLocks.add(r.today);else dayLocks.delete(r.today);}
      paint();paintLock();}catch(e){status(e.message||'加载失败','err');}})();
    setTimeout(()=>ta.focus(),0);
  }

  /* ---------- 一键补全: the AI fills in the parts of the page still empty, from its words ----------
     Title, English note, header note, stamp, footer quote and doodles; what's filled in stays as it is, and
     nothing is saved until 保存. */
  const SUGGEST=[['title','标题'],['latin','英文小注'],['aside','页眉小字'],['stamp','印章'],['quote','页脚引文'],['quoteSrc','引文出处']];
  function suggestField(){
    const acts=el('div','photo-actions suggest');
    const b=el('button','b small','✨ AI 补全空着的项');b.type='button';
    const note=el('span','hintx','根据正文补上标题、英文小注、页眉小字、印章、页脚引文和插画；已经写了的不动');
    acts.append(b,note);
    b.onclick=async()=>{
      if(!String(draft.body||'').trim()){status('先写几句正文，再让 AI 补全。','err');const t=$('f-body');if(t)t.focus();return;}
      b.disabled=true;b.textContent='正在想……';status('');
      try{
        const r=await sendJson('POST','/api/admin/ai/suggest',stripLocal(draft)),g=r.suggestion||{};
        const done=[];
        SUGGEST.forEach(([k,label])=>{if(!String(draft[k]||'').trim()&&g[k]){draft[k]=g[k];done.push(label);}});
        if(!(draft.stickers||[]).length&&(g.stickers||[]).length){draft.stickers=g.stickers.slice();done.push('插画');}
        drawForm();changed();
        status(done.length?'已补全：'+done.join('、')+'。看看合不合适，可以改，记得保存。':'空着的项都有了，没有要补的。',done.length?'ok':'');
      }catch(e){b.disabled=false;b.textContent='✨ AI 补全空着的项';status(e.message||'没补全成','err');}
    };
    return acts;
  }

  /* ---------- 地点和天气: where the page was written, and that day's weather ----------
     "获取" asks the browser where it is, names the place (BigDataCloud) and looks up the page's date at those
     coordinates (Open-Meteo: forecast for the last three months and the next two weeks, the archive before
     that). Both are free and need no key; they're called from this page only. Coordinates are kept to two
     decimals (about a kilometre): the book is public. All three can be typed or cleared by hand. */
  const WMO={0:'晴',1:'晴间多云',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',56:'冻毛毛雨',57:'冻毛毛雨',
    61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'阵雨',81:'阵雨',82:'强阵雨',
    85:'阵雪',86:'阵雪',95:'雷阵雨',96:'雷阵雨伴冰雹',99:'雷阵雨伴冰雹'};
  async function weatherOn(date,lat,lon){
    const days=(Date.parse(date+'T00:00:00Z')-Date.parse(T.todayStr()+'T00:00:00Z'))/864e5;
    if(days>15)throw new Error('太远的日子还查不到天气');
    const host=days<-85?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast';
    const u=host+'?latitude='+lat+'&longitude='+lon+'&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date='+date+'&end_date='+date;
    const r=await fetch(u);if(!r.ok)throw new Error('天气没查到（'+r.status+'）');
    const d=(await r.json()).daily||{},code=d.weather_code&&d.weather_code[0];
    if(code==null)throw new Error('那一天的天气还没有');
    const lo=Math.round(d.temperature_2m_min[0]),hi=Math.round(d.temperature_2m_max[0]);
    return (WMO[code]||'—')+' '+(lo===hi?hi:lo+'~'+hi)+'°';
  }
  // a place's name, "城市 · 附近": from Mapbox when there's a token (streets and landmarks, in Chinese), else
  // from BigDataCloud (free, no key)
  async function placeAt(lat,lon){
    if(settings.mapboxToken){
      try{
        const r=await fetch('https://api.mapbox.com/search/geocode/v6/reverse?longitude='+lon+'&latitude='+lat+'&language=zh&limit=1&access_token='+encodeURIComponent(settings.mapboxToken));
        const f=r.ok&&((await r.json()).features||[])[0];
        const c=f&&f.properties&&f.properties.context||{},nm=x=>(x&&x.name||'').trim();
        const city=(nm(c.place)||nm(c.region)||nm(c.country)).replace(/市$/,'');
        const near=(nm(c.locality)||nm(c.neighborhood)||nm(c.street)).replace(/(街道|镇|乡)$/,'');
        const name=city&&near&&near!==city?city+' · '+near:city||near;
        if(name)return [...name].slice(0,30).join('');
      }catch(e){/* fall back */}
    }
    const r=await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='+lat+'&longitude='+lon+'&localityLanguage=zh');
    if(!r.ok)return '';
    const j=await r.json();
    const city=(j.city||j.principalSubdivision||j.countryName||'').replace(/市$/,''),near=(j.locality||'').replace(/(街道|镇|乡)$/,'');
    return [...(city&&near&&near!==city?city+' · '+near:city||near)].slice(0,30).join('');
  }
  const here=()=>new Promise((res,rej)=>{
    if(!navigator.geolocation)return rej(new Error('这个浏览器拿不到位置'));
    navigator.geolocation.getCurrentPosition(p=>res([+p.coords.latitude.toFixed(2),+p.coords.longitude.toFixed(2)]),
      e=>rej(new Error(e.code===1?'没有允许获取位置（浏览器地址栏里可以打开）':'位置没拿到，稍后再试')),{enableHighAccuracy:false,timeout:12000,maximumAge:6e5});
  });
  function placeField(){
    const wrap=el('div','placefield');
    const h=el('div','hintx');h.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';h.textContent='写在页眉右上角。';
    const row=el('div','row');row.append(field('地点','place','text',{ph:'上海 · 徐汇',max:30}),field('天气','weather','text',{ph:'多云 18~25°',max:20}));
    const r2=el('div','row place-row');
    r2.appendChild(field('坐标（纬度,经度）','geo','text',{ph:'31.23,121.47',max:24}));
    const acts=el('div','photo-actions');
    const go=el('button','b small','📍 获取位置和天气');go.type='button';
    const wx=el('button','b small','按坐标查天气');wx.type='button';
    acts.append(go,wx);r2.appendChild(acts);
    // 在地图上选: a Mapbox map under the coordinates; a click or dragging the pin sets them, the place and that
    // day's weather
    const pickBox=el('div','mappick');pickBox.hidden=true;
    if(settings.mapboxToken){
      const mp=el('button','b small','🗺 在地图上选');mp.type='button';acts.appendChild(mp);
      let map=null,pin=null;
      mp.onclick=async()=>{
        pickBox.hidden=!pickBox.hidden;mp.setAttribute('aria-pressed',String(!pickBox.hidden));
        if(pickBox.hidden||map)return;
        try{
          const gl=await T.mapbox(settings.mapboxToken),c=coords();
          map=new gl.Map({container:pickBox,style:'mapbox://styles/mapbox/streets-v12',center:c?[c[1],c[0]]:[116.4,35],zoom:c?11:3.2,language:'zh-Hans'});
          map.addControl(new gl.NavigationControl({showCompass:false}),'top-right');
          pin=new gl.Marker({color:'#d9573b',draggable:true});
          if(c)pin.setLngLat([c[1],c[0]]).addTo(map);
          const pick=ll=>run(mp,async()=>{
            pin.setLngLat(ll).addTo(map);
            const la=+ll.lat.toFixed(2),lo=+ll.lng.toFixed(2);set('geo',la+','+lo);
            const [name,w]=await Promise.all([placeAt(ll.lat,ll.lng).catch(()=>''),weatherOn(draft.date,la,lo).catch(()=>'')]);
            if(name)set('place',name);if(w)set('weather',w);
            status('已按地图上的位置填好'+(name?'地点':'坐标')+(w?'和天气':'')+'，记得保存。','ok');
          });
          map.on('click',e=>pick(e.lngLat));
          pin.on('dragend',()=>pick(pin.getLngLat()));
        }catch(e){pickBox.hidden=true;status(e.message,'err');}
      };
    }
    const set=(k,v)=>{draft[k]=v;const i=$('f-'+k);if(i)i.value=v;};
    const coords=()=>{const m=/^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(draft.geo||'');return m?[+m[1],+m[2]]:null;};
    async function run(btn,fn){
      const t=btn.textContent;btn.disabled=true;btn.textContent='查询中……';
      try{await fn();changed();}catch(e){status(e.message||'没查到','err');}
      finally{btn.disabled=false;btn.textContent=t;}
    }
    go.onclick=()=>run(go,async()=>{
      status('正在获取位置……');
      const [la,lo]=await here();set('geo',la+','+lo);
      const [name,w]=await Promise.all([placeAt(la,lo).catch(()=>''),weatherOn(draft.date,la,lo).catch(e=>{status(e.message,'err');return '';})]);
      if(name)set('place',name);if(w)set('weather',w);
      if(w)status('已填好地点和天气，记得保存。','ok');
    });
    wx.onclick=()=>run(wx,async()=>{
      const c=coords();if(!c)throw new Error('先填坐标，或者点「获取位置和天气」');
      if(!T.parseDate(draft.date))throw new Error('先填日期');
      set('weather',await weatherOn(draft.date,c[0],c[1]));status('已按坐标查到 '+draft.date+' 的天气，记得保存。','ok');
    });
    wrap.append(h,row,r2,pickBox,el('span','hintx','坐标只保留两位小数（大约 1 公里），因为手帐是公开的。天气按这一页的日期查。'));
    return wrap;
  }

  /* ---------- 正文: a Markdown editor ----------
     A toolbar for the marks the page understands (render.js bodyBlocks), ⌘/Ctrl+B / I / K, and Enter carrying
     a list, checklist or quote on to the next line (Enter on an empty item ends it). Edits go through
     insertText, so ⌘/Ctrl+Z undoes them. The page beside the form is the preview. */
  function mdField(){
    const wrap=el('div','mdfield');
    const lab=el('label','sr',null);lab.textContent='正文';lab.htmlFor='f-body';
    const ta=el('textarea');ta.id='f-body';ta.rows=12;ta.maxLength=8000;ta.value=draft.body||'';ta.spellcheck=false;
    const on=()=>{draft.body=ta.value;changed();};
    ta.addEventListener('input',on);
    // replace [a, b) with text, then select [sa, sb) (offsets from a)
    function put(a,b,text,sa,sb){
      ta.focus();ta.setSelectionRange(a,b);
      if(!document.execCommand||!document.execCommand('insertText',false,text)){ta.setRangeText(text,a,b,'end');on();}
      ta.setSelectionRange(a+(sa==null?text.length:sa),a+(sb==null?(sa==null?text.length:sa):sb));
    }
    const sel=()=>[ta.selectionStart,ta.selectionEnd,ta.value];
    function wrapWith(pre,post,ph){
      const [a,b,v]=sel(),t=v.slice(a,b)||ph;
      put(a,b,pre+t+post,pre.length,pre.length+t.length);
    }
    // every line the selection touches gets the mark (or loses it, if they all have it)
    function lines(mark){
      const [a,b,v]=sel(),s0=v.lastIndexOf('\n',a-1)+1;let e0=v.indexOf('\n',b);if(e0<0)e0=v.length;
      const ls=v.slice(s0,e0).split('\n');
      const pre=i=>typeof mark==='function'?mark(i):mark;
      const has=ls.every((l,i)=>l.startsWith(pre(i)));
      const out=ls.map((l,i)=>has?l.slice(pre(i).length):pre(i)+l.replace(/^(\s*([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|#{1,3}\s+))/,'')).join('\n');
      put(s0,e0,out,out.length,out.length);
    }
    // a piece on lines of its own
    function block(text,sa,sb){
      const [a,b,v]=sel(),before=a>0&&v[a-1]!=='\n'?'\n':'',after=v[b]&&v[b]!=='\n'?'\n':'';
      put(a,b,before+text+after,before.length+(sa==null?text.length:sa),before.length+(sb==null?text.length:sb));
    }
    function heading(){
      const [a,,v]=sel(),s0=v.lastIndexOf('\n',a-1)+1,m=/^(#{1,3})\s+/.exec(v.slice(s0));
      const n=m?m[1].length%3+1:1,cut=m?m[0].length:0;
      put(s0,s0+cut,(m&&m[1].length===3)?'':'#'.repeat(n)+' ');
    }
    const TOOLS=[
      ['B','粗体（⌘/Ctrl+B）',()=>wrapWith('**','**','粗体'),'b'],
      ['I','强调（⌘/Ctrl+I）',()=>wrapWith('*','*','强调'),'i'],
      ['S','删除线',()=>wrapWith('~~','~~','划掉'),'s'],
      ['H','标题（再点换大小）',heading,'h'],
      ['▰','荧光笔重点',()=>wrapWith('==','==','重点'),'hl'],
      ['•','列表',()=>lines('- ')],
      ['1.','编号',()=>lines(i=>(i+1)+'. ')],
      ['☐','清单',()=>lines('- [ ] ')],
      ['❝','便签 / 引用',()=>lines('> ')],
      ['</>','代码',()=>{const [a,b,v]=sel();if(v.slice(a,b).includes('\n')||a===b)block('```\n'+(v.slice(a,b)||'代码')+'\n```',4,4+(v.slice(a,b)||'代码').length);else wrapWith('`','`','代码');}],
      ['🔗','链接（⌘/Ctrl+K）',()=>{const [a,b,v]=sel(),t=v.slice(a,b)||'文字';put(a,b,'['+t+'](https://)',t.length+3,t.length+11);}],
      ['—','分隔线',()=>block('---')],
      ['▦','漫画格',()=>block('@09:00 做什么：说的话 #laptop',7,14)],
      ['⤓','换页：后面的字从下一页写起',()=>block('+++\n')],   // the caret on the line after, ready to write on
    ];
    const bar=el('div','mdbar');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','正文格式');
    TOOLS.forEach(([t,title,fn,cls])=>{
      const b=el('button','mdb'+(cls?' mdb-'+cls:''),t);b.type='button';b.title=title;b.setAttribute('aria-label',title);
      b.addEventListener('mousedown',e=>e.preventDefault());   // keep the selection in the text
      b.onclick=fn;bar.appendChild(b);
    });
    ta.addEventListener('keydown',e=>{
      const mod=e.metaKey||e.ctrlKey;
      if(mod&&!e.shiftKey&&!e.altKey){
        const k=e.key.toLowerCase(),t=k==='b'?TOOLS[0]:k==='i'?TOOLS[1]:k==='k'?TOOLS[10]:null;
        if(t){e.preventDefault();t[2]();}
        return;
      }
      if(e.key!=='Enter'||e.shiftKey||e.isComposing||e.keyCode===229||ta.selectionStart!==ta.selectionEnd)return;
      const v=ta.value,a=ta.selectionStart,s0=v.lastIndexOf('\n',a-1)+1;
      const m=/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )(.*)$/.exec(v.slice(s0,a));
      if(!m)return;
      e.preventDefault();
      if(!m[5].trim()){put(s0,a,'');return;}          // an empty item: the list ends here
      const next=m[3]?(+m[3]+1)+m[4]+' ':m[2].replace(/\[[xX]\]/,'[ ]');
      put(a,a,'\n'+m[1]+next);
    });
    const help=el('details','mdhelp');
    help.appendChild(el('summary',null,'能写的格式'));
    const rows=[['**粗体**  *强调*  ~~划掉~~  ==重点==  `代码`','[文字](https://…) 是链接'],
      ['# 大标题  ## 中标题  ### 小标题','--- 一条虚线'],
      ['- 列表 / 1. 编号','- [ ] 没做完 / - [x] 做完了（红叉）'],
      ['> 一句话','贴一张胶带便签'],
      ['```↵ 代码 ↵```','一块深色代码'],
      ['@09:10 站会：今天修什么？ #laptop','漫画格：时间 · 在做什么、对话气泡、小插画（相邻几行排成一条）'],
      ['空一行','分段；段落里换行就是换行'],
      ['+++','换页：后面的从下一页写起（一页写不下时也会自动接到下一页）']];
    const tb=el('table');rows.forEach(([a,b])=>{const tr=el('tr');tr.append(el('td',null,a),el('td',null,b));tb.appendChild(tr);});
    help.appendChild(tb);
    help.appendChild(el('div','hintx','漫画格里 # 后面写小插画的名字：'+T.stickerList.map(x=>x.key+' '+x.label).join(' · ')));
    wrap.append(lab,bar,ta,el('span','hintx','没有照片时大约 250 字写满一页；写不下会接到下一页（续页），单独一行 +++ 可以自己换页。'),help);
    return wrap;
  }

  /* ---------- photos: up to three, each with its caption ---------- */
  const MAX_PHOTOS=3;
  function photoList(){
    if(!Array.isArray(draft.photos))draft.photos=draft.photoKey?[{key:draft.photoKey,cap:draft.photoCap||'',url:draft.photoUrl}]:[];
    return draft.photos;
  }
  // the first photo is also photoKey / photoCap (what older readers of a page look at)
  function syncFirst(){const f=draft.photos[0];draft.photoKey=f?f.key:'';draft.photoCap=f?f.cap:'';delete draft.photoUrl;}
  function photoField(){
    const wrap=el('div'),list=photoList();
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';
    l.textContent='可空，最多 '+MAX_PHOTOS+' 张，像拍立得一样贴在页上：一张放在字旁边，两三张在标题下面排一排。';
    wrap.appendChild(l);
    list.forEach((ph,i)=>{
      const row=el('div','photo-field');
      const th=el('div','thumb');th.style.backgroundImage='url("'+(ph.url||'/img/'+ph.key)+'")';
      const acts=el('div','photo-actions');
      if(i>0){const up=el('button','b small','往前放');up.type='button';up.onclick=()=>{list.splice(i-1,0,list.splice(i,1)[0]);syncFirst();drawForm();changed();};acts.appendChild(up);}
      const rm=el('button','b small','拿掉');rm.type='button';rm.onclick=()=>{list.splice(i,1);syncFirst();drawForm();changed();};acts.appendChild(rm);
      const cap=el('input');cap.type='text';cap.maxLength=30;cap.placeholder='照片下面的小字，比如：2023 · 海边';cap.value=ph.cap||'';
      cap.id='f-photoCap'+i;cap.setAttribute('aria-label','第 '+(i+1)+' 张照片的说明');
      cap.addEventListener('input',()=>{ph.cap=cap.value;syncFirst();changed();});
      const right=el('div');right.style.cssText='display:grid;gap:8px';right.append(cap,acts);
      row.append(th,right);wrap.appendChild(row);
    });
    if(list.length<MAX_PHOTOS){
      const acts=el('div','photo-actions');acts.style.marginTop=list.length?'8px':'0';
      const fb=el('span','b small filebtn',list.length?'再加一张':'选择照片');
      const inp=el('input');inp.type='file';inp.multiple=true;inp.accept='image/jpeg,image/png,image/webp,image/gif,image/heic';inp.id='f-photo';inp.setAttribute('aria-label','选择照片');
      fb.appendChild(inp);acts.appendChild(fb);wrap.appendChild(acts);
      inp.addEventListener('change',async()=>{
        const files=[...(inp.files||[])].slice(0,MAX_PHOTOS-list.length);if(!files.length)return;
        fb.firstChild.textContent='上传中……';status('正在压缩并上传照片……');
        try{
          let info=null;
          for(const file of files){
            info=info||await exifOf(file).catch(()=>null);
            const blob=await shrink(file);
            const r=await api('/api/admin/photos',{method:'POST',headers:{'content-type':blob.type,accept:'application/json'},body:blob});
            list.push({key:r.key,cap:'',url:URL.createObjectURL(blob)});
          }
          const said=await fromPhoto(info);
          syncFirst();drawForm();changed();
          status(said.length?'照片已上传，按照片的拍摄信息填好了'+said.join('、')+'，记得保存这一页。':'照片已上传，记得保存这一页。','ok');
        }catch(e){syncFirst();drawForm();changed();status(e.message||'照片上传失败','err');}
      });
    }
    return wrap;
  }
  /* photos go up redrawn (big NAS originals shrunk to 1600px JPEG): never as they came, since a camera's EXIF
     (where it was taken, to the metre) would be public with them. What the admin wants from it is read before
     (exifOf). */
  async function shrink(file,max=1600,keepAlpha=false){
    if(file.type==='image/gif')return file;
    let bmp;
    try{bmp=await createImageBitmap(file);}catch(e){throw new Error('这个格式浏览器打不开，请换成 JPG 或 PNG');}
    const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    // cover stickers keep a transparent background: re-encode PNG / WebP as PNG, not JPEG
    const out=keepAlpha&&/^image\/(png|webp)$/.test(file.type)?['image/png']:['image/jpeg',0.86];
    return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('压缩失败')),...out));
  }

  /* When and where a JPEG was taken, from its EXIF: {date:'YYYY-MM-DD', lat, lon} (either may be missing), or
     null. Only the start of the file is read; anything unexpected is simply no answer. */
  async function exifOf(file){
    if(!/jpe?g/i.test(file.type||file.name))return null;
    const v=new DataView(await file.slice(0,262144).arrayBuffer());
    if(v.byteLength<4||v.getUint16(0)!==0xFFD8)return null;
    let o=2;
    while(o+4<=v.byteLength){
      const mk=v.getUint16(o),len=v.getUint16(o+2);
      if((mk&0xFF00)!==0xFF00||mk===0xFFDA)return null;
      if(mk===0xFFE1&&o+10<=v.byteLength&&v.getUint32(o+4)===0x45786966)return tiff(v,o+10);   // "Exif"
      o+=2+len;
    }
    return null;
  }
  function tiff(v,t){
    const le=v.getUint16(t)===0x4949,u16=p=>v.getUint16(p,le),u32=p=>v.getUint32(p,le);
    // an IFD's entries: tag → [type, count, where its value is]
    const ifd=at=>{
      const m=new Map();if(!at||t+at+2>v.byteLength)return m;
      const n=u16(t+at);
      for(let i=0;i<n;i++){
        const e=t+at+2+i*12;if(e+12>v.byteLength)break;
        const type=u16(e+2),count=u32(e+4),size=({1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8})[type]||1;
        m.set(u16(e),[type,count,count*size>4?t+u32(e+8):e+8]);
      }
      return m;
    };
    const ascii=x=>{if(!x)return '';let s='';for(let i=0;i<x[1]&&x[2]+i<v.byteLength;i++){const c=v.getUint8(x[2]+i);if(!c)break;s+=String.fromCharCode(c);}return s;};
    const num=x=>(x[0]===3?u16(x[2]):u32(x[2]));
    const rats=x=>{const r=[];for(let i=0;i<x[1]&&x[2]+i*8+8<=v.byteLength;i++){const d=u32(x[2]+i*8+4);r.push(d?u32(x[2]+i*8)/d:0);}return r;};
    const ifd0=ifd(u32(t+4));
    const ex=ifd0.has(0x8769)?ifd(num(ifd0.get(0x8769))):new Map();
    const gps=ifd0.has(0x8825)?ifd(num(ifd0.get(0x8825))):new Map();
    const out={};
    const dm=/^(\d{4}):(\d{2}):(\d{2})/.exec(ascii(ex.get(0x9003))||ascii(ex.get(0x9004))||ascii(ifd0.get(0x0132)));
    if(dm&&dm[1]!=='0000')out.date=dm[1]+'-'+dm[2]+'-'+dm[3];
    const deg=(ref,val)=>{if(!gps.has(val))return null;const [d,m,s]=rats(gps.get(val));const x=(d||0)+(m||0)/60+(s||0)/3600;return /[SW]/.test(ascii(gps.get(ref)))?-x:x;};
    const la=deg(1,2),lo=deg(3,4);
    if(la!=null&&lo!=null&&(la||lo)&&Math.abs(la)<=90&&Math.abs(lo)<=180){out.lat=la;out.lon=lo;}
    return out.date||out.lat!=null?out:null;
  }
  /* what a photo knows, onto the page: its day (a new page still on today's date takes it), and where it was
     taken with that day's weather, for a page without a place yet. Only what's still empty; nothing saved. */
  async function fromPhoto(info){
    const said=[];
    if(!info)return said;
    if(info.date&&sel==='new'&&draft.date===T.todayStr()&&info.date<draft.date){draft.date=info.date;said.push('日期');}
    if(info.lat!=null&&!draft.place&&!draft.geo){
      const la=+info.lat.toFixed(2),lo=+info.lon.toFixed(2);
      draft.geo=la+','+lo;said.push('坐标');
      const [name,w]=await Promise.all([placeAt(info.lat,info.lon).catch(()=>''),draft.weather?'':weatherOn(draft.date,la,lo).catch(()=>'')]);
      if(name){draft.place=name;said.push('地点');}
      if(w){draft.weather=w;said.push('天气');}
    }
    return said;
  }

  /* ---------- save / delete ---------- */
  async function save(){
    if(busy||!draft)return false;
    if(sel==='new'&&newLock){
      if([...newLock.p1].length<4){status('口令至少 4 个字符（不想上锁就清空）。','err');const i=$('nl1');if(i)i.focus();return false;}
      if(newLock.p1!==newLock.p2){status('两次输入的口令不一样。','err');const i=$('nl2');if(i)i.focus();return false;}
    }
    if(sel!=='settings'){
      if(!T.parseDate(draft.date)){status('请填日期。','err');return false;}
      if(!String(draft.title||'').trim()){status('标题不能为空。','err');const t=$('f-title');if(t)t.focus();return false;}
    }
    busy=true;status('正在保存……');
    try{
      if(sel==='settings'){
        const r=await sendJson('PUT','/api/admin/settings',stripLocal(draft));
        settings=r.settings;aiKeySet=!!(r.ai&&r.ai.keySet);draft=Object.assign({},settings);base=JSON.stringify(draft);T.useSite(settings);
        drawForm();status('已保存，刷新主页就能看到。','ok');
      }else{
        const body=stripLocal(draft);
        const r=sel==='new'?await sendJson('POST','/api/admin/entries',body):await sendJson('PUT','/api/admin/entries/'+encodeURIComponent(sel),body);
        const en=r.entry;const i=entries.findIndex(e=>e.id===en.id);
        let lockNote='';
        if(sel==='new'&&newLock){
          try{await sendJson('PUT','/api/admin/locks/'+encodeURIComponent(en.id),{password:newLock.p1});en.locked=true;lockNote='，并已上锁';}
          catch(e){lockNote='，但上锁没成功：'+(e.message||'稍后在下面「单独上锁」里再设');}
          newLock=null;
        }
        if(i>=0)en.locked=entries[i].locked;          // the lock is kept apart from the page's fields
        if(i>=0)entries[i]=en;else entries.push(en);
        // photos just uploaded keep showing from this browser's copy
        const urls=new Map((draft.photos||[]).filter(p=>p.url).map(p=>[p.key,p.url]));
        sel=en.id;draft=Object.assign({},en);
        draft.photos=(en.photos||[]).map(p=>Object.assign({},p,urls.has(p.key)?{url:urls.get(p.key)}:{}));
        base=JSON.stringify(stripLocal(draft));
        drawList();drawForm();status((en.status==='draft'?'已存为草稿，主页上还看不到':'已发布，主页刷新就能看到')+lockNote+'。',lockNote.includes('没成功')?'err':'ok');
        refreshCard(en);
      }
      return true;
    }catch(e){
      // a failed publish/unpublish shouldn't leave the button label lying about the state
      if(sel!=='settings'&&sel!=='new'){const en=entries.find(x=>x.id===sel);if(en)draft.status=en.status;}
      status(e.message||'保存失败，稍后再试。','err');return false;
    }
    finally{busy=false;}
  }
  async function remove(){
    if(busy)return;busy=true;status('正在删除……');
    try{
      await api('/api/admin/entries/'+encodeURIComponent(sel),{method:'DELETE'});
      entries=entries.filter(e=>e.id!==sel);sel=null;draft=null;base='';
      drawList();drawForm();
    }catch(e){status(e.message||'删除失败','err');}
    finally{busy=false;}
  }
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();save();}});
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});

  /* ---------- boot ---------- */
  (async()=>{
    try{
      const me=await api('/api/admin/me');
      $('who').textContent='已登录'+(me.login?' @'+me.login:'');$('logout').hidden=false;
      // all the settings, the AI's too (the public /api/settings leaves those out)
      const [e,s]=await Promise.all([api('/api/admin/entries'),api('/api/admin/settings')]);
      entries=e.entries||[];settings=s.settings||{};aiKeySet=!!(s.ai&&s.ai.keySet);bookLocked=!!e.bookLocked;
      T.useSite(settings);   // the preview draws pages as the book does (the little map needs the Mapbox token)
      entries.forEach(en=>{if(en.dayLocked)dayLocks.add(en.date);});
      drawList();drawForm();
    }catch(err){
      // not signed in, or the Worker can't do sign-in yet (e.g. GitHub app not configured): either way, the login sheet says why
      if(!$('gate').hidden)return;
      gate();$('gateMsg').textContent=err.message||'加载失败，刷新再试。';
    }
  })();
})();
