import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { config } from './config.ts';
import './db.ts';
import { api, syncAgentTools } from './routes/api.ts';
import { handleSocket } from './realtime.ts';
import { recoverJobs } from './agents/runtime.ts';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 10 * 1024 * 1024 });

await app.register(websocket);
// o app de desktop usa isto para saber se já existe um Office nesta porta
app.get('/api/health', async () => ({ office: true, version: config.version, dataDir: config.dataDir }));
app.get('/ws', { websocket: true }, (socket) => handleSocket(socket));
await app.register(api);

if (existsSync(config.webDist)) {
  // produção: o próprio servidor entrega a UI (a equipe só precisa abrir http://<ip>:4747)
  await app.register(fastifyStatic, { root: config.webDist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api') ? reply.code(404).send({ error: 'Rota não encontrada' }) : reply.sendFile('index.html'),
  );
}

recoverJobs();
syncAgentTools();
await app.listen({ port: config.port, host: config.host });
// avisa o processo pai (app de desktop) que o servidor está pronto
process.send?.({ type: 'ready', port: config.port });
(process as any).parentPort?.postMessage({ type: 'ready', port: config.port });

const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
console.log(`\n  🏢  Office rodando`);
console.log(`     nesta máquina:  http://localhost:${config.port}`);
if (config.host === '0.0.0.0') for (const ip of lan) console.log(`     na rede local:  http://${ip}:${config.port}`);
console.log(`     dados:          ${config.dataDir}`);
console.log(`     claude:         ${config.claudeBin}\n`);
