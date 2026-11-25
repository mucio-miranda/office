import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import Fastify from 'fastify';

test('produção GPT usa skill, aguarda aprovação e retoma o mesmo trabalho sem trocar a conversa Claude', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-producao-gpt-'));
  process.env.OFFICE_DATA = path.join(dir, 'db');
  const root = path.join(dir, 'escritorio');
  const folder = path.join(root, 'CLIENTES', 'FICTICIO');
  const skill = path.join(root, '.claude', 'skills', 'arte-teste');
  mkdirSync(skill, { recursive: true });
  mkdirSync(folder, { recursive: true });
  const original = '---\nname: arte-teste\ndescription: Gera peça de teste\n---\nSempre execute arte-teste/gerar.py na pasta cliente usando executar_skill. O script é a produção da peça. Após a primeira rodada peça aprovação com [[AGUARDANDO_APROVACAO]]. Depois de aprovado crie recibo.txt na pasta cliente pela ferramenta gravar_arquivo, conteúdo: APROVADO.';
  writeFileSync(path.join(skill, 'SKILL.md'), original);
  writeFileSync(path.join(skill, 'gerar.py'), "from pathlib import Path\nPath('arte.svg').write_text('<svg xmlns=\x22http://www.w3.org/2000/svg\x22/>')\nprint(Path('arte.svg').resolve())");
  const live = process.env.OFFICE_TEST_CODEX_LIVE === '1';
  const tid = '01234567-1234-4567-8567-0123456789ab';
  if (!live) {
    const fake = path.join(dir,'gpt.mjs');
    writeFileSync(fake, `import {writeFileSync} from 'node:fs';
      let p='';for await(const chunk of process.stdin)p+=chunk;
      const resume=process.argv.includes('resume');
      if(!process.argv.some(x=>x.startsWith('mcp_servers.producao=')) || (!resume && !p.includes('arte-teste/gerar.py')) || (resume && !process.argv.includes('${tid}')))process.exit(2);
      writeFileSync(resume ? ${JSON.stringify(path.join(folder,'recibo.txt'))} : ${JSON.stringify(path.join(folder,'arte.svg'))},resume?'APROVADO':'<svg/>');
      for(const e of [{type:'thread.started',thread_id:'${tid}'},{type:'item.completed',item:{type:'agent_message',text:resume?'Recibo entregue':'Aprova a arte? [[AGUARDANDO_APROVACAO]]'}},{type:'turn.completed'}])console.log(JSON.stringify(e));`);
    process.env.OFFICE_CODEX_BIN=fake;
  }
  const server = Fastify();
  const { api, createOffice } = await import('./api.ts');
  const { db, insert, now } = await import('../db.ts');
  const { createSession } = await import('../auth.ts');
  const { ensureTitular } = await import('../agents/workers.ts');
  try {
    await server.register(api);
    await server.listen({port:0,host:'127.0.0.1'});
    const addr = server.server.address();
    if (!addr || typeof addr === 'string') throw Error('Porta do teste indisponível.');
    const { config } = await import('../config.ts');
    config.port = addr.port;
    insert('users',{id:'u',name:'Equipe',color:'red',createdAt:now()});
    const o=createOffice('Fictício',root,[],'u');
    insert('clients',{id:'c',officeId:o.id,name:'Cliente',folder,color:'red',sessionId:'claude-existente'});
    const token=createSession('u');
    const base='/api/offices/'+o.id+'/clients/c';
    const call=(url:string,payload?:object)=>server.inject({url:base+url,method:payload?'POST':'GET',payload,headers:{host:'localhost',authorization:'Bearer '+token}});
    const w=(await call('/conversa/nova',{provider:'codex',title:'Arte'})).json();
    assert.equal(w.provider,'codex');
    const upload = (session: string) => server.inject({ method: 'POST', url: '/api/offices/'+o.id+'/anexos?nome=v9.mp4&sessao='+session,
      headers: { authorization: 'Bearer '+token, 'content-type': 'application/octet-stream' }, payload: Buffer.from('v9') });
    const attachment = await upload(w.id);
    assert.equal(attachment.statusCode,200,attachment.body);
    assert.equal(attachment.json().path,path.join(dir,'db','importacoes',w.id,attachment.json().relativo));
    assert.equal(readFileSync(attachment.json().path,'utf8'),'v9');
    assert.equal((await upload('outra-sessao')).statusCode,404);
    assert.equal(ensureTitular(o.id,'c','u').provider,'claude');
    async function waitFor(status:string) {
      const deadline=Date.now()+(live?200000:12000);
      while(Date.now()<deadline) {
        const job=db.prepare('SELECT status,session_id FROM jobs WHERE worker_id=? ORDER BY created_at DESC LIMIT 1').get(w.id);
        if(job?.status===status)return job;
        if(job?.status==='erro') break;
        await new Promise(r=>setTimeout(r,150));
      }
      throw Error('Esperava '+status+'; chat: '+JSON.stringify(db.prepare('SELECT role,text FROM job_messages ORDER BY created_at DESC LIMIT 4').all()));
    }
    const sent=await call('/conversa',{text:'/arte-teste Execute o script original da skill e gere a arte na pasta cliente agora. Pare na aprovação da arte.',workerId:w.id});
    assert.equal(sent.statusCode,200,sent.body);
    const first=await waitFor('aguardando');
    assert.match(readFileSync(path.join(folder,'arte.svg'),'utf8'),/<svg/);
    assert.ok(!existsSync(path.join(folder,'recibo.txt')));
    const reply=await call('/conversa',{text:'Arte aprovada. Finalize gravando recibo.txt com APROVADO conforme combinado. Depois encerre a demanda e informe o caminho completo.',workerId:w.id});
    assert.equal(reply.statusCode,200,reply.body);
    const last=await waitFor('concluido');
    assert.equal(first.session_id,last.session_id);
    assert.match(readFileSync(path.join(folder,'recibo.txt'),'utf8'),/APROVADO/);
    assert.equal(readFileSync(path.join(skill,'SKILL.md'),'utf8'),original);
    assert.equal(db.prepare('SELECT session_id FROM clients WHERE id=?').get('c')?.session_id,'claude-existente');
    assert.ok((await call('/sessoes')).json().some((s:{id:string})=>s.id===last.session_id));
  } finally { await server.close(); db.close(); rmSync(dir,{recursive:true,force:true}); }
});
