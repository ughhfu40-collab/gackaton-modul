import {initialState,staff,departments,viewState,mutate,isClosed,isLate,statusOptions,problemStages} from './model.js';
import {locales,translator,localized} from './i18n.js';

const root=document.querySelector('#app'),dialog=document.querySelector('#dialog');
const storeKey='modus-pulse-demo-v1';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
let lang=read('pulse-lang','ru'),user=null,data=null,localData=null,offline=false,demo=false,page='overview';
let filters={},busy=false,toastTimer;
if(!locales.includes(lang))lang='ru';
const t=key=>translator(lang)(key);
const l=value=>localized(value,lang)??'';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=value=>esc(l(value));
const E=key=>esc(t(key));
const findTicket=id=>data.tickets.find(row=>row.id===id);
const findProblem=id=>data.problems.find(row=>row.id===id);
const category=id=>data.categories.find(row=>row.id===id)?.label??'';
const ownerName=id=>{
  const account=staff.find(s=>s.id===id);
  if(!account)return t('none');
  if(id==='lead')return t('lead');
  if(account.role==='admin')return t('admin');
  return t(account.role)+' · '+t(account.dept);
};
const locale=()=>({ru:'ru-RU',kk:'kk-KZ',en:'en-GB'})[lang];
const date=value=>value?new Intl.DateTimeFormat(locale(),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
const day=value=>value?new Intl.DateTimeFormat(locale(),{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):'—';
const number=(value,digits=0)=>new Intl.NumberFormat(locale(),{maximumFractionDigits:digits}).format(value);
const lead=()=>user?.role==='coordinator';
const handler=()=>['coordinator','manager'].includes(user?.role);
const admin=()=>user?.role==='admin';
const navIcons={overview:'▦',mine:'▤',queue:'☷',problems:'◈',routes:'⚙',notifications:'◷'};
const statusBadge=status=>`<span class="badge ${esc(status)}"><i></i>${E(status)}</span>`;
const options=(rows,selected)=>rows.map(([id,label])=>`<option value="${esc(id)}"${id===selected?' selected':''}>${esc(label)}</option>`).join('');
const translations=ids=>ids.map(id=>[id,t(id)]);
const owners=()=>[['',t('none')],...staff.filter(s=>['manager','coordinator'].includes(s.role)).map(s=>[s.id,ownerName(s.id)])];
const accounts=()=>staff.map(s=>[s.id,ownerName(s.id)]);
const categories=()=>data.categories.map(c=>[c.id,l(c.label)]);
const select=(name,rows,value='',required=false)=>`<select name="${name}"${required?' required':''}>${options(rows,value)}</select>`;
const field=(name,label,value='',attributes='')=>`<label><span>${E(label)}</span><input name="${name}" value="${e(value)}" ${attributes}></label>`;
const area=(name,label,value='',required=false)=>`<label><span>${E(label)}</span><textarea name="${name}" maxlength="4000" ${required?'required':''}>${e(value)}</textarea></label>`;
const labelled=(key,control)=>`<label><span>${E(key)}</span>${control}</label>`;
const action=(label,cmd,id='',classes='button secondary',extra='')=>`<button type="button" class="${classes}" data-cmd="${cmd}" data-id="${esc(id)}" ${extra}>${label}</button>`;
const submit=(label,classes='button primary')=>`<button class="${classes}" type="submit">${E(label)}</button>`;
const form=(op,id,body)=>`<form data-op="${op}" data-id="${esc(id??'')}">${body}</form>`;

function toast(message,error=false){
  const el=document.querySelector('#toast');
  el.textContent=t(message);el.className=error?'visible error':'visible';
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.className='';},4500);
}
async function api(path,body){
  const res=await fetch('./api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.headers.get('Content-Type')?.includes('application/json'))throw new Error('server');
  const out=await res.json();if(!res.ok)throw new Error(out.error||'server');
  return out;
}
async function changeAccount(id,password='pulse-demo'){
  if(offline){
    user=staff.find(s=>s.id===id);
    write('pulse-account',id);data=viewState(localData,user);
  }else{
    const login=await api('login',{account:id,password});
    user=login.user;data=await api('state');
  }
  page=admin()?'routes':handler()?'overview':'mine';filters={};
  if(dialog.open)dialog.close();
  render();
}
function languageSelect(){
  return `<label class="language"><span class="sr">${E('language')}</span><select data-change="language">${options([['ru','Русский'],['kk','Қазақша'],['en','English']],lang)}</select></label>`;
}
function logo(){
  return `<div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div><strong>${E('app')}</strong><small>${E('tagline')}</small></div></div>`;
}
function go(target){
  page=target;filters={};render();
  document.querySelector('main')?.focus();
  window.scrollTo(0,0);
}
function render(){
  document.documentElement.lang=lang;document.title=t('app');
  document.querySelector('.skip').textContent=t('workspace');
  if(!user){
    root.innerHTML=`<main class="login-shell" id="content"><div class="login-card">${logo()}${languageSelect()}<h1>${E('loginTitle')}</h1>${form('login','',labelled('role',select('account',accounts(),'lead'))+field('password','password','','type="password" required autocomplete="current-password"')+submit('signIn'))}</div></main>`;
    return;
  }
  const pages=admin()?['routes']:handler()?['overview','queue','mine',...(lead()?['problems']:[]),'notifications']:['overview','mine','notifications'];
  if(!pages.includes(page))page=pages[0];
  const nav=pages.map(key=>action(`<span class="nav-icon" aria-hidden="true">${navIcons[key]}</span>${E(key)}`,'nav',key,'nav-link'+(page===key?' current':''),page===key?'aria-current="page"':'')).join('');
  const controls=demo?`<label class="account"><span class="sr">${E('role')}</span><span class="avatar" aria-hidden="true">${admin()?'A':handler()?'M':'E'}</span><select data-change="account">${options(accounts(),user.id)}</select></label>`:action(E('signOut'),'logout');
  root.innerHTML=`<div class="layout"><aside class="sidebar">${logo()}<p class="nav-caption">${E('workspace')}</p><nav aria-label="${E('workspace')}">${nav}</nav><div class="sidebar-footer"><span class="indicator"></span>${demo?E(offline?'localDemo':'serverDemo'):esc(ownerName(user.id))}</div></aside><div class="work">
    <header class="top"><span class="crumb"><span aria-hidden="true">⌂</span> ${E(page)}</span><div class="top-tools">${languageSelect()}${controls}</div></header>
    <main id="content" tabindex="-1">${({overview,mine:requestPage,queue:requestPage,problems:problemsPage,routes:routesPage,notifications:notificationsPage})[page]()}</main>
    </div></div>`;
}
function header(title,hint='',button=''){
  return `<div class="heading"><div><h1>${E(title)}</h1>${hint?`<p>${E(hint)}</p>`:''}</div>${button}</div>`;
}
const createButton=()=>action('＋ '+E('create'),'create','','button primary');
function overview(){
  const tickets=data.tickets;
  const finished=tickets.filter(t=>isClosed(t.status)).length;
  const responses=tickets.filter(t=>t.first).map(t=>(Date.parse(t.first)-Date.parse(t.created))/3600000);
  const avg=responses.length?number(responses.reduce((a,b)=>a+b,0)/responses.length,1)+' '+t('hourUnit'):'—';
  const metrics=[['all',tickets.length,'▤','violet'],['active',tickets.length-finished,'◷','blue'],['late',tickets.filter(t=>isLate(t)).length,'!','orange'],['finished',tickets.length?number(100*finished/tickets.length)+'%':'—','✓','green'],['response',avg,'↗','violet']];
  const stat=metrics.map(([key,val,icon,color])=>`<div class="stat"><div class="stat-icon ${color}">${icon}</div><span>${E(key)}</span><strong>${esc(val)}</strong>${key==='response'||key==='finished'?`<small>${E(key==='response'?'avgHint':'shareHint')}</small>`:''}</div>`).join('');
  const countTypes=['problem','idea','praise'].map(key=>[t(key),tickets.filter(ticket=>ticket.type===key).length]);
  const counts=data.categories.map(c=>[l(c.label),tickets.filter(ticket=>ticket.category===c.id).length]).filter(([,n])=>n).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const bars=items=>items.map(([label,value])=>`<div class="bar-label"><span>${esc(label)}</span><strong>${value}</strong></div><div class="track"><span style="width:${value/Math.max(tickets.length,1)*100}%"></span></div>`).join('');
  const topProblem=data.problems[0];
  return `${header('welcome','homeHint',createButton())}<div class="stats">${stat}</div>
    <div class="summary-grid"><section class="panel summary"><h2>${E('byType')}</h2>${bars(countTypes)}</section><section class="panel summary"><h2>${E('byCategory')}</h2>${counts.length?bars(counts):`<p class="muted">${E('empty')}</p>`}</section>${topProblem?`<section class="panel focus"><span class="focus-mark" aria-hidden="true">◈</span><h2>${E('focus')}</h2><p>${e(topProblem.title)}</p><div class="focus-meta">${E('links')} · ${tickets.filter(t=>t.problem===topProblem.id).length}</div>${action(E('openProblem')+' ↗','problem',topProblem.id,'button light')}</section>`:''}</div>
    <section class="panel"><div class="panel-head"><h2>${E('latest')}</h2>${action(E('viewAll')+' →','nav',handler()?'queue':'mine','button text')}</div>${table([...tickets].sort((a,b)=>Date.parse(b.created)-Date.parse(a.created)).slice(0,5))}</section>`;
}
function table(tickets){
  if(!tickets.length)return `<div class="empty"><span aria-hidden="true">▤</span><h3>${E('empty')}</h3><p>${E('emptyState')}</p></div>`;
  return `<div class="table-scroll"><table><thead><tr><th>${E('title')}</th><th>${E('dept')}</th><th>${E('status')}</th><th>${E('owner')}</th><th>${E('due')}</th></tr></thead><tbody>${tickets.map(ticket=>`<tr>
    <td><span class="ticket-id">${esc(ticket.id)} · ${E(ticket.type)}</span>${action(e(ticket.title),'ticket',ticket.id,'ticket-link')}<small>${e(category(ticket.category))}</small></td>
    <td>${E(ticket.dept)}</td><td>${statusBadge(ticket.status)}</td><td>${esc(ownerName(ticket.owner))}</td>
    <td class="${isLate(ticket)?'overdue':''}">${date(ticket.due)}${isLate(ticket)?`<small>${E('late')}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}
function filtered(){
  const term=(filters.search??'').trim().toLocaleLowerCase(locale());
  const tickets=page==='mine'?data.tickets.filter(t=>t.author===user.id):data.tickets;
  return tickets.filter(ticket=>
    (!term||[ticket.id,l(ticket.title),l(ticket.body)].some(value=>String(value).toLocaleLowerCase(locale()).includes(term)))&&
    ['category','dept','status','priority','type'].every(key=>!filters[key]||ticket[key]===filters[key])&&
    (!filters.quick||({late:isLate(ticket),triage:!ticket.owner&&!isClosed(ticket.status),active:!isClosed(ticket.status),finished:isClosed(ticket.status)})[filters.quick])
  ).sort((a,b)=>Date.parse(b.created)-Date.parse(a.created));
}
function results(){
  const tickets=filtered();
  return `<div class="result-count">${E('found')} <strong>${tickets.length}</strong></div>${table(tickets)}`;
}
function requestPage(){
  const filtersUI=[['type',translations(['problem','idea','praise'])],['dept',translations(departments)],['category',categories()],['status',translations(statusOptions)],['priority',translations(['high','medium','low'])]]
    .map(([key,list])=>labelled(key,select(key,[['',t('showAll')],...list],filters[key]))).join('');
  const chips=['all','active','late',...(handler()&&page==='queue'?['triage']:[]),'finished'].map(key=>action(E(key),'quick',key,'chip'+((filters.quick||'all')===key?' selected':''))).join('');
  return `${header(page,page==='queue'?'queueHint':'homeHint',createButton())}
    <section class="panel"><div class="filter-area"><div class="chips">${chips}</div><div class="search-row"><label class="search"><span aria-hidden="true">⌕</span><span class="sr">${E('search')}</span><input type="search" data-filter="search" placeholder="${E('search')}" value="${esc(filters.search??'')}"></label>${action(E('reset'),'clear','','button text')}</div><div class="filters">${filtersUI}</div></div><div id="results">${results()}</div></section>`;
}
function problemsPage(){
  return `${header('problems','problemHint',action('＋ '+E('problemNew'),'problem','','button primary'))}<div class="problem-grid">${data.problems.map(p=>{
    const linked=data.tickets.filter(ticket=>ticket.problem===p.id);
    const depts=[...new Set(linked.map(ticket=>ticket.dept))];
    return `<article class="panel problem-card"><div class="problem-top"><span class="ticket-id">${esc(p.id)}</span>${statusBadge(p.stage)}</div><h2>${e(p.title)}</h2><p>${e(p.description)}</p><div class="chips">${depts.map(dept=>`<span class="chip">${E(dept)}</span>`).join('')}</div><div class="problem-bottom"><span>${E('links')} · ${linked.length}</span>${action(E('openProblem')+' →','problem',p.id,'button text')}</div></article>`;
  }).join('')||`<p>${E('noProblems')}</p>`}</div>`;
}
function routesPage(){
  return `${header('routes','routeHint',action('＋ '+E('addCategory'),'route','','button primary'))}<section class="panel"><div class="panel-head"><p class="muted">${E('routingSample')}</p></div><div class="table-scroll"><table><thead><tr><th>${E('category')}</th><th>${E('owner')}</th><th>${E('hours')}</th><th></th></tr></thead><tbody>${data.categories.map(c=>`<tr><td>${e(c.label)}</td><td>${esc(ownerName(c.owner))}</td><td>${c.hours}</td><td>${action(E('manage'),'route',c.id,'button text')}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function notificationsPage(){
  const events=data.tickets.flatMap(ticket=>ticket.events.filter(event=>event.by!==user.id&&['status','decision','comment','assigned','registered'].includes(event.kind)).map(event=>({event,ticket}))).sort((a,b)=>Date.parse(b.event.at)-Date.parse(a.event.at));
  return `${header('notifications')}<section class="panel notice-list">${events.slice(0,60).map(({event,ticket})=>`<div class="notice"><div><strong>${E(event.status||event.kind)}</strong><p>${esc(event.text||l(ticket.title))}</p><small>${date(event.at)}</small></div>${action(esc(ticket.id)+' →','ticket',ticket.id,'button text')}</div>`).join('')||`<p>${E('noUpdates')}</p>`}</section>`;
}
function show(title,body,id=''){
  dialog.dataset.id=id;
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2>${action('×','dismiss','','icon-button',`aria-label="${E('close')}"`)}</div><div class="dialog-body">${body}</div>`;
  dialog.setAttribute('aria-labelledby','dialog-title');
  if(!dialog.open)dialog.showModal();
  dialog.scrollTop=0;
}
function showCreate(){
  show(E('create'),form('create','',`<div class="fields">${field('title','title','','required maxlength="140"')}${area('body','body','',true)}${area('solution','solution')}<div class="field-grid">${labelled('type',select('type',translations(['problem','idea','praise']),'problem'))}${labelled('category',select('category',[['',t('choose')],...categories()],'',true))}${labelled('priority',select('priority',translations(['low','medium','high']),'medium'))}</div><label><span>${E('file')} <small>· ${E('optional')}</small></span><input name="attachment" type="file"><small>${E('fileHelp')}</small></label><div class="form-buttons">${action(E('cancel'),'dismiss')}${submit('submit')}</div></div>`));
}
const detail=(label,value)=>`<div><dt>${E(label)}</dt><dd>${value}</dd></div>`;
function showTicket(id){
  const ticket=findTicket(id);
  if(!ticket)return;
  const canManage=handler()&&(lead()||ticket.owner===user.id||ticket.dept===user.dept);
  const files=ticket.files.map(f=>offline?action('↓ '+esc(f.name),'download',f.id,'button secondary'):`<a class="button secondary" href="./api/files/${esc(id)}/${esc(f.id)}">↓ ${esc(f.name)}</a>`).join('');
  const events=[...ticket.events].reverse().map(event=>`<li><strong>${E(event.status||event.kind)}</strong><small>${esc(ownerName(event.by))} · ${date(event.at)}${event.owner?' · '+esc(ownerName(event.owner)):''}</small>${event.text?`<p>${esc(event.text)}</p>`:''}</li>`).join('');
  const manage=canManage?`<section class="detail-section"><h3>${E('manage')}</h3>${form('update',id,`<div class="fields"><div class="field-grid">${labelled('status',select('status',translations(statusOptions),ticket.status))}${labelled('owner',select('owner',owners(),ticket.owner))}</div>${area('note','note')}<small>${E('noteHint')}</small>${area('result','result',ticket.result)}<div>${submit('save')}</div></div>`)}
    ${lead()?form('link',id,`<div class="inline-form">${labelled('problemLink',select('problem',[['',t('noLink')],...data.problems.map(p=>[p.id,l(p.title)])],ticket.problem))}${submit('save','button secondary')}</div>`):''}</section>`:'';
  show(e(ticket.title),`<div class="ticket-meta"><span class="ticket-id">${esc(id)} · ${E(ticket.type)}</span>${statusBadge(ticket.status)}${isLate(ticket)?`<span class="badge rejected">${E('late')}</span>`:''}</div>
    <dl class="details">${detail('category',e(category(ticket.category)))}${detail('dept',E(ticket.dept))}${detail('author',esc(ownerName(ticket.author)))}${detail('owner',esc(ownerName(ticket.owner)))}${detail('priority',E(ticket.priority))}${detail('created',date(ticket.created))}${detail('due',date(ticket.due))}${detail('response',ticket.first?date(ticket.first):E('firstPending'))}</dl>
    <section class="detail-section"><h3>${E('body')}</h3><p class="preserve">${e(ticket.body)}</p>${ticket.sourceLanguage==='ru'&&lang!=='ru'?'<small>'+E('sample')+' · RU</small>':''}${ticket.solution?`<h4>${E('solution')}</h4><p class="preserve">${e(ticket.solution)}</p>`:''}${files}</section>
    <section class="decision"><h3>${E('result')}</h3><p class="preserve">${ticket.result?esc(ticket.result):E('noResult')}</p></section>${manage}
    <section class="detail-section"><h3>${E('history')}</h3><ol class="timeline">${events}</ol>${!isClosed(ticket.status)?form('comment',id,`<div class="fields">${area('text','comment','',true)}<div>${submit('send','button secondary')}</div></div>`):''}</section>`,id);
}
function showProblem(id){
  const p=findProblem(id);
  const linked=data.tickets.filter(ticket=>ticket.problem===id);
  const available=data.tickets.filter(ticket=>ticket.problem!==id).map(ticket=>[ticket.id,ticket.id+' · '+l(ticket.title)]);
  const linkedUI=p?`<section class="detail-section"><h3>${E('links')} · ${linked.length}</h3><div class="related">${linked.map(ticket=>action(esc(ticket.id)+' · '+e(ticket.title),'ticket',ticket.id,'button secondary')).join('')}</div>
    ${available.length?form('linkFrom',id,`<div class="inline-form">${labelled('linkOne',select('ticket',available))}${submit('save','button secondary')}</div>`):''}</section>
    <section class="detail-section"><h3>${E('publish')}</h3><p class="muted">${E('publishHint')}</p>${form('publish',id,`<div class="fields">${area('text','result','',true)}<div>${submit('publish','button secondary')}</div></div>`)}</section>`:'';
  show(p?esc(id)+' · '+e(p.title):E('problemNew'),`${form('problem',id,`<div class="fields">
    ${field('title','title',p?.title,'required maxlength="140"')}${area('description','body',p?.description,true)}
    <div class="field-grid">${labelled('stage',select('stage',translations(problemStages),p?.stage||'analysis'))}${labelled('owner',select('owner',owners(),p?.owner||'lead'))}${field('due','checkDate',p?.due,'type="date"')}</div>
    ${area('plan','plan',p?.plan)}${field('metric','metric',p?.metric)}
    <div class="field-grid">${field('baseline','baseline',p?.baseline)}${field('target','target',p?.target)}${field('actual','actual',p?.actual)}</div>
    ${area('result','evidence',p?.result)}<div>${submit('save')}</div></div>`)}${linkedUI}`,id);
}
function showRoute(id){
  const c=data.categories.find(c=>c.id===id);
  const labels=c?'':[['ru','Русский'],['kk','Қазақша'],['en','English']].map(([key,label])=>`<label><span>${label}</span><input name="${key}" required maxlength="85"></label>`).join('');
  show(c?e(c.label):E('addCategory'),form('route',id,`<div class="fields">${labels}${labelled('owner',select('owner',owners(),c?.owner))}${field('hours','hours',c?.hours??72,'type="number" min="1" max="168" required')}<div>${submit('save')}</div></div>`),id);
}
function downloadFile(fileId){
  const ticket=localData.tickets.find(t=>t.id===dialog.dataset.id);
  const file=ticket?.files.find(f=>f.id===fileId);
  if(!file)return;
  const bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=file.name;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function attachment(file){
  if(!file?.size)return Promise.resolve([]);
  if(file.size>2*1024*1024)return Promise.reject(new Error('fileSize'));
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve([{name:file.name,data:String(reader.result).split(',')[1]}]);
    reader.onerror=()=>reject(new Error('server'));
    reader.readAsDataURL(file);
  });
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-cmd]');
  if(!button||busy)return;
  const {cmd,id}=button.dataset;
  if(cmd==='nav')go(id);
  if(cmd==='quick'){filters.quick=id==='all'?'':id;render();document.querySelector('.chip.selected')?.focus();}
  if(cmd==='clear'){filters={};render();document.querySelector('[data-filter="search"]')?.focus();}
  if(cmd==='create')showCreate();
  if(cmd==='ticket')showTicket(id);
  if(cmd==='problem')showProblem(id);
  if(cmd==='route')showRoute(id);
  if(cmd==='dismiss')dialog.close();
  if(cmd==='download')downloadFile(id);
  if(cmd==='logout'){try{await api('logout',{});user=null;data=null;render();}catch{toast('server',true);}}
});
document.addEventListener('input',event=>{
  if(!event.target.matches('[data-filter]'))return;
  filters.search=event.target.value;document.querySelector('#results').innerHTML=results();
});
document.addEventListener('change',async event=>{
  const el=event.target;
  if(el.dataset.change==='language'){lang=el.value;write('pulse-lang',lang);render();document.querySelector('[data-change="language"]')?.focus();return;}
  if(el.dataset.change==='account'){
    if(busy)return;
    busy=true;el.disabled=true;
    try{await changeAccount(el.value);}catch(error){toast(error.message,true);render();}
    finally{busy=false;}
    return;
  }
  if(el.closest('.filters')){filters[el.name]=el.value;document.querySelector('#results').innerHTML=results();}
});
document.addEventListener('submit',async event=>{
  const formEl=event.target,op=formEl.dataset.op;
  if(!op)return;
  event.preventDefault();
  if(busy)return;
  busy=true;
  const submitter=event.submitter;
  if(submitter)submitter.disabled=true;
  try{
    const formData=Object.fromEntries(new FormData(formEl));
    if(op==='login'){await changeAccount(formData.account,formData.password);return;}
    let input={...formData,op,id:formEl.dataset.id};
    if(op==='create'){input.files=await attachment(input.attachment);delete input.attachment;}
    if(op==='route'&&!input.id)input.label=[input.ru,input.kk,input.en];
    if(op==='linkFrom')input={op:'link',id:input.ticket,problem:input.id};
    let id;
    if(offline){
      const next=structuredClone(localData);
      id=mutate(next,user,input);
      write(storeKey,next);localData=next;data=viewState(localData,user);
    }else{
      const out=await api('action',input);
      id=out.id;data=out.state;
    }
    if(op==='create'){page='mine';filters={};}
    render();
    if(['create','comment','update','link'].includes(op))showTicket(id);
    if(['problem','publish','linkFrom'].includes(op))showProblem(op==='linkFrom'?formEl.dataset.id:id);
    if(op==='route')dialog.close();
    toast(op==='create'?'registered':'saved');
  }catch(error){
    const previous=formEl.querySelector('.dialog-error');
    previous?.remove();
    const warning=document.createElement('p');
    warning.className='dialog-error';warning.setAttribute('role','alert');
    warning.textContent=t(error.message==='QuotaExceededError'?'fileSize':error.message);
    formEl.append(warning);warning.scrollIntoView({block:'nearest'});
    toast(error.message,true);
  }
  finally{busy=false;if(submitter)submitter.disabled=false;}
});

async function start(){
  try{
    const response=await fetch('./api/config');
    if(response.headers.get('Content-Type')?.includes('application/json')&&response.ok){
      const config=await response.json();
      demo=config.demo;user=config.user;
      if(user)data=await api('state');
      else if(demo){await changeAccount('lead');return;}
      render();return;
    }else if(response.headers.get('Content-Type')?.includes('application/json')){
      throw new Error('server');
    }
  }catch{
    root.textContent=t('server');
    return;
  }
  offline=true;demo=true;
  localData=read(storeKey,initialState());
  const account=read('pulse-account','lead');
  await changeAccount(staff.some(s=>s.id===account)?account:'lead');
}
start().catch(()=>toast('server',true));
