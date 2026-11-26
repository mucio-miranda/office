import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { codexExecutable } from './codex.ts';

test('produção de mídia pela interface GPT, com arquivos de sessões distintas', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-midia-'));
  const [client, temp, imports, drive] = await Promise.all(['cliente','temporarios','importados','drive'].map(async n => { const p = path.join(dir,n); await mkdir(p); return p; }));
  let aceitarRender = true;
  const server = createServer((req, res) => { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ ok: req.url !== '/api/agente/render_pegar' || aceitarRender })); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw Error('Porta indisponível');
  const agent = process.env.OFFICE_TEST_MEDIA_TOOLS || fileURLToPath(new URL('./codex-tools.mjs', import.meta.url));
  const cli = fileURLToPath(new URL('../../../../packages/video-engine/src/cli.ts',import.meta.url));
  const exe = codexExecutable();
  const child = spawn(process.execPath,[agent,client,dir,temp,drive,...(process.env.OFFICE_TEST_MEDIA_TOOLS ? [path.join(path.dirname(agent),'office-render.mjs')] : ['--import',import.meta.resolve('tsx'),cli])],{ env:{ ...process.env, OFFICE_CODEX_EXE: exe ?? '', OFFICE_IMPORT_DIR:imports, OFFICE_API:'http://127.0.0.1:'+addr.port }, windowsHide:true });
  const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
  let id = 0;
  async function call(name: string, args: object, ok = true) {
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name, arguments:args}})+'\n');
    const { value } = await lines.next();
    assert.ok(value, 'A ferramenta encerrou antes de responder');
    const result = JSON.parse(value).result;
    assert.equal(!result.isError, ok, JSON.stringify(result).slice(0,1400));
    return result.content;
  }
  try {
    await t.test('cópia em segundo plano confirma a pasta completa e a versão selecionada', async () => {
      await mkdir(path.join(imports,'anterior'));
      await writeFile(path.join(imports,'anterior','v9.mp4'),'versão selecionada');
      const [started] = await call('copiar_para_local',{de:'importados',caminho:'anterior',em_segundo_plano:true});
      const op = JSON.parse(started.text);
      for (let n = 0; n < 80; n++) {
        const result = await call('consultar_operacao',{id:op.id});
        if (JSON.parse(result[0].text).estado === 'concluída') {
          const copy = JSON.parse(result[1].text);
          assert.equal(copy.absoluto,await realpath(path.join(temp,copy.relativo)));
          assert.equal(await readFile(path.join(copy.absoluto,'v9.mp4'),'utf8'),'versão selecionada'); return;
        }
        await new Promise(r => setTimeout(r,50));
      }
      assert.fail('Cópia não terminou');
    });
    await t.test('cancelar um render na fila impede a entrega', async () => {
      aceitarRender = false;
      try {
        await writeFile(path.join(client,'dummy.mp4'),'aguardando a vez');
        await writeFile(path.join(client,'fila.json'),JSON.stringify({video:[{id:'v',src:'dummy.mp4',out:1}]}));
        const [start] = await call('renderizar_video',{pasta:'cliente',timeline:'fila.json',saida:'cancelado.mp4',em_segundo_plano:true});
        const id = JSON.parse(start.text).id;
        await call('cancelar_operacao',{id});
        for (let n = 0; n < 70; n++) {
          const [status] = await call('consultar_operacao',{id});
          if (JSON.parse(status.text).estado === 'cancelada') {
            await assert.rejects(readFile(path.join(client,'cancelado.mp4')), {code:'ENOENT'}); return;
          }
          await new Promise(r=>setTimeout(r,50));
        }
        assert.fail('Cancelamento não terminou');
      } finally { aceitarRender = true; }
    });
    const media = !spawnSync('ffmpeg',['-version'],{windowsHide:true}).error;
    await t.test('capa em PNG e JPG tem os pixels do recurso local e as dimensões pedidas', async () => {
      await writeFile(path.join(client,'foto local.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="250" height="150"><rect width="250" height="150" fill="red"/></svg>');
      await writeFile(path.join(client,'layout.html'),'<style>*{margin:0}</style><img src="'+pathToFileURL(path.join(client,'foto local.svg')).href+'">');
      for (const ext of ['png','jpg']) {
        const [result,preview] = await call('exportar_composicao',{pasta:'cliente',html:'layout.html',saida:'capa.'+ext,largura:240,altura:128});
        assert.equal(preview.type,'image'); assert.equal(preview.mimeType,'image/jpeg');
        const file = JSON.parse(result.text).absoluto;
        const data = await readFile(file); assert.ok(data.length > 100);
        if (ext === 'png') assert.deepEqual([data.readUInt32BE(16),data.readUInt32BE(20)],[240,128]);
        if (media) {
          const pixel = execFileSync('ffmpeg',['-v','error','-i',file,'-vf','scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
          assert.ok(pixel[0] > 240 && pixel[1] < 20 && pixel[2] < 20, 'A capa precisa conter a foto vermelha');
        }
      }
      if (media) {
        const preview = await call('prever_foto',{pasta:'cliente',arquivo:'capa.jpg'});
        assert.equal(preview[1].mimeType,'image/jpeg');
      }
      const [check] = await call('conferir_anexos',{pasta:'cliente',arquivos:['capa.jpg','capa.png']});
      assert.equal(JSON.parse(check.text).arquivos.length,2);
      await call('conferir_anexos',{pasta:'cliente',arquivos:['ausente.mp4']},false);
    });
    await t.test('distingue ausência de faixa, faixa silenciosa e áudio audível', {skip: !media}, async () => {
      for (const [name,source] of [['sem',''],['silencio','anullsrc'],['fala','sine=frequency=720']]) {
        const file = path.join(drive,name+'.mp4');
        execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=red:s=64x64:r=12',...(source ? ['-f','lavfi','-i',source,'-c:a','aac'] : ['-an']),'-t','1','-c:v','libx264',file],{windowsHide:true});
        const [result] = await call('conferir_audio',{pasta:'drive',arquivo:name+'.mp4'});
        const audio = JSON.parse(result.text);
        assert.equal(audio.faixas,source ? 1 : 0); assert.equal(audio.muda,name !== 'fala');
        if (name === 'fala') assert.ok(Number.isFinite(audio.medicao[0].lufs));
      }
    });
    await t.test('render sem keepAudio preserva o som e entrega sua medição', {skip: !exe || !media || !process.env.OFFICE_TEST_MEDIA_RENDER}, async () => {
      const video = [{id:'v',src:'fala.mp4',out:1}];
      await writeFile(path.join(drive,'timeline.json'),JSON.stringify({width:64,height:64,video}));
      const [result] = await call('renderizar_video',{pasta:'drive',timeline:'timeline.json',saida:'final.mp4'});
      assert.equal(JSON.parse(result.text)[0].muda,false);
      await writeFile(path.join(drive,'mix.json'),JSON.stringify({video,audio:[{id:'trilha',src:'fala.mp4'}]}));
      const [error] = await call('renderizar_video',{pasta:'drive',timeline:'mix.json',saida:'erro.mp4'},false);
      assert.match(error.text,/keepAudio/);
      await writeFile(path.join(drive,'mix.json'),JSON.stringify({width:64,height:64,video:[{...video[0],keepAudio:false}],audio:[{id:'musica',src:'fala.mp4',ganhoDb:-6}]}));
      const [mix] = await call('renderizar_video',{pasta:'drive',timeline:'mix.json',saida:'mix.mp4'});
      const dry = JSON.parse(result.text)[0].medicao[0].lufs;
      const quieter = JSON.parse(mix.text)[0].medicao[0].lufs;
      assert.ok(Math.abs(dry - quieter - 6) < 1, 'O ganho precisa reduzir só a faixa em 6 dB');
    });
  } finally {
    child.stdin.end(); await once(child,'close'); server.close();
    await rm(dir,{recursive:true, force:true});
  }
});
