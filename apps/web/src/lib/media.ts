/** Foto RAW da câmera (ARW da Sony, CR2/CR3, NEF, DNG...): o servidor mostra a prévia JPEG que vem dentro dela. */
export const RAW_EXT = 'arw|srf|sr2|cr2|cr3|nef|nrw|dng|raf|orf|rw2|pef|srw';
/** Imagens que o Office mostra (as comuns e as RAW). */
export const IMG = new RegExp(String.raw`\.(png|jpe?g|webp|gif|${RAW_EXT})$`, 'i');
