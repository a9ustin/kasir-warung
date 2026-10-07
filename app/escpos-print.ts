/// <reference types="@types/web-bluetooth" />

export type PrintData = {
  created_at: string;
  customer_name: string;
  payment_method: string;
  order_note?: string;
  items: { name: string; qty: number | string; price: number; orderType: string; note?: string }[];
  total: number;
  cash_given?: number;
};

// ============================================================
// ESC/POS — untuk Web Bluetooth (HP Android)
// ============================================================
const ESC = 0x1b;
const GS  = 0x1d;
const cmd = {
  INIT:         [ESC, 0x40],
  ALIGN_LEFT:   [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  BOLD_ON:      [ESC, 0x45, 0x01],
  BOLD_OFF:     [ESC, 0x45, 0x00],
  FONT_NORMAL:  [GS,  0x21, 0x00],
  FONT_MEDIUM:  [GS,  0x21, 0x00], // Diubah agar size sama dengan NORMAL
  FEED_CUT:     [GS,  0x56, 0x42, 0x10],
  LF:           [0x0a],
};

function bytes(...chunks: (number[] | Uint8Array | string)[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = chunks.map(c => {
    if (typeof c === 'string') return encoder.encode(c);
    if (c instanceof Uint8Array) return c;
    return new Uint8Array(c);
  });
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

const COL = 32;
function padRow(left: string, right: string): string {
  const gap = COL - left.length - right.length;
  return left + (gap > 0 ? ' '.repeat(gap) : ' ') + right;
}

function wrapText(text: string, maxLen = COL): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + (cur ? ' ' : '') + w).length <= maxLen) {
      cur += (cur ? ' ' : '') + w;
    } else {
      if (cur) lines.push(cur);
      cur = w.length > maxLen ? w.slice(0, maxLen) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function buildReceipt(data: PrintData): Uint8Array {
  const chunks: (number[] | string)[] = [];
  const add = (...c: (number[] | string)[]) => chunks.push(...c);
  const nl  = () => add(cmd.LF);

  add(cmd.INIT);
  add(cmd.ALIGN_CENTER, cmd.FONT_NORMAL, cmd.BOLD_ON);
  add('KEDAI BU SABAR\n');
  add(cmd.FONT_NORMAL, cmd.BOLD_OFF);
  add('Duwet Lor RT 02 RW 16 Baturetno\n');
  add('083811014351\n');
  add('--------------------------------\n');
  nl();

  add(cmd.ALIGN_LEFT);
  const tgl = new Date(data.created_at).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  add(`Tgl  : ${tgl}\n`);
  add(`Nama : ${data.customer_name}\n`);
  if (data.order_note) add(`Ket  : ${data.order_note}\n`);
  add('--------------------------------\n');

  for (const item of data.items) {
    const qty = Number(item.qty) || 1;
    const label = item.name;
    const lines = wrapText(label, COL - 2);
    add(cmd.BOLD_ON);
    add(lines[0] + '\n');
    add(cmd.BOLD_OFF);
    for (let i = 1; i < lines.length; i++) add('  ' + lines[i] + '\n');
    if (item.note) add(`  *${item.note}*\n`);
    const subtotal = `Rp ${(qty * item.price).toLocaleString('id-ID')}`;
    add(padRow(`  ${qty} x ${item.price.toLocaleString('id-ID')}`, subtotal) + '\n');
  }

  add('--------------------------------\n');
  add(cmd.BOLD_ON, cmd.FONT_NORMAL);
  add(padRow('TOTAL', `Rp ${data.total.toLocaleString('id-ID')}`) + '\n');
  add(cmd.FONT_NORMAL, cmd.BOLD_OFF);

  if (data.payment_method === 'Cash' && (data.cash_given ?? 0) > 0) {
    add('--------------------------------\n');
    add(padRow('Tunai', `Rp ${data.cash_given!.toLocaleString('id-ID')}`) + '\n');
    const kembali = Math.max(0, data.cash_given! - data.total);
    add(cmd.BOLD_ON);
    add(padRow('Kembali', `Rp ${kembali.toLocaleString('id-ID')}`) + '\n');
    add(cmd.BOLD_OFF);
  }

  nl();
  add(cmd.ALIGN_CENTER, cmd.BOLD_ON);
  add('Terima Kasih!\n');
  add(cmd.BOLD_OFF);
  nl(); nl();
  add(cmd.FEED_CUT);
  return bytes(...chunks);
}

// ============================================================
// Web Bluetooth — HP Android Chrome
// ============================================================
const FALLBACK_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff00-0000-1000-8000-00805f9b34fb',
];
const FALLBACK_CHARS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '0000ff01-0000-1000-8000-00805f9b34fb',
];

let cachedDevice: BluetoothDevice | null = null;
let cachedChar: BluetoothRemoteGATTCharacteristic | null = null;

async function getCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic> {
  if (cachedChar && cachedDevice?.gatt?.connected) return cachedChar;

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: FALLBACK_SERVICES,
  });

  const server = await device.gatt!.connect();
  let foundChar: BluetoothRemoteGATTCharacteristic | null = null;

  for (const svcUUID of FALLBACK_SERVICES) {
    try {
      const service = await server.getPrimaryService(svcUUID);
      for (const charUUID of FALLBACK_CHARS) {
        try {
          const ch = await service.getCharacteristic(charUUID);
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            foundChar = ch; break;
          }
        } catch { /* lanjut */ }
      }
      if (foundChar) break;
    } catch { /* lanjut */ }
  }

  if (!foundChar) throw new Error('Printer tidak ditemukan. Pastikan printer ON dan Bluetooth aktif.');

  cachedDevice = device;
  cachedChar = foundChar;
  device.addEventListener('gattserverdisconnected', () => {
    cachedDevice = null; cachedChar = null;
  });
  return foundChar;
}

async function writeInChunks(char: BluetoothRemoteGATTCharacteristic, data: Uint8Array) {
  const CHUNK = 512;
  for (let i = 0; i < data.length; i += CHUNK) {
    await char.writeValue(data.slice(i, i + CHUNK));
    await new Promise(r => setTimeout(r, 30));
  }
}

// ============================================================
// Print via window.print() — Laptop / USB
// Inject iframe tersembunyi berisi HTML struk, print, lalu hapus
// ============================================================
function printViaHTML(data: PrintData): void {
  const tgl = new Date(data.created_at).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const itemsHTML = data.items.map(item => {
    const qty = Number(item.qty) || 1;
    const subtotal = (qty * item.price).toLocaleString('id-ID');
    const label = item.name;
    const noteHTML = item.note ? `<div class="note">*${item.note}*</div>` : '';
    return `
      <div class="item">
        <div class="item-name">${label}</div>
        ${noteHTML}
        <div class="item-row">
          <span>${qty} x ${item.price.toLocaleString('id-ID')}</span>
          <span>Rp ${subtotal}</span>
        </div>
      </div>`;
  }).join('');

  const cashHTML = (data.payment_method === 'Cash' && (data.cash_given ?? 0) > 0) ? `
    <div class="divider"></div>
    <div class="item-row"><span>Tunai</span><span>Rp ${data.cash_given!.toLocaleString('id-ID')}</span></div>
    <div class="item-row bold"><span>Kembali</span><span>Rp ${Math.max(0, data.cash_given! - data.total).toLocaleString('id-ID')}</span></div>
  ` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12px;
    width: 58mm;
    color: #000;
    background: #fff;
    padding: 4px;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  /* Semua size disamakan mengikuti inheritance dari body (12px), 
     kecuali dibatasi dengan font-weight saja */
  .store-name { font-weight: bold; text-align: center; margin: 4px 0 2px; }
  .store-info { text-align: center; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .info-row { margin: 2px 0; }
  .item { margin: 4px 0; }
  .item-name { font-weight: bold; }
  .note { padding-left: 4px; }
  .item-row { display: flex; justify-content: space-between; padding-left: 4px; }
  .total-row { display: flex; justify-content: space-between; font-weight: bold; margin: 4px 0; }
  .footer { text-align: center; font-weight: bold; margin-top: 8px; }
  @page { margin: 0; size: 58mm auto; }
</style>
</head>
<body>
  <div class="store-name">KEDAI BU SABAR</div>
  <div class="store-info">Duwet Lor RT 02 RW 16 Baturetno</div>
  <div class="store-info">083811014351</div>
  <div class="divider"></div>
  <div class="info-row">Tgl  : ${tgl}</div>
  <div class="info-row">Nama : ${data.customer_name}</div>
  ${data.order_note ? `<div class="info-row">Ket  : ${data.order_note}</div>` : ''}
  <div class="divider"></div>
  ${itemsHTML}
  <div class="divider"></div>
  <div class="total-row"><span>TOTAL</span><span>Rp ${data.total.toLocaleString('id-ID')}</span></div>
  ${cashHTML}
  <div class="footer">Terima Kasih!</div>
</body>
</html>`;

  // Inject ke iframe tersembunyi → print → hapus
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:58mm;height:0;border:none;';
  document.body.appendChild(iframe);
  iframe.contentDocument!.open();
  iframe.contentDocument!.write(html);
  iframe.contentDocument!.close();

  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 300); 
}

// ============================================================
// FUNGSI UTAMA — auto-detect HP vs Laptop
// ============================================================
export async function printReceipt(
  data: PrintData,
  onStatus?: (msg: string) => void
): Promise<void> {
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  // HP Android → pakai Bluetooth
  if (isMobile && hasBluetooth) {
    try {
      onStatus?.('Pilih printer di popup...');
      const char = await getCharacteristic();
      onStatus?.('Mengirim ke printer...');
      await writeInChunks(char, buildReceipt(data));
      onStatus?.('Print berhasil! ✅');
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === 'AbortError') { onStatus?.('Dibatalkan.'); return; }
      onStatus?.(`Gagal: ${e?.message ?? 'Unknown error'} ❌`);
    }
    return;
  }

  // Laptop → pakai iframe print (USB printer via Windows driver)
  onStatus?.('Membuka dialog print...');
  printViaHTML(data);
  setTimeout(() => onStatus?.(null as unknown as string), 2000);
}
