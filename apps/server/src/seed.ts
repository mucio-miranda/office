// Cria um escritório inicial a partir da linha de comando.
// uso: npm run seed -- --name "REZZU" --root "C:\Users\voce\Documents\REZZU" --extra "D:\CLAUDE" --owner "Seu Nome"
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { uid } from '@office/shared';
import { insert, one, now } from './db.ts';
import { createOffice } from './routes/api.ts';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    root: { type: 'string' },
    extra: { type: 'string', multiple: true, default: [] },
    owner: { type: 'string' },
  },
});

if (!values.name || !values.root || !values.owner) {
  console.error('uso: npm run seed -- --name <nome> --root <pasta> [--extra <pasta>] --owner <seu nome>');
  process.exit(2);
}
if (!existsSync(values.root)) {
  console.error(`A pasta ${values.root} não existe.`);
  process.exit(1);
}

let owner = one<{ id: string }>('SELECT id FROM users WHERE name = ?', values.owner);
if (!owner) {
  owner = { id: uid() };
  insert('users', { id: owner.id, name: values.owner, color: '#ff5c8a', createdAt: now() });
}
const office = createOffice(values.name, values.root, values.extra ?? [], owner.id);
console.log(`Escritório "${office.name}" criado. Código de convite para a equipe: ${office.inviteCode}`);
