import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {makeServer} from '../server.mjs';
import {translator,locales} from '../dist/i18n.js';
import {sourceTickets} from '../dist/seed.js';

test('localized seed covers all 20 records',()=>{
  assert.equal(sourceTickets.length,20);
  assert.equal(new Set(sourceTickets.map(x=>x.id)).size,20);
  for(const lang of locales){
    for(const key of ['create','verified','needResult','lead','loginTitle'])assert.notEqual(translator(lang)(key),key);
  }
  for(const x of sourceTickets)assert.ok(x.title.every(Boolean)&&x.body.length>35);
});

test('submission, access control, review, shared problem, pilot and updates',async()=>{
  const server=await makeServer({dbPath:':memory:'});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{
    const url='http://127.0.0.1:'+server.address().port;
    async function req(path,body,cookie){
      const headers={};
      if(cookie)headers.Cookie=cookie;
      if(body!==undefined)headers['Content-Type']='application/json';
      return fetch(url+path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});
    }
    async function login(account){
      const r=await req('/api/login',{account,password:'pulse-demo'});
      assert.equal(r.status,200);
      return r.headers.get('set-cookie').split(';')[0];
    }
    const sales=await login('sales'),other=await login('proc'),lead=await login('lead'),admin=await login('admin'),manager=await login('design-lead');
    async function action(cookie,body,status=200){
      const r=await req('/api/action',body,cookie);
      const result=await r.json();
      assert.equal(r.status,status,JSON.stringify(result).slice(0,200));
      return result;
    }
    const snapshot=async cookie=>(await req('/api/state',undefined,cookie)).json();
    assert.equal((await req('/api/state')).status,401);
    assert.equal((await req('/')).status,200);
    assert.equal((await snapshot(admin)).tickets.length,0);
    assert.ok((await snapshot(manager)).tickets.every(t=>t.owner==='design-lead'||t.dept==='design'));
    const content=Buffer.from('Attachment').toString('base64');
    const created=await action(sales,{op:'create',category:'c11',type:'problem',title:'Urgent request',body:'No reply ETA',priority:'high',files:[{name:'test.txt',data:content}]});
    const id=created.id;
    const createdTicket=created.state.tickets.find(t=>t.id===id);
    assert.equal(createdTicket.owner,'lead');
    assert.equal(Date.parse(createdTicket.due)-Date.parse(createdTicket.created),24*3600000);
    assert.equal(createdTicket.files[0].data,undefined);
    const download='/api/files/'+id+'/1';
    assert.equal(await (await req(download,undefined,sales)).text(),'Attachment');
    assert.equal((await req(download,undefined,other)).status,404);
    await action(other,{op:'comment',id,text:'no access'},404);
    await action(sales,{op:'update',id,status:'work'},403);
    await action(lead,{op:'update',id,revision:1,status:'rejected'},400);
    await action(lead,{op:'update',id,revision:1,status:'waiting'},400);
    await action(lead,{op:'update',id,revision:1,status:'waiting',note:'Which team?'});
    await action(lead,{op:'update',id,revision:1,status:'new',note:'Stale tab'},409);
    assert.equal((await snapshot(lead)).tickets.find(t=>t.id===id).status,'waiting');
    await action(sales,{op:'comment',id,text:'Procurement'});
    const row=(await snapshot(lead)).tickets.find(t=>t.id===id);
    assert.ok(row.first);
    assert.equal(row.status,'review');
    await action(lead,{op:'link',id,problem:'P-001'});
    await action(lead,{op:'publish',id:'P-001',mode:'final',text:'Too early'},409);
    await action(lead,{op:'publish',id:'P-001',mode:'progress',text:'Analysis underway'});
    const progress=(await snapshot(other)).tickets.find(t=>t.id==='A-021');
    assert.equal(progress.first,null);
    assert.equal(progress.result,'');
    assert.equal(progress.events.at(-1).kind,'progressUpdate');
    const pilot={op:'problem',id:'P-001',title:'Response times',description:'Delays across teams',stage:'pilot',due:'2026-12-01',owner:'lead',plan:'Reply with an ETA',metric:'On-time replies',baseline:'40%',target:'80%'};
    await action(lead,pilot);
    await action(lead,{...pilot,stage:'verified'},400);
    await action(lead,{...pilot,stage:'verified',actual:'85%',result:'Pilot met the target'});
    await action(lead,{op:'publish',id:'P-001',mode:'final',text:'Pilot reached 85%'});
    const employeeView=await snapshot(sales);
    assert.equal(employeeView.problems.length,0);
    assert.equal(employeeView.tickets.find(t=>t.id===id).problem,'');
    assert.equal(employeeView.tickets.find(t=>t.id===id).result,'Pilot reached 85%');
    await action(admin,{op:'route',id:'c11',owner:'',hours:12});
    const second=await action(sales,{op:'create',category:'c11',type:'idea',title:'Fallback',body:'Test manual queue',priority:'low'});
    const fallback=second.state.tickets.find(t=>t.id===second.id);
    assert.equal(fallback.owner,'');
    assert.equal(Date.parse(fallback.due)-Date.parse(fallback.created),12*3600000);
    await action(lead,{op:'update',id,revision:(await snapshot(lead)).tickets.find(t=>t.id===id).revision,status:'rejected',result:'Pilot reached 85%'},400);
    await action(lead,{op:'update',id:second.id,revision:fallback.revision,status:'rejected',rejectionReason:'The pilot already covers this proposal'});
    const finished=(await snapshot(sales)).tickets.find(t=>t.id===second.id);
    assert.equal(finished.status,'rejected');
    assert.match(finished.result,/pilot/);
    assert.equal((await req('/api/invite',{dept:'design'},sales)).status,403);
    const invited=await req('/api/invite',{dept:'design'},admin);
    assert.equal(invited.status,201);
    const {code}=await invited.json();
    const details={email:' Jury@Example.com ',displayName:'Jury Employee',password:'a-test-password-123',code,role:'admin',dept:'sales'};
    const registered=await req('/api/register',details);
    assert.equal(registered.status,201);
    const employee=(await registered.json()).user;
    assert.equal(employee.role,'employee');
    assert.equal(employee.dept,'design');
    const registeredCookie=registered.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await snapshot(registeredCookie)).tickets,[]);
    assert.equal((await snapshot(registeredCookie)).profile.displayName,'Jury Employee');
    assert.equal((await snapshot(manager)).profile.displayName,undefined);
    await action(registeredCookie,{op:'profile',id:'lead',displayName:'Updated name'});
    assert.equal((await snapshot(registeredCookie)).profile.displayName,'Updated name');
    assert.equal((await snapshot(lead)).profile.displayName,undefined);
    assert.equal((await req('/api/register',{...details,email:'other@example.com'})).status,400);
    assert.equal((await req('/api/logout',{},registeredCookie)).status,200);
    assert.equal((await req('/api/state',undefined,registeredCookie)).status,401);
    const loginAgain=await req('/api/login',{account:'jury@example.com',password:details.password});
    assert.equal(loginAgain.status,200);
    const nextCookie=loginAgain.headers.get('set-cookie').split(';')[0];
    assert.equal((await snapshot(nextCookie)).profile.displayName,'Updated name');
  }finally{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
