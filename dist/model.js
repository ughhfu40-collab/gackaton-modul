import {sourceCategories,sourceTickets} from './seed.js';

export const departments=['sales','proc','design','finance','office','it'];
export const staff=[
  {id:'sales',role:'employee',dept:'sales'},
  {id:'proc',role:'employee',dept:'proc'},
  {id:'design',role:'employee',dept:'design'},
  {id:'finance',role:'employee',dept:'finance'},
  {id:'office',role:'employee',dept:'office'},
  {id:'lead',role:'coordinator',dept:'office'},
  ...['design','finance','office','it'].map(dept=>({id:dept==='it'?'it':dept+'-lead',role:'manager',dept})),
  {id:'admin',role:'admin',dept:'office'}
];
const findStaff=id=>staff.find(user=>user.id===id);
const routeOwner=id=>['design','finance','office'].includes(id)?id+'-lead':id;
export const isClosed=status=>['done','rejected','closed'].includes(status);
export const isLate=(ticket,now=Date.now())=>!isClosed(ticket.status)&&!ticket.first&&Date.parse(ticket.due)<now;
export const missedDeadline=ticket=>Boolean(ticket.first)&&Date.parse(ticket.first)>Date.parse(ticket.due);
export const statusOptions=['new','review','work','waiting','done','rejected','closed'];
export const problemStages=['analysis','pilot','verified'];
export function initialState(clock=Date.now()) {
  const date=hours=>new Date(clock+hours*3600000).toISOString();
  const categories=sourceCategories.map(c=>({...c,owner:routeOwner(c.owner)}));
  const tickets=sourceTickets.map((s,i)=>{
    const created=date(-17-i*6);
    const terminal=isClosed(s.status);
    const first=s.status==='new'?null:date(-9-i*6);
    const owner=categories.find(c=>c.id===s.category).owner;
    return {...s,author:s.dept,owner,created,due:date(-17-i*6+(s.priority==='high'?24:72)),first,
      result:terminal?s.action:'',solution:'',problem:'',files:[],
      events:[{kind:'registered',at:created,by:s.dept},...(first?[{kind:'status',status:s.status,at:first,by:owner,text:s.status==='waiting'?s.action:''}]:[])]};
  });
  const master=tickets.find(t=>t.id==='A-011');
  tickets.push(
    {...master,id:'A-021',dept:'proc',author:'proc',title:['Закупки ждут ответа по срочным поставкам','Сатып алу тобы шұғыл жеткізілім бойынша жауап күтеді','Procurement is waiting on urgent shipments'],body:['По срочным поставкам смежная команда редко сообщает, когда вернётся с ответом.','Шұғыл жеткізілімдер бойынша көршілес бөлім жауап мерзімін сирек хабарлайды.','For urgent shipments, the other team rarely shares an estimated reply time.'],events:[{kind:'registered',at:master.created,by:'proc'}],status:'review',problem:'P-001'},
    {...master,id:'A-022',dept:'design',author:'design',title:['Проектирование не видит срок ответа','Жобалау тобы жауап мерзімін көрмейді','Design cannot see the response deadline'],body:['Без срока ответа сложно планировать выпуск срочных спецификаций.','Жауап мерзімін білмей, шұғыл ерекшеліктерді шығару қиын.','Without an ETA it is hard to plan urgent specification releases.'],events:[{kind:'registered',at:master.created,by:'design'}],status:'review',problem:'P-001'}
  );
  return {categories,tickets,problems:[{id:'P-001',title:['Срок ответа между отделами','Бөлімдер арасындағы жауап мерзімі','Cross-team response times'],
    description:['По срочным запросам смежные отделы не всегда сообщают ожидаемое время ответа.','Шұғыл сұраулар бойынша бөлімдер жауаптың күтілетін уақытын әрдайым хабарламайды.','Teams do not always give an ETA for urgent requests.'],
    stage:'analysis',owner:'lead',due:'',plan:'',metric:'',baseline:'',target:'',actual:'',result:'',created:date(-12)}]};
}

export function canRead(user,t) {
  return user.role==='coordinator'||t.author===user.id||
    (user.role==='manager'&&(t.owner===user.id||t.dept===user.dept));
}
function canManage(user,t) {
  return user.role==='coordinator'||(user.role==='manager'&&canRead(user,t));
}
export function viewState(state,user){
  const tickets=state.tickets.filter(t=>canRead(user,t)).map(t=>{
    const {originalOwner,action,...safe}=t;
    return {...safe,sourceLanguage:originalOwner?'ru':null,problem:user.role==='employee'?'':safe.problem,files:safe.files.map(({data,...meta})=>meta)};
  });
  return {categories:state.categories,tickets,problems:user.role==='coordinator'?state.problems:[],staff};
}

export class DomainError extends Error {
  constructor(code,status=400){super(code);this.status=status;}
}
function requireThat(condition,code='invalid',status=400){
  if(!condition)throw new DomainError(code,status);
}
const clean=(value,limit=4000)=>typeof value==='string'?value.trim().slice(0,limit):'';
const nextId=(rows,prefix)=>prefix+String(1+Math.max(0,...rows.map(row=>Number(row.id.slice(2))))).padStart(3,'0');
const validOwner=id=>id===''||['manager','coordinator'].includes(findStaff(id)?.role);
const validDate=value=>{
  if(!value)return true;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};

function editLocalizedText(previous,next,language){
  if(!Array.isArray(previous))return next;
  const index=['ru','kk','en'].indexOf(language);
  if(index<0)return next;
  return previous.map((text,i)=>i===index?next:text);
}

export function mutate(state,user,input,clock=Date.now()){
  const now=new Date(clock).toISOString();
  const category=id=>state.categories.find(c=>c.id===id);
  const ticket=()=>state.tickets.find(t=>t.id===input.id);
  const addEvent=(t,kind,extra={})=>t.events.push({kind,by:user.id,at:now,...extra});
  const firstReply=t=>{if(!t.first)t.first=now;};
  const needTicket=()=>{
    const t=ticket();
    requireThat(t&&canRead(user,t),'missing',404);
    return t;
  };
  if(input.op==='create'){
    requireThat(user.role!=='admin','forbidden',403);
    const title=clean(input.title,140),body=clean(input.body);
    const rule=category(input.category);
    requireThat(title&&body&&rule&&['problem','idea','praise'].includes(input.type)&&['high','medium','low'].includes(input.priority));
    const files=input.files??[];
    requireThat(Array.isArray(files)&&files.length<=1&&files.every(f=>f&&typeof f.data==='string'&&f.data.length%4===0&&f.data.length<=2796204&&f.data.length*3/4-(f.data.endsWith('==')?2:f.data.endsWith('=')?1:0)<=2097152&&/^[a-zA-Z0-9+/]+={0,2}$/.test(f.data)&&clean(f.name,150)));
    const id=nextId(state.tickets,'A-');
    const t={id,title,body,solution:clean(input.solution),category:rule.id,type:input.type,priority:input.priority,
      dept:user.dept,author:user.id,owner:rule.owner,status:'new',created:now,
      due:new Date(clock+Math.min(rule.hours,input.priority==='high'?24:168)*3600000).toISOString(),
      first:null,result:'',problem:'',events:[],files:files.map(f=>({id:'1',name:clean(f.name,150),data:f.data}))};
    addEvent(t,'registered');
    state.tickets.unshift(t);
    return id;
  }
  if(input.op==='comment'){
    const t=needTicket(),text=clean(input.text);
    requireThat(text&&!isClosed(t.status));
    addEvent(t,'comment',{text});
    if(canManage(user,t)&&t.author!==user.id)firstReply(t);
    else if(t.status==='waiting'){t.status='review';addEvent(t,'status',{status:'review'});}
    return t.id;
  }
  if(input.op==='update'){
    const t=needTicket();
    requireThat(canManage(user,t),'forbidden',403);
    const status=input.status,owner=input.owner??t.owner,result=input.result===undefined?t.result:clean(input.result),note=clean(input.note);
    requireThat(statusOptions.includes(status)&&validOwner(owner));
    requireThat(!isClosed(status)||result,'needResult');
    requireThat(status!=='waiting'||note||t.status==='waiting','needNote');
        if(owner!==t.owner){t.owner=owner;addEvent(t,'assigned',{owner});}
    if(status!==t.status||note){t.status=status;addEvent(t,'status',{status,text:note});}
    const resultChanged=result!==t.result;
    if(resultChanged){t.result=result;if(result)addEvent(t,'decision',{text:result});}
    if(t.author!==user.id&&(note||(result&&resultChanged)))firstReply(t);
    return t.id;
  }
  if(input.op==='route'){
    requireThat(user.role==='admin','forbidden',403);
    const hours=Number(input.hours),owner=input.owner;
    requireThat(Number.isInteger(hours)&&hours>=1&&hours<=168&&validOwner(owner));
    const rule=category(input.id);
    if(rule){Object.assign(rule,{hours,owner});return rule.id;}
    const label=Array.isArray(input.label)?input.label.map(v=>clean(v,85)):[];
    requireThat(label.length===3&&label.every(Boolean));
    const id='c'+String(1+Math.max(...state.categories.map(c=>Number(c.id.slice(1))))).padStart(2,'0');
    state.categories.push({id,label,hours,owner});
    return id;
  }
  requireThat(user.role==='coordinator','forbidden',403);
  if(input.op==='link'){
    const t=needTicket();
    requireThat(!input.problem||state.problems.some(p=>p.id===input.problem));
    if(t.problem!==input.problem){t.problem=input.problem||'';addEvent(t,'linked');}
    return t.id;
  }
  if(input.op==='problem'){
    const current=state.problems.find(p=>p.id===input.id);
    requireThat(!input.id||current,'missing',404);
    const title=clean(input.title,140),description=clean(input.description),owner=input.owner;
    const stage=input.stage,due=clean(input.due,10);
    const fields=Object.fromEntries(['plan','metric','baseline','target','actual','result'].map(key=>[key,clean(input[key])]));
    requireThat(title&&description&&problemStages.includes(stage)&&validOwner(owner)&&validDate(due));
    requireThat(stage==='analysis'||(owner&&due&&fields.plan&&fields.metric&&fields.baseline&&fields.target),'needPilot');
    requireThat(stage!=='verified'||(fields.actual&&fields.result),'needEvidence');
    const values={
      title:editLocalizedText(current?.title,title,input.lang),
      description:editLocalizedText(current?.description,description,input.lang),
      owner,stage,due,...fields
    };
    if(current){Object.assign(current,values);return current.id;}
    const id=nextId(state.problems,'P-');
    state.problems.unshift({id,created:now,...values});
    return id;
  }
  if(input.op==='publish'){
    const p=state.problems.find(p=>p.id===input.id),message=clean(input.text);
    requireThat(p&&message);
    const linked=state.tickets.filter(t=>t.problem===p.id);
    requireThat(linked.length,'needLinks');
    for(const t of linked){addEvent(t,'decision',{text:message});if(!isClosed(t.status)){t.result=message;if(t.author!==user.id)firstReply(t);}}
    return p.id;
  }
  throw new DomainError('invalid');
}
