/* Admin for the journal: write pages, upload photos to R2, edit contact info. */
(function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const $=id=>document.getElementById(id);
  const main=$('main'),list=$('list');
  let entries=[],settings={},jots=[];
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
  }
  $('logout').onclick=async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch(e){}location.reload();};
  const sendJson=(method,path,obj)=>api(path,{method,headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(obj)});

  /* ---------- list ---------- */
  function drawList(){
    list.textContent='';
    const nd=entries.filter(e=>e.status==='draft').length;
    $('countLabel').textContent='已写的页 · '+entries.length+(nd?'（草稿 '+nd+'）':'');
    T.sortEntries(entries).reverse().forEach(en=>{
      const it=el('button','item'+(en.status==='draft'?' draft':''));it.type='button';it.dataset.id=en.id;
      it.setAttribute('aria-current',sel===en.id?'true':'false');
      const t=el('b',null,en.title||'（无题）');
      if(en.status==='draft')t.appendChild(el('em','tag','草稿'));
      it.append(t,el('span',null,en.date+(en.photoKey?' · 有照片':'')));
      it.onclick=()=>select(en.id);
      list.appendChild(it);
    });
    $('newBtn').setAttribute('aria-current',sel==='new'?'true':'false');
    $('settingsBtn').setAttribute('aria-current',sel==='settings'?'true':'false');
    $('jotsBtn').setAttribute('aria-current',sel==='jots'?'true':'false');
  }
  $('newBtn').onclick=()=>select('new');
  $('jotsBtn').onclick=()=>select('jots');
  $('settingsBtn').onclick=()=>select('settings');

  const dirty=()=>draft&&JSON.stringify(stripLocal(draft))!==base;
  function stripLocal(d){const c=Object.assign({},d);delete c.photoUrl;return c;}

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
    if(id==='settings'){draft=Object.assign({email:'',github:'',githubText:''},settings);}
    else if(id==='jots'){draft=null;}
    else if(id==='new'){draft={date:T.todayStr(),title:'',latin:'',stamp:'',aside:'',body:'',note:'',mood:'mug',quote:'',quoteSrc:'',photoKey:'',photoCap:'',stickers:[],status:'published'};}
    else{const en=entries.find(e=>e.id===id);draft=en?Object.assign({},en):null;}
    base=draft?JSON.stringify(stripLocal(draft)):'';
    drawList();drawForm();
  }

  /* ---------- form ---------- */
  let pvbox=null,statusEl=null;
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
    drawPreview();
    status(dirty()?'有改动还没保存。':'');
  }
  function drawPreview(){
    if(!pvbox||!draft||sel==='settings')return;
    pvbox.textContent='';
    const p=T.fitText(T.entryPage(draft,'r'));
    pvbox.appendChild(p);
  }
  function drawForm(){
    main.textContent='';pvbox=null;statusEl=el('div','status');
    if(sel==='jots'){drawJots();return;}
    if(!sel||!draft){
      const d=el('div','form');
      d.append(el('h2',null,'今天写点什么？'),el('div','hand','点左边「新写一页」开始写，或者选一页已经写过的来改。保存后主页马上就能看到。'));
      main.appendChild(d);return;
    }
    const f=el('form','form');f.noValidate=true;
    f.addEventListener('submit',e=>{e.preventDefault();save();});
    if(sel==='settings'){
      f.append(el('h2',null,'联系方式'),
        field('邮箱（显示在最后一页的信封上）','email','email',{ph:'you@example.com',max:120}),
        field('GitHub 地址','github','url',{ph:'https://github.com/你的用户名',hint:'要以 https:// 开头',max:200}),
        field('链接上显示的文字（可空）','githubText','text',{ph:'github.com/你的用户名',max:60}));
      const b=el('div','bar');const s=el('button','b pri','保存');s.type='submit';b.appendChild(s);
      f.append(b,statusEl);main.appendChild(f);return;
    }
    f.appendChild(el('h2',null,sel==='new'?'新的一页':draft.status==='draft'?'草稿':'编辑这一页'));
    if(draft.status==='draft')f.appendChild(el('div','hintx','这一页还是草稿，主页上看不到。看过没问题就点「发布这一页」。'));
    const r1=el('div','row');r1.append(dateField(),field('页眉小字','aside','text',{ph:'比如：下了一整天雨',max:30}));
    const r2=el('div','row');r2.append(field('标题（手写大字）','title','text',{ph:'今天的标题',max:30,hint:'8 个字以内最好看'}),field('英文小注','latin','text',{ph:'a small note in English',max:60}));
    f.append(r1,r2,field('正文','body','textarea',{rows:10,max:4000,hint:'空一行分段。没有照片时大约 250 字写满一页，再多字会自动缩小。'}));
    f.appendChild(photoField());
    f.appendChild(stickerField());
    const r3=el('div','row');r3.append(field('贴一张便签（可空）','note','text',{ph:'一句话，像纸条一样贴在正文下面',max:60}),
      field('小咖','mood','select',{options:[['mug','醒着'],['sleep','睡着'],['none','不出场']]}));
    const r4=el('div','row');r4.append(field('印章（一个字）','stamp','text',{ph:'记',max:2}),field('页脚引文','quote','text',{ph:'一句喜欢的话',max:120}));
    f.append(r3,r4,field('引文出处','quoteSrc','text',{ph:'作者《书名》',max:60}));
    const b=el('div','bar');
    const isDraft=draft.status==='draft';
    const s=el('button','b pri',isDraft?'发布这一页':sel==='new'?'保存这一页':'保存修改');s.type='button';
    s.onclick=()=>{draft.status='published';save();};
    const s2=el('button','b',isDraft||sel==='new'?'存为草稿':'改回草稿');s2.type='button';
    s2.onclick=()=>{draft.status='draft';save();};
    b.append(s,s2);
    if(sel!=='new'){
      const del=el('button','b warn','删除这一页');del.type='button';
      del.onclick=()=>{
        const c=el('span','confirm','删除后不能恢复，确定？');
        const yes=el('button','b warn small','删除');yes.type='button';
        const no=el('button','b small','取消');no.type='button';
        c.append(yes,no);del.replaceWith(c);
        no.onclick=()=>c.replaceWith(del);
        yes.onclick=remove;
      };
      b.appendChild(del);
    }
    f.append(b,statusEl);
    const pv=el('div','pv');pvbox=el('div','pvbox');
    pv.append(pvbox,el('div','pvcap','预览 · 保存后会按日期排进手帐'));
    main.append(f,pv);drawPreview();
    if(sel==='new')setTimeout(()=>{const t=$('f-title');if(t)t.focus();},0);
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

  /* ---------- doodles ---------- */
  function stickerField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';
    l.textContent='小插画（最多两个，翻到这页时会一笔一笔画出来）';
    const grid=el('div','stkpick');grid.setAttribute('role','group');grid.setAttribute('aria-label','小插画');
    const cur=()=>Array.isArray(draft.stickers)?draft.stickers:[];
    const paint=()=>grid.querySelectorAll('button').forEach(bt=>bt.setAttribute('aria-pressed',cur().includes(bt.dataset.k)?'true':'false'));
    T.stickerList.forEach(({key,label})=>{
      const bt=el('button');bt.type='button';bt.dataset.k=key;bt.title=label;
      bt.append(T.stickerSvg(key,34),el('span',null,label));
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
  function drawJots(){
    const f=el('form','form');f.noValidate=true;
    f.append(el('h2',null,'随手记'),el('div','hintx','白天想到什么就记一句。每晚 22:00 Claude 会把今天记下的这些和当天的聊天一起写成一页草稿；电脑没开的话，23:30 网站会自己用随手记写。'));
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
    f.append(l,b,statusEl,ul);main.appendChild(f);paint();
    (async()=>{try{const r=await api('/api/admin/jots');jots=r.jots||[];paint();}catch(e){status(e.message||'加载失败','err');}})();
    setTimeout(()=>ta.focus(),0);
  }

  /* ---------- photo ---------- */
  function photoField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';l.textContent='照片（可空，会像拍立得一样贴在页上）';
    const row=el('div','photo-field');
    const th=el('div','thumb');
    const setThumb=()=>{const u=draft.photoUrl||(draft.photoKey?'/img/'+draft.photoKey:'');th.style.backgroundImage=u?'url("'+u+'")':'';};
    setThumb();
    const acts=el('div','photo-actions');
    const fb=el('span','b small filebtn',draft.photoKey?'换一张':'选择照片');
    const inp=el('input');inp.type='file';inp.accept='image/jpeg,image/png,image/webp,image/gif,image/heic';inp.id='f-photo';inp.setAttribute('aria-label','选择照片');
    fb.appendChild(inp);acts.appendChild(fb);
    if(draft.photoKey){const rm=el('button','b small','拿掉照片');rm.type='button';rm.onclick=()=>{draft.photoKey='';draft.photoUrl='';setThumb();drawForm();changed();};acts.appendChild(rm);}
    const cap=el('input');cap.type='text';cap.maxLength=30;cap.placeholder='照片下面的小字，比如：2023 · 海边';cap.value=draft.photoCap||'';cap.id='f-photoCap';
    cap.addEventListener('input',()=>{draft.photoCap=cap.value;changed();});
    const right=el('div');right.style.cssText='display:grid;gap:8px';right.append(acts,cap);
    row.append(th,right);wrap.append(l,row);
    inp.addEventListener('change',async()=>{
      const file=inp.files&&inp.files[0];if(!file)return;
      fb.firstChild.textContent='上传中……';status('正在压缩并上传照片……');
      try{
        const blob=await shrink(file);
        const r=await api('/api/admin/photos',{method:'POST',headers:{'content-type':blob.type,accept:'application/json'},body:blob});
        draft.photoKey=r.key;draft.photoUrl=URL.createObjectURL(blob);
        setThumb();drawForm();changed();status('照片已上传，记得保存这一页。','ok');
      }catch(e){fb.firstChild.textContent='选择照片';status(e.message||'照片上传失败','err');}
    });
    return wrap;
  }
  /* shrink big photos (NAS originals) to 1600px JPEG before upload */
  async function shrink(file){
    if(file.type==='image/gif')return file;
    let bmp;
    try{bmp=await createImageBitmap(file);}catch(e){throw new Error('这个格式浏览器打不开，请换成 JPG 或 PNG');}
    const max=1600,k=Math.min(1,max/Math.max(bmp.width,bmp.height));
    if(k===1&&file.size<1.5e6&&/^image\/(jpeg|png|webp)$/.test(file.type))return file;
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('压缩失败')),'image/jpeg',0.86));
  }

  /* ---------- save / delete ---------- */
  async function save(){
    if(busy||!draft)return false;
    if(sel!=='settings'){
      if(!T.parseDate(draft.date)){status('请填日期。','err');return false;}
      if(!String(draft.title||'').trim()){status('标题不能为空。','err');const t=$('f-title');if(t)t.focus();return false;}
    }
    busy=true;status('正在保存……');
    try{
      if(sel==='settings'){
        const r=await sendJson('PUT','/api/admin/settings',stripLocal(draft));
        settings=r.settings;draft=Object.assign({},settings);base=JSON.stringify(draft);
        status('已保存，主页上的联系方式已更新。','ok');
      }else{
        const body=stripLocal(draft);
        const r=sel==='new'?await sendJson('POST','/api/admin/entries',body):await sendJson('PUT','/api/admin/entries/'+encodeURIComponent(sel),body);
        const en=r.entry;const i=entries.findIndex(e=>e.id===en.id);
        if(i>=0)entries[i]=en;else entries.push(en);
        const keepUrl=draft.photoUrl;
        sel=en.id;draft=Object.assign({},en);if(keepUrl&&draft.photoKey)draft.photoUrl=keepUrl;
        base=JSON.stringify(stripLocal(draft));
        drawList();drawForm();status(en.status==='draft'?'已存为草稿，主页上还看不到。':'已发布，主页刷新就能看到。','ok');
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
      $('who').textContent='已登录 @'+me.login;$('logout').hidden=false;
      const [e,s]=await Promise.all([api('/api/admin/entries'),api('/api/settings')]);
      entries=e.entries||[];settings=s.settings||{};
      drawList();drawForm();
    }catch(err){
      main.textContent='';main.appendChild(el('div','empty-state hand',err.message||'加载失败，刷新再试。'));
    }
  })();
})();
