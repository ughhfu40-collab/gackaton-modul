import {createServer} from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {staff,initialState,viewState,mutate,canRead,DomainError} from './dist/model.js';

const root=fileURLToPath(new URL('./dist/',import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));};
async function readJson(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>3000000)throw new DomainError('fileSize',413);
    chunks.push(chunk);
  }
  try{const data=JSON.parse(Buffer.concat(chunks));if(data&&typeof data==='object'&&!Array.isArray(data))return data;}catch{}
  throw new DomainError('invalid');
}
export async function makeServer({dbPath='data/pulse.db',demo=true,password='pulse-demo',secure=false}={}){
  if(dbPath!==':memory:')await mkdir(resolve(dbPath,'..'),{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO workspace VALUES (1,?)').run(JSON.stringify(initialState()));
  const load=()=>JSON.parse(db.prepare('SELECT data FROM workspace WHERE id=1').get().data);
  const tokenOf=req=>req.headers.cookie?.match(/(?:^|;\s*)pulse=([a-f0-9]{64})(?:;|$)/)?.[1];
  const cookie=(token,age)=>`pulse=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
  const server=createServer(async(req,res)=>{
    try{
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){
        if(req.method==='POST'&&(req.headers['sec-fetch-site']==='cross-site'||!req.headers['content-type']?.startsWith('application/json')))throw new DomainError('forbidden',403);
        const token=tokenOf(req);
        const session=token&&db.prepare('SELECT account FROM sessions WHERE token=? AND expires>?').get(digest(token),Date.now());
        const user=session&&staff.find(member=>member.id===session.account);
        if(url.pathname==='/api/config'&&req.method==='GET')return json(res,200,{demo,quickSwitch:demo&&password==='pulse-demo',user:user||null});
        if(url.pathname==='/api/login'&&req.method==='POST'){
          const data=await readJson(req);
          const account=staff.find(member=>member.id===data.account);
          const expected=typeof password==='object'&&password!==null&&Object.hasOwn(password,data.account)?password[data.account]:typeof password==='string'?password:'';
          const supplied=typeof data.password==='string'?data.password:'';
          if(!account||typeof expected!=='string'||!expected||(!demo&&expected.length<12)||!timingSafeEqual(Buffer.from(digest(supplied)),Buffer.from(digest(expected))))throw new DomainError('badLogin',401);
          const secret=randomBytes(32).toString('hex');
          db.prepare('DELETE FROM sessions WHERE expires<=? OR token=?').run(Date.now(),token?digest(token):'');
          db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(secret),account.id,Date.now()+8*3600000);
          return json(res,200,{user:account},{'Set-Cookie':cookie(secret,28800)});
        }
        if(!user)throw new DomainError('login',401);
        if(url.pathname==='/api/logout'&&req.method==='POST'){
          db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
          return json(res,200,{}, {'Set-Cookie':cookie('',0)});
        }
        if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,viewState(load(),user));
        if(url.pathname==='/api/action'&&req.method==='POST'){
          const input=await readJson(req);
          db.exec('BEGIN IMMEDIATE');
          let id,state;
          try{
            state=load();
            id=mutate(state,user,input);
            db.prepare('UPDATE workspace SET data=? WHERE id=1').run(JSON.stringify(state));
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          return json(res,200,{id,state:viewState(state,user)});
        }
        const match=url.pathname.match(/^\/api\/files\/(A-\d+)\/(\d+)$/);
        if(req.method==='GET'&&match){
          const t=load().tickets.find(t=>t.id===match[1]);
          const f=t&&canRead(user,t)&&t.files.find(f=>f.id===match[2]);
          if(!f)throw new DomainError('missing',404);
          const filename=encodeURIComponent(f.name.toWellFormed()).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${filename}`,'Cache-Control':'no-store'});
          return res.end(Buffer.from(f.data,'base64'));
        }
        throw new DomainError('missing',404);
      }
      if(!['GET','HEAD'].includes(req.method))throw new DomainError('missing',404);
      const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!/^[a-z][a-z0-9.-]+$/.test(path)||!MIME[extname(path)])throw new DomainError('missing',404);
      let content;
      try{content=await readFile(resolve(root,path));}catch{throw new DomainError('missing',404);}
      res.writeHead(200,{'Content-Type':MIME[extname(path)],'Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:content);
    }catch(error){
      if(!(error instanceof DomainError))console.error(error);
      if(!res.headersSent)json(res,error.status||500,{error:error instanceof DomainError?error.message:'server'});
      else res.end();
    }
  });
  server.once('close',()=>db.close());
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const demo=process.env.PULSE_DEMO!=='0';
  const password=demo?(process.env.PULSE_DEMO_PASSWORD||'pulse-demo'):JSON.parse(process.env.PULSE_ACCOUNTS_JSON||'{}');
  if(!demo&&!staff.some(member=>typeof password[member.id]==='string'&&password[member.id].length>=12))throw new Error('Set PULSE_ACCOUNTS_JSON with per-account passwords.');
  const server=await makeServer({demo,password,dbPath:process.env.PULSE_DB_PATH||'data/pulse.db',secure:process.env.PULSE_SECURE_COOKIE==='1'});
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  server.listen(port,host,()=>console.log(`Modus Pulse • http://${host}:${port}`));
}
