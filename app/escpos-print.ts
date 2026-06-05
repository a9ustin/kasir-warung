// ============================================================
// escpos-print.ts — Blueprint ECO58D via Web Bluetooth
// ============================================================

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

const ESC = 0x1b;
const GS  = 0x1d;

const cmd = {
  INIT:         [ESC, 0x40],
  ALIGN_LEFT:   [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  BOLD_ON:      [ESC, 0x45, 0x01],
  BOLD_OFF:     [ESC, 0x45, 0x00],
  FONT_NORMAL:  [GS,  0x21, 0x00],
  FONT_MEDIUM:  [GS,  0x21, 0x11],
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

  // HEADER
  add(cmd.ALIGN_CENTER, cmd.FONT_MEDIUM, cmd.BOLD_ON);
  add('KEDAI BU SABAR\n');
  add(cmd.FONT_NORMAL, cmd.BOLD_OFF);
  add('Duwet Lor RT 02 RW 16 Baturetno\n');
  add('083811014351\n');
  add('--------------------------------\n');
  nl();

  // INFO
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

// -------- WEB BLUETOOTH --------
// UUID ini akan diupdate setelah bt-scanner.html dijalankan
// Untuk sementara pakai acceptAllDevices agar printer muncul di list
const PRINTER_SERVICE = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHAR    = '00002af1-0000-1000-8000-00805f9b34fb';

// UUID alternatif yang umum dipakai printer thermal BLE
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

  // acceptAllDevices: true → semua device BT muncul di list, tidak filter nama
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: FALLBACK_SERVICES,
  });

  const server = await device.gatt!.connect();

  // Coba tiap service UUID sampai ketemu yang cocok
  let foundChar: BluetoothRemoteGATTCharacteristic | null = null;
  for (const svcUUID of FALLBACK_SERVICES) {
    try {
      const service = await server.getPrimaryService(svcUUID);
      for (const charUUID of FALLBACK_CHARS) {
        try {
          const ch = await service.getCharacteristic(charUUID);
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            foundChar = ch;
            break;
          }
        } catch { /* char tidak ada, lanjut */ }
      }
      if (foundChar) break;
    } catch { /* service tidak ada, lanjut */ }
  }

  if (!foundChar) throw new Error('Tidak ada characteristic WRITE ditemukan di printer ini.');

  cachedDevice = device;
  cachedChar = foundChar;

  device.addEventListener('gattserverdisconnected', () => {
    cachedDevice = null;
    cachedChar = null;
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

export async function printReceipt(
  data: PrintData,
  onStatus?: (msg: string) => void
): Promise<void> {
  // Cek Web Bluetooth support
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
    onStatus?.('Browser tidak support Bluetooth, gunakan Chrome Android');
    return;
  }

  const receipt = buildReceipt(data);

  try {
    onStatus?.('Pilih printer di popup...');
    const char = await getCharacteristic();
    onStatus?.('Mengirim ke printer...');
    await writeInChunks(char, receipt);
    onStatus?.('Print berhasil! ✅');
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    if (e?.name === 'AbortError') {
      onStatus?.('Dibatalkan.');
      return;
    }
    // Tampilkan pesan error yang jelas, jangan fallback window.print()
    onStatus?.(`Gagal: ${e?.message ?? 'Unknown error'} ❌`);
    console.error('Bluetooth print error:', err);
  }
}