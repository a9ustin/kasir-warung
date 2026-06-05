// ============================================================
// escpos-print.ts
// Drop-in ESC/POS printer helper untuk Blueprint ECO58D
// Koneksi: Web Bluetooth (Android Chrome) + fallback window.print()
// ============================================================

/// <reference types="@types/web-bluetooth" />

// ------- TIPE DATA -------
export type PrintData = {
  created_at: string;
  customer_name: string;
  payment_method: string;
  order_note?: string;
  items: { name: string; qty: number | string; price: number; orderType: string; note?: string }[];
  total: number;
  cash_given?: number;
};

// ------- ESC/POS HELPER -------
const ESC = 0x1b;
const GS  = 0x1d;

const cmd = {
  INIT:          [ESC, 0x40],
  ALIGN_LEFT:    [ESC, 0x61, 0x00],
  ALIGN_CENTER:  [ESC, 0x61, 0x01],
  BOLD_ON:       [ESC, 0x45, 0x01],
  BOLD_OFF:      [ESC, 0x45, 0x00],
  FONT_NORMAL:   [GS,  0x21, 0x00],
  FONT_MEDIUM:   [GS,  0x21, 0x11],
  FEED_CUT:      [GS,  0x56, 0x42, 0x10],
  LF:            [0x0a],
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
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

const COL = 32;
function padRow(left: string, right: string, col = COL): string {
  const gap = col - left.length - right.length;
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

// -------- BUILD RECEIPT BYTES --------
export function buildReceipt(data: PrintData): Uint8Array {
  const chunks: (number[] | string)[] = [];
  const add = (...c: (number[] | string)[]) => chunks.push(...c);
  const nl  = () => add(cmd.LF);

  add(cmd.INIT);

  // HEADER
  add(cmd.ALIGN_CENTER, cmd.FONT_MEDIUM, cmd.BOLD_ON);
  add('KEDAI BU SABAR\n');
  add(cmd.FONT_NORMAL, cmd.BOLD_OFF);
  add('Duwet Lor RT 02 RW 16 Baturetno\n');
  add('083811014351\n');
  add('--------------------------------\n');
  nl();

  // INFO ORDER
  add(cmd.ALIGN_LEFT);
  const tgl = new Date(data.created_at).toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  add(`Tgl  : ${tgl}\n`);
  add(`Nama : ${data.customer_name}\n`);
  if (data.order_note) add(`Ket  : ${data.order_note}\n`);
  add('--------------------------------\n');

  // ITEMS
  for (const item of data.items) {
    const qty = Number(item.qty) || 1;
    const label = item.name + (item.orderType === 'Take Away' ? ' (Bks)' : '');
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

  // TOTAL
  add(cmd.BOLD_ON, cmd.FONT_MEDIUM);
  add(padRow('TOTAL', `Rp ${data.total.toLocaleString('id-ID')}`) + '\n');
  add(cmd.FONT_NORMAL, cmd.BOLD_OFF);

  // KEMBALIAN
  if (data.payment_method === 'Cash' && (data.cash_given ?? 0) > 0) {
    add('--------------------------------\n');
    add(padRow('Tunai', `Rp ${(data.cash_given!).toLocaleString('id-ID')}`) + '\n');
    const kembali = Math.max(0, (data.cash_given!) - data.total);
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

// -------- WEB BLUETOOTH --------
const PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHAR    = '00002af1-0000-1000-8000-00805f9b34fb';

let cachedDevice: BluetoothDevice | null = null;
let cachedChar: BluetoothRemoteGATTCharacteristic | null = null;

async function getCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic> {
  if (cachedChar && cachedDevice?.gatt?.connected) return cachedChar;

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'Blueprint' }, { namePrefix: 'BT' }, { namePrefix: 'Printer' }],
    optionalServices: [PRINTER_SERVICE],
    // acceptAllDevices: true  ← uncomment kalau printer tidak muncul di daftar
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE);
  const char = await service.getCharacteristic(PRINTER_CHAR);

  cachedDevice = device;
  cachedChar = char;

  device.addEventListener('gattserverdisconnected', () => {
    cachedDevice = null;
    cachedChar = null;
  });

  return char;
}

async function writeInChunks(char: BluetoothRemoteGATTCharacteristic, data: Uint8Array) {
  const CHUNK = 512;
  for (let i = 0; i < data.length; i += CHUNK) {
    await char.writeValue(data.slice(i, i + CHUNK));
    await new Promise(r => setTimeout(r, 30));
  }
}

// -------- FUNGSI UTAMA --------
export async function printReceipt(
  data: PrintData,
  onStatus?: (msg: string) => void
): Promise<void> {
  const receipt = buildReceipt(data);

  if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
    try {
      onStatus?.('Menghubungkan printer...');
      const char = await getCharacteristic();
      onStatus?.('Mengirim data...');
      await writeInChunks(char, receipt);
      onStatus?.('Print berhasil! ✅');
      return;
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') {
        onStatus?.('Dibatalkan.');
        return;
      }
      console.warn('Web Bluetooth gagal, fallback ke window.print()', err);
      onStatus?.('BT gagal, print via browser...');
    }
  }

  window.print();
}