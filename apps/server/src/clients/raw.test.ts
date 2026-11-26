import { test } from 'node:test';
import assert from 'node:assert/strict';
import { largestJpeg, tiffOrientation } from './raw.ts';

/** JPEG mínimo: SOI, APP0, SOS e dados (sem FF solto) até o EOI. */
const jpeg = (size: number) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x04, 0x00, 0x00]),
  Buffer.alloc(size, 0x11),
  Buffer.from([0xff, 0xd9]),
]);

/** Cabeçalho TIFF little-endian com a orientação no primeiro IFD, como no ARW. */
function tiff(orientation: number) {
  const b = Buffer.alloc(8 + 2 + 12 + 4);
  b.write('II', 0, 'latin1'); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4);
  b.writeUInt16LE(1, 8);
  b.writeUInt16LE(0x0112, 10); b.writeUInt16LE(3, 12); b.writeUInt32LE(1, 14); b.writeUInt16LE(orientation, 18);
  return b;
}

test('RAW: pega a maior prévia JPEG de dentro do arquivo e lê a orientação', () => {
  const small = jpeg(30_000), big = jpeg(90_000), tiny = jpeg(500);
  const raw = Buffer.concat([tiff(6), Buffer.alloc(100), tiny, Buffer.alloc(50), small, Buffer.alloc(70), big, Buffer.alloc(200, 0x22)]);
  const got = largestJpeg(raw);
  assert.equal(got?.length, big.length);
  assert.deepEqual(got?.subarray(-2), Buffer.from([0xff, 0xd9]));
  assert.equal(tiffOrientation(raw), 6);
  assert.equal(tiffOrientation(Buffer.from('nada aqui')), 1);
  assert.equal(largestJpeg(Buffer.alloc(1000)), null);
});
