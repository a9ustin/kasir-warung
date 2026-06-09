'use client';
import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { printReceipt, type PrintData } from './escpos-print';

type MenuItem = { id: string; name: string; price: number; category: string };
type VariantGroup = { id: string; name: string; is_required: boolean };
type VariantOption = { id: string; group_id: string; option_name: string; price_add: number };
type MenuVariantGroup = { id: string; menu_id: string; group_id: string };
type SelectedVariant = { group_id: string; group_name: string; option_name: string; price_add: number };
type CartItem = {
  cartKey: string; id: string; name: string; price: number; category: string;
  qty: number | ''; note: string; isDone: boolean; isCustom?: boolean;
  orderType: 'Dine In' | 'Take Away'; selectedVariants: SelectedVariant[]; finalPrice: number;
};
type Order = {
  id: string; customer_name: string; order_note: string; items: CartItem[]; total: number;
  status: 'To Do' | 'In Progress' | 'Done';
  payment_method: 'Belum Bayar' | 'Cash' | 'QRIS Mandiri' | 'QRIS Gopay'; created_at: string;
};

function makeCartKey(menuId: string, orderType: string, variants: SelectedVariant[]) {
  return `${menuId}__${orderType}__${variants.map(v => `${v.group_id}:${v.option_name}`).sort().join('|')}`;
}

const ModernInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`w-full bg-gray-50 border-gray-200 border-2 text-gray-900 text-base p-3.5 rounded-2xl outline-none focus:border-orange-600 transition-colors placeholder:text-gray-400 ${props.className ?? ''}`} />
);

// ─── VARIANT MODAL ───────────────────────────────────────────
function VariantModal({ menu, groups, options, menuGroupIds, onAdd, onClose }: {
  menu: MenuItem; groups: VariantGroup[]; options: VariantOption[];
  menuGroupIds: string[]; onAdd: (item: CartItem) => void; onClose: () => void;
}) {
  const [orderType, setOrderType] = useState<'Dine In' | 'Take Away'>('Take Away');
  const [selected, setSelected] = useState<SelectedVariant[]>([]);
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  const activeGroups = groups.filter(g => menuGroupIds.includes(g.id));
  const toggle = (group: VariantGroup, opt: VariantOption) => {
    const exists = selected.find(s => s.group_id === group.id && s.option_name === opt.option_name);
    if (exists) setSelected(selected.filter(s => !(s.group_id === group.id && s.option_name === opt.option_name)));
    else setSelected([...selected, { group_id: group.id, group_name: group.name, option_name: opt.option_name, price_add: opt.price_add }]);
  };
  const extraTotal = selected.reduce((s, v) => s + v.price_add, 0);
  const finalPrice = menu.price + extraTotal;
  const requiredGroups = activeGroups.filter(g => g.is_required);
  const allRequiredFilled = requiredGroups.every(g => selected.some(s => s.group_id === g.id));
  const missingRequired = requiredGroups.filter(g => !selected.some(s => s.group_id === g.id)).map(g => g.name);
  const handleAdd = () => {
    if (!allRequiredFilled) return;
    onAdd({ cartKey: makeCartKey(menu.id, orderType, selected), id: menu.id, name: menu.name, price: menu.price, category: menu.category, qty, note, isDone: false, orderType, selectedVariants: selected, finalPrice });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-t-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 bg-gray-300 rounded-full" /></div>
        <div className="px-5 pt-2 pb-4 border-b border-gray-100">
          <div className="flex justify-between items-start">
            <div><h2 className="font-black text-xl text-gray-900">{menu.name}</h2>
              <p className="text-orange-600 font-bold text-lg mt-0.5">Rp {menu.price.toLocaleString('id-ID')}</p></div>
            <button onClick={onClose} className="text-gray-400 text-3xl leading-none">×</button>
          </div>
        </div>
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-3">Jenis Pesanan</p>
          <div className="flex gap-3">
            {(['Take Away', 'Dine In'] as const).map(t => (
              <button key={t} onClick={() => setOrderType(t)} className={`flex-1 py-2.5 rounded-2xl font-bold text-sm border-2 transition-all ${orderType === t ? 'bg-orange-600 border-orange-600 text-white' : 'border-gray-200 text-gray-600'}`}>
                {t === 'Take Away' ? '🛍 Bungkus' : '🍽 Makan Sini'}
              </button>
            ))}
          </div>
        </div>
        {activeGroups.map(group => (
          <div key={group.id} className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-black text-gray-700 uppercase tracking-wider">{group.name}</p>
              {group.is_required && <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Wajib</span>}
            </div>
            <div className="flex flex-col gap-2">
              {options.filter(o => o.group_id === group.id).map(opt => {
                const isSelected = selected.some(s => s.group_id === group.id && s.option_name === opt.option_name);
                return (
                  <button key={opt.id} onClick={() => toggle(group, opt)} className={`flex justify-between items-center p-3.5 rounded-2xl border-2 transition-all text-left ${isSelected ? 'border-orange-600 bg-orange-50' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-orange-600 border-orange-600' : 'border-gray-300 bg-white'}`}>
                        {isSelected && <span className="text-white text-xs font-black">✓</span>}
                      </div>
                      <span className={`font-semibold text-sm ${isSelected ? 'text-orange-700' : 'text-gray-700'}`}>{opt.option_name}</span>
                    </div>
                    <span className={`text-xs font-bold ${opt.price_add > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                      {opt.price_add > 0 ? `+Rp ${opt.price_add.toLocaleString('id-ID')}` : 'Gratis'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-2">Catatan (Opsional)</p>
          <input placeholder="Contoh: jangan pedas..." value={note} onChange={e => setNote(e.target.value)} className="w-full bg-gray-50 border-2 border-gray-200 p-3 rounded-2xl text-sm outline-none focus:border-orange-600" />
        </div>
        <div className="px-5 py-4 pb-8">
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-2 bg-gray-100 rounded-2xl px-2 py-2 shrink-0">
              <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-xl bg-white shadow-sm font-black text-gray-600 hover:text-orange-600 flex items-center justify-center text-lg">−</button>
              <span className="w-8 text-center font-black text-base text-gray-900">{qty}</span>
              <button onClick={() => setQty(q => q + 1)} className="w-8 h-8 rounded-xl bg-orange-600 text-white font-black flex items-center justify-center text-lg shadow-sm hover:bg-orange-700">+</button>
            </div>
            <button onClick={handleAdd} disabled={!allRequiredFilled} className={`flex-1 py-4 rounded-2xl font-black text-sm transition-all ${allRequiredFilled ? 'bg-orange-600 text-white shadow-lg active:scale-95' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
              {allRequiredFilled ? `Keranjang · Rp ${(finalPrice * qty).toLocaleString('id-ID')}` : `Pilih ${missingRequired.join(', ')} dulu`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ────────────────────────────────────────────────────
export default function KasirWarung() {
  // Persist active tab ke localStorage
  const [activeTab, setActiveTab] = useState<'KASIR' | 'TRACKER' | 'REKAP' | 'MASTER'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('activeTab') as any) || 'KASIR';
    return 'KASIR';
  });
  const [masterSubTab, setMasterSubTab] = useState<'MENU' | 'VARIAN'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('masterSubTab') as any) || 'MENU';
    return 'MENU';
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const switchTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    localStorage.setItem('activeTab', tab);
    if (tab !== 'KASIR') clearKasir();
  };
  const switchMasterSubTab = (tab: typeof masterSubTab) => {
    setMasterSubTab(tab);
    localStorage.setItem('masterSubTab', tab);
  };

  // Data
  const [menuList, setMenuList] = useState<MenuItem[]>([]);
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([]);
  const [variantOptions, setVariantOptions] = useState<VariantOption[]>([]);
  const [menuVariantGroups, setMenuVariantGroups] = useState<MenuVariantGroup[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  // Kategori kustom (dari menu + tambahan user)
  const [customCategories, setCustomCategories] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('customCategories') || '[]'); } catch { return []; }
    }
    return [];
  });

  // Kasir
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Order['payment_method']>('Belum Bayar');
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [cashGiven, setCashGiven] = useState('');
  const [variantModal, setVariantModal] = useState<MenuItem | null>(null);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customOrderType, setCustomOrderType] = useState<'Dine In' | 'Take Away'>('Take Away');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [trackerCashGiven, setTrackerCashGiven] = useState<Record<string, string>>({});
  const [recapFilter, setRecapFilter] = useState<'Hari Ini' | 'Minggu Ini' | 'Semua'>('Hari Ini');

  // Master Menu
  const [masterSearch, setMasterSearch] = useState('');
  const [masterCategoryFilter, setMasterCategoryFilter] = useState('All');
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState('Nasi');
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof MenuItem; direction: 'asc' | 'desc' }>({ key: 'category', direction: 'asc' });

  // Master Varian
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [newOptName, setNewOptName] = useState('');
  const [newOptPrice, setNewOptPrice] = useState('');
  const [expandedMenuVariantId, setExpandedMenuVariantId] = useState<string | null>(null);

  // UI
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ isOpen: boolean; message: string; onConfirm: () => void }>({ isOpen: false, message: '', onConfirm: () => {} });

  // ─── FETCH ───────────────────────────────────────────────
  useEffect(() => {
    fetchAll();
    let t: ReturnType<typeof setTimeout>;
    const ch = supabase.channel('rt').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      clearTimeout(t); t = setTimeout(fetchOrders, 500);
    }).subscribe();
    return () => { supabase.removeChannel(ch); clearTimeout(t); };
  }, []);

  const fetchAll = () => { fetchMenus(); fetchVariantGroups(); fetchVariantOptions(); fetchMenuVariantGroups(); fetchOrders(); };
  const fetchMenus = async () => { const { data } = await supabase.from('menus').select('*'); if (data) setMenuList(data); };
  const fetchVariantGroups = async () => { const { data } = await supabase.from('variant_groups').select('*').order('created_at'); if (data) setVariantGroups(data); };
  const fetchVariantOptions = async () => { const { data } = await supabase.from('variant_options').select('*').order('created_at'); if (data) setVariantOptions(data); };
  const fetchMenuVariantGroups = async () => { const { data } = await supabase.from('menu_variant_groups').select('*'); if (data) setMenuVariantGroups(data); };
  const fetchOrders = async () => { const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false }); if (data) setOrders(data); };

  const showToast = (msg: string) => { setToastMessage(msg); setTimeout(() => setToastMessage(null), 1800); };
  const confirmAction = (msg: string, action: () => void) => setDialog({ isOpen: true, message: msg, onConfirm: () => { action(); setDialog(p => ({ ...p, isOpen: false })); } });

  // Gabungan kategori dari menu + custom
  const allCategories = ['All', ...Array.from(new Set([
    ...menuList.map(m => m.category),
    ...customCategories,
    'Nasi', 'Ala Carte', 'Snack', 'Minuman', 'Tambahan', 'Rokok', 'Sembako'
  ]))];

  const addCustomCategory = () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return showToast('Isi nama kategori!');
    if (allCategories.includes(trimmed)) return showToast('Kategori sudah ada!');
    const updated = [...customCategories, trimmed];
    setCustomCategories(updated);
    localStorage.setItem('customCategories', JSON.stringify(updated));
    setNewCategoryInput('');
    showToast(`Kategori "${trimmed}" ditambah! ✅`);
  };

  // ─── CART ────────────────────────────────────────────────
  const handleMenuClick = (menu: MenuItem) => setVariantModal(menu);

  const addToCartFromModal = (item: CartItem) => {
    const idx = cart.findIndex(c => c.cartKey === item.cartKey);
    if (idx !== -1) { const nc = [...cart]; nc[idx].qty = Number(nc[idx].qty) + Number(item.qty); setCart(nc); }
    else setCart([...cart, item]);
    showToast('Masuk keranjang! 🛒');
  };

  const addCustomItem = () => {
    if (!customName || !customPrice) return showToast('Isi data dadakan!');
    const key = `custom-${crypto.randomUUID()}`;
    setCart([...cart, { cartKey: key, id: key, name: customName, price: parseInt(customPrice) || 0, category: 'Dadakan', qty: 1, note: '', isDone: false, isCustom: true, orderType: customOrderType, selectedVariants: [], finalPrice: parseInt(customPrice) || 0 }]);
    setCustomName(''); setCustomPrice(''); showToast('Masuk keranjang!');
  };

  const updateQty = (idx: number, delta: number) => {
    const nc = [...cart]; nc[idx].qty = (Number(nc[idx].qty) || 0) + delta;
    if (Number(nc[idx].qty) <= 0) setCart(nc.filter((_, i) => i !== idx)); else setCart(nc);
  };
  const updateQtyDirect = (idx: number, val: string) => { const nc = [...cart]; nc[idx].qty = val === '' ? '' : Number(val); setCart(nc); };
  const handleQtyBlur = (idx: number) => { const nc = [...cart]; if (!nc[idx].qty || Number(nc[idx].qty) <= 0) nc[idx].qty = 1; setCart(nc); };
  const totalCart = cart.reduce((s, i) => s + (i.finalPrice * (Number(i.qty) || 0)), 0);
  const clearKasir = () => { setCart([]); setCustomerName(''); setOrderNote(''); setPaymentMethod('Belum Bayar'); setCashGiven(''); setEditingOrderId(null); setIsMobileCartOpen(false); };

  const submitOrder = async () => {
    if (!customerName || cart.length === 0) return showToast('Data belum lengkap!');
    const cleanCart = cart.map(c => ({ ...c, qty: Number(c.qty) || 1 }));
    const orderData = { customer_name: customerName, order_note: orderNote, items: cleanCart, total: totalCart, status: 'To Do', payment_method: paymentMethod };
    const { error } = editingOrderId ? await supabase.from('orders').update(orderData).eq('id', editingOrderId) : await supabase.from('orders').insert([orderData]);
    if (!error) { clearKasir(); switchTab('TRACKER'); showToast('Dikirim ke dapur! 🍳'); } else showToast('Gagal proses!');
  };

  // ─── PRINT ───────────────────────────────────────────────
  const buildPrintItems = (items: CartItem[]) => items.map(c => ({
    ...c, qty: Number(c.qty) || 1, price: c.finalPrice ?? c.price,
    name: c.selectedVariants?.length > 0 ? `${c.name} (${c.selectedVariants.map(v => v.option_name).join(', ')})` : c.name,
  }));
  const handlePrintCart = async () => {
    if (!customerName || cart.length === 0) return showToast('Keranjang kosong!');
    await printReceipt({ created_at: new Date().toISOString(), customer_name: customerName, payment_method: paymentMethod, order_note: orderNote, items: buildPrintItems(cart), total: totalCart, cash_given: parseInt(cashGiven) || 0 },
      msg => { setPrintStatus(msg); setTimeout(() => setPrintStatus(null), 3000); });
  };
  const handlePrintOrder = async (order: Order, overrideCash?: string) => {
    await printReceipt({ ...order, items: buildPrintItems(order.items), cash_given: parseInt(overrideCash || '0') },
      msg => { setPrintStatus(msg); setTimeout(() => setPrintStatus(null), 3000); });
  };

  // ─── MASTER MENU ─────────────────────────────────────────
  const handleAddMenu = async () => {
    if (!newMenuName || !newMenuPrice) return showToast('Isi data lengkap!');
    const { data, error } = await supabase.from('menus').insert([{ name: newMenuName, price: parseInt(newMenuPrice) || 0, category: newMenuCategory }]).select();
    if (!error && data) { setMenuList([...menuList, data[0]]); setNewMenuName(''); setNewMenuPrice(''); showToast('Menu ditambah! 💾'); }
  };

  const handleUpdateMenu = async (id: string) => {
    if (!editName || !editPrice) return showToast('Nama/harga kosong!');
    // Optimistic update
    setMenuList(prev => prev.map(m => m.id === id ? { ...m, name: editName, price: parseInt(editPrice) || 0, category: editCategory } : m));
    setEditingMenuId(null);
    showToast('Diupdate! ✅');
    await supabase.from('menus').update({ name: editName, price: parseInt(editPrice) || 0, category: editCategory }).eq('id', id);
  };

  const handleDeleteMenu = (id: string) => confirmAction('Hapus menu ini?', async () => {
    await supabase.from('menus').delete().eq('id', id);
    setMenuList(menuList.filter(m => m.id !== id)); showToast('Dihapus! 🗑️');
  });

  // ─── MASTER VARIAN ───────────────────────────────────────
  const handleAddGroup = async () => {
    if (!newGroupName) return showToast('Isi nama grup!');
    const { data, error } = await supabase.from('variant_groups').insert([{ name: newGroupName, is_required: newGroupRequired }]).select();
    if (!error && data) { setVariantGroups([...variantGroups, data[0]]); setNewGroupName(''); setNewGroupRequired(false); showToast('Grup ditambah! ✅'); }
  };

  const handleToggleRequired = async (group: VariantGroup) => {
    const newVal = !group.is_required;
    setVariantGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_required: newVal } : g));
    await supabase.from('variant_groups').update({ is_required: newVal }).eq('id', group.id);
    showToast(newVal ? 'Dijadikan wajib ✅' : 'Dijadikan opsional ✅');
  };

  const handleDeleteGroup = (id: string) => confirmAction('Hapus grup varian ini?', async () => {
    await supabase.from('variant_groups').delete().eq('id', id);
    setVariantGroups(variantGroups.filter(g => g.id !== id));
    setVariantOptions(variantOptions.filter(o => o.group_id !== id));
    setMenuVariantGroups(menuVariantGroups.filter(mvg => mvg.group_id !== id));
    showToast('Dihapus! 🗑️');
  });

  const handleAddOption = async (groupId: string) => {
    if (!newOptName) return showToast('Isi nama opsi!');
    const { data, error } = await supabase.from('variant_options').insert([{ group_id: groupId, option_name: newOptName, price_add: parseInt(newOptPrice) || 0 }]).select();
    if (!error && data) { setVariantOptions([...variantOptions, data[0]]); setNewOptName(''); setNewOptPrice(''); showToast('Opsi ditambah!'); }
  };

  const handleDeleteOption = async (id: string) => {
    await supabase.from('variant_options').delete().eq('id', id);
    setVariantOptions(variantOptions.filter(o => o.id !== id)); showToast('Dihapus!');
  };

  const toggleMenuGroupLink = async (menuId: string, groupId: string) => {
    const existing = menuVariantGroups.find(mvg => mvg.menu_id === menuId && mvg.group_id === groupId);
    if (existing) {
      await supabase.from('menu_variant_groups').delete().eq('id', existing.id);
      setMenuVariantGroups(menuVariantGroups.filter(mvg => mvg.id !== existing.id));
    } else {
      const { data, error } = await supabase.from('menu_variant_groups').insert([{ menu_id: menuId, group_id: groupId }]).select();
      if (!error && data) setMenuVariantGroups([...menuVariantGroups, data[0]]);
    }
  };

  // ─── TRACKER ─────────────────────────────────────────────
  const updateStatus = async (id: string, s: string) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: s as Order['status'] } : o));
    await supabase.from('orders').update({ status: s }).eq('id', id);
  };
  const updatePayment = async (id: string, p: string) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, payment_method: p as Order['payment_method'] } : o));
    await supabase.from('orders').update({ payment_method: p }).eq('id', id);
  };
  const deleteOrder = (id: string) => confirmAction('Batalkan pesanan ini?', async () => {
    setOrders(prev => prev.filter(o => o.id !== id));
    await supabase.from('orders').delete().eq('id', id); showToast('Dibatalkan ❌');
  });
  const toggleItemDone = async (orderId: string, itemIndex: number) => {
    const order = orders.find(o => o.id === orderId); if (!order) return;
    const newItems = order.items.map((item, i) => i === itemIndex ? { ...item, isDone: !item.isDone } : item);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, items: newItems } : o));
    const { error } = await supabase.from('orders').update({ items: newItems }).eq('id', orderId);
    if (error) { setOrders(prev => prev.map(o => o.id === orderId ? { ...o, items: order.items } : o)); showToast('Gagal update ❌'); }
  };
  const copyToClipboard = (order: Order) => {
    const text = order.items.map(it => {
      const v = it.selectedVariants?.length > 0 ? ` (${it.selectedVariants.map(v => v.option_name).join(', ')})` : '';
      return `- ${it.qty}x ${it.name}${v}${it.note ? ` - ${it.note}` : ''} (Rp ${(Number(it.qty) * (it.finalPrice ?? it.price)).toLocaleString('id-ID')})`;
    }).join('\n') + `\n\n*Total: Rp ${order.total.toLocaleString('id-ID')}*\n\n*Terima Kasih!* 🙏`;
    navigator.clipboard.writeText(text); showToast('Disalin!');
  };

  // ─── REKAP ───────────────────────────────────────────────
  const recapOrders = orders.filter(o => {
    const d = new Date(o.created_at), now = new Date();
    if (recapFilter === 'Hari Ini') return d.toDateString() === now.toDateString();
    if (recapFilter === 'Minggu Ini') return d >= new Date(now.getTime() - 7 * 86400000);
    return true;
  });
  const revenue = recapOrders.filter(o => o.payment_method !== 'Belum Bayar').reduce((s, o) => s + o.total, 0);
  const cash = recapOrders.filter(o => o.payment_method === 'Cash').reduce((s, o) => s + o.total, 0);
  const qrisMandiri = recapOrders.filter(o => o.payment_method === 'QRIS Mandiri').reduce((s, o) => s + o.total, 0);
  const qrisGopay = recapOrders.filter(o => o.payment_method === 'QRIS Gopay').reduce((s, o) => s + o.total, 0);

  const filteredMenu = menuList.filter(m => (activeCategory === 'All' || m.category === activeCategory) && m.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // ─── RENDER ──────────────────────────────────────────────
  if (!mounted) return null;
  return (
    <>
      {variantModal && (
        <VariantModal menu={variantModal} groups={variantGroups} options={variantOptions}
          menuGroupIds={menuVariantGroups.filter(mvg => mvg.menu_id === variantModal.id).map(mvg => mvg.group_id)}
          onAdd={addToCartFromModal} onClose={() => setVariantModal(null)} />
      )}
      {dialog.isOpen && (
        <div className="fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-3xl shadow-2xl w-full max-w-sm border border-gray-100">
            <h3 className="font-black text-xl mb-2">Konfirmasi</h3>
            <p className="text-gray-600 font-medium mb-6 text-sm">{dialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDialog(p => ({ ...p, isOpen: false }))} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100">Batal</button>
              <button onClick={dialog.onConfirm} className="px-5 py-2.5 rounded-xl font-bold text-white bg-red-600 shadow-md">Ya, Lanjutkan</button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-[#FAF9F6] text-gray-900 font-sans pb-10">
        {/* NAVBAR */}
        <div className="bg-white/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3 border-b border-gray-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 max-w-7xl mx-auto">
            <h1 className="font-extrabold text-xl tracking-tighter shrink-0 cursor-pointer" onClick={() => switchTab('KASIR')}>Warung<span className="text-orange-600">Kasir</span></h1>
            <div className="flex gap-1.5 bg-gray-100 p-1 rounded-2xl overflow-x-auto hide-scrollbar">
              {(['KASIR', 'TRACKER', 'REKAP', 'MASTER'] as const).map(tab => (
                <button key={tab} onClick={() => switchTab(tab)} className={`font-bold px-3 py-2 rounded-xl transition-all whitespace-nowrap text-xs md:text-sm ${activeTab === tab ? 'bg-orange-600 text-white shadow-sm' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  {tab === 'KASIR' ? '🛒 Order' : tab === 'TRACKER' ? '🍳 Dapur' : tab === 'REKAP' ? '📈 Rekap' : '⚙️ Menu'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full px-4 md:px-8 max-w-7xl mx-auto">

          {/* ── KASIR ── */}
          {activeTab === 'KASIR' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start pb-28 xl:pb-6 pt-5">
              <div className="xl:col-span-8">
                <div className="mb-4"><ModernInput type="text" placeholder="🔍 Cari menu..." className="bg-white" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /></div>
                <div className="flex gap-2 overflow-x-auto pb-3 mb-4 hide-scrollbar">
                  {['All', ...Array.from(new Set(menuList.map(m => m.category)))].map(c => (
                    <button key={c} onClick={() => setActiveCategory(c)} className={`px-4 py-1.5 rounded-full font-bold whitespace-nowrap border-2 text-sm transition-all ${activeCategory === c ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white border-gray-200 text-gray-600'}`}>{c}</button>
                  ))}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2">
                  {filteredMenu.map(m => {
                    const hasVariants = menuVariantGroups.some(mvg => mvg.menu_id === m.id);
                    return (
                      <button key={m.id} onClick={() => handleMenuClick(m)} className="bg-white p-3 rounded-2xl border-2 border-gray-100 text-left hover:border-orange-400 active:scale-95 transition-all group relative flex flex-col justify-between shadow-sm">
                        <p className="font-bold text-xs leading-snug text-gray-800">{m.name}</p>
                        <div className="flex items-center justify-between mt-2 gap-1">
                          <p className="text-xs text-orange-600 whitespace-nowrap">Rp {m.price.toLocaleString('id-ID')}</p>
                          {hasVariants && <span className="text-[8px] font-bold bg-blue-100 text-blue-500 px-1 py-0.5 rounded-full shrink-0">var</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cart */}
              <div className={`xl:col-span-4 bg-white rounded-3xl border shadow-sm xl:sticky top-20 max-h-[calc(100vh-5rem)] overflow-y-auto ${isMobileCartOpen ? 'fixed inset-0 z-[60] rounded-none max-h-screen' : 'hidden xl:block'}`}>
                <div className="p-5">
                  <div className="flex justify-between items-center mb-4 border-b pb-3">
                    <h2 className="font-black text-lg">Check <span className="text-orange-600">Order</span></h2>
                    <div className="flex gap-2">
                      {editingOrderId && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">Edit Mode</span>}
                      {isMobileCartOpen && <button onClick={() => setIsMobileCartOpen(false)} className="text-gray-500 font-bold text-sm bg-gray-100 px-3 py-1.5 rounded-xl">✕</button>}
                    </div>
                  </div>
                  <ModernInput placeholder="Nama Pelanggan" className="mb-2 text-sm" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                  <ModernInput placeholder="Catatan (Meja, dll)" className="mb-4 text-sm" value={orderNote} onChange={e => setOrderNote(e.target.value)} />

                  <div className="flex flex-col gap-2 mb-4 max-h-[35vh] overflow-y-auto pr-1">
                    {cart.length === 0 && <p className="text-center text-gray-400 py-8 border-2 border-dashed rounded-2xl text-sm">Keranjang kosong</p>}
                    {cart.map((item, idx) => (
                      <div key={item.cartKey} className="bg-gray-50 p-3.5 rounded-2xl border border-gray-100">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm leading-snug">{item.name}</p>
                            {item.selectedVariants.length > 0 && <p className="text-xs text-orange-500 font-semibold mt-0.5">{item.selectedVariants.map(v => v.option_name).join(', ')}</p>}
                            <p className="text-xs text-gray-400 mt-0.5">{item.orderType} · Rp {(item.finalPrice * (Number(item.qty) || 1)).toLocaleString('id-ID')}</p>
                          </div>
                          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1 shadow-sm shrink-0">
                            <button onClick={() => updateQty(idx, -1)} className="text-gray-500 hover:text-orange-600 font-black w-6 h-6 flex items-center justify-center">−</button>
                            <input type="number" value={item.qty} onChange={e => updateQtyDirect(idx, e.target.value)} onBlur={() => handleQtyBlur(idx)} className="w-7 text-center text-sm font-bold bg-transparent outline-none" />
                            <button onClick={() => updateQty(idx, 1)} className="text-gray-500 hover:text-orange-600 font-black w-6 h-6 flex items-center justify-center">+</button>
                          </div>
                        </div>
                        {item.note && <p className="text-xs text-red-400 mt-1 italic">📝 {item.note}</p>}
                      </div>
                    ))}
                  </div>

                  {/* Menu Dadakan */}
                  <div className="bg-orange-50 p-3 rounded-2xl border border-orange-100 mb-4">
                    <p className="text-[10px] font-black text-orange-600 uppercase tracking-wider mb-2">⚡ Menu Dadakan</p>
                    <div className="flex gap-2 mb-2">
                      <input placeholder="Nama item..." value={customName} onChange={e => setCustomName(e.target.value)} className="flex-1 bg-white border border-gray-200 text-xs p-2.5 rounded-xl outline-none focus:border-orange-600 font-bold min-w-0" />
                      <input placeholder="Harga" type="number" value={customPrice} onChange={e => setCustomPrice(e.target.value)} className="w-20 bg-white border border-gray-200 text-xs p-2.5 rounded-xl outline-none font-bold" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex gap-1 flex-1">
                        {(['Take Away', 'Dine In'] as const).map(t => (
                          <button key={t} onClick={() => setCustomOrderType(t)} className={`flex-1 py-1.5 rounded-xl text-[10px] font-black border-2 transition-all ${customOrderType === t ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white border-gray-200 text-gray-600'}`}>
                            {t === 'Take Away' ? '🛍 Bungkus' : '🍽 Sini'}
                          </button>
                        ))}
                      </div>
                      <button onClick={addCustomItem} className="bg-orange-600 text-white font-black px-4 py-2 rounded-xl text-xs">+</button>
                    </div>
                  </div>

                  <div className="bg-orange-50 p-3.5 rounded-2xl mb-4 border border-orange-100">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-orange-800">Metode Bayar</span>
                      <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as Order['payment_method'])} className="text-xs font-bold p-1.5 rounded-lg border-2 border-orange-200 outline-none bg-white">
                        <option value="Belum Bayar">⏳ Nanti</option><option value="Cash">💵 Cash</option>
                        <option value="QRIS Mandiri">📱 Mandiri</option><option value="QRIS Gopay">📱 Gopay</option>
                      </select>
                    </div>
                    {paymentMethod === 'Cash' && (
                      <div className="pt-2 border-t border-orange-200 border-dashed">
                        <input type="number" placeholder="Nominal uang..." value={cashGiven} onChange={e => setCashGiven(e.target.value)} className="w-full p-2.5 rounded-xl text-sm font-bold border-2 border-orange-200 outline-none mb-2" />
                        <div className="flex gap-1.5">
                          {[{ label: 'Pas', val: totalCart.toString() }, { label: '50rb', val: '50000' }, { label: '100rb', val: '100000' }].map(b => (
                            <button key={b.label} onClick={() => setCashGiven(b.val)} className="flex-1 py-1.5 bg-white border border-orange-200 rounded-lg text-xs font-black text-orange-700">{b.label}</button>
                          ))}
                        </div>
                        {(parseInt(cashGiven) || 0) > 0 && (
                          <div className="mt-2 text-right bg-white p-2.5 rounded-xl border border-orange-100">
                            <p className="text-[10px] font-black text-orange-400 uppercase">Kembalian</p>
                            <p className="text-lg font-black text-orange-600">Rp {Math.max(0, (parseInt(cashGiven) || 0) - totalCart).toLocaleString('id-ID')}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-sm text-gray-500 font-bold">Total</span>
                      <span className="text-2xl font-black text-orange-600">Rp {totalCart.toLocaleString('id-ID')}</span>
                    </div>
                    <div className="flex gap-2">
                      {editingOrderId && <button onClick={clearKasir} className="bg-gray-100 text-gray-500 font-bold px-3 rounded-2xl text-sm">Batal</button>}
                      <button onClick={handlePrintCart} className="bg-blue-100 text-blue-700 font-black px-3 rounded-2xl text-xl">🖨️</button>
                      <button onClick={submitOrder} className="flex-1 bg-orange-600 text-white font-black py-3.5 rounded-2xl shadow-lg active:scale-95 text-sm">
                        {editingOrderId ? 'Update Pesanan 🔄' : 'Kirim ke Dapur ✅'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {!isMobileCartOpen && (
                <div className="fixed bottom-0 left-0 right-0 bg-white p-4 border-t shadow-[0_-4px_20px_rgba(0,0,0,0.08)] z-50 xl:hidden flex justify-between items-center">
                  <div>
                    <p className="text-xs text-gray-500 font-bold">{cart.reduce((a, c) => a + (Number(c.qty) || 0), 0)} item</p>
                    <p className="text-lg font-black text-orange-600">Rp {totalCart.toLocaleString('id-ID')}</p>
                  </div>
                  <button onClick={() => setIsMobileCartOpen(true)} className="bg-orange-600 text-white font-black px-5 py-3 rounded-2xl shadow-lg text-sm">🛒 Buka Kasir</button>
                </div>
              )}
            </div>
          )}

          {/* ── TRACKER ── */}
          {activeTab === 'TRACKER' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-5">
              {(['To Do', 'Done'] as const).map(status => (
                <div key={status} className="bg-white p-5 rounded-3xl border min-h-[60vh] shadow-sm">
                  <h3 className="font-black text-lg mb-5 border-b pb-3 flex justify-between items-center">
                    {status === 'To Do' ? '🍳 Dimasak' : '✅ Selesai'}
                    <span className="bg-orange-100 text-orange-600 px-2.5 py-0.5 rounded-full text-sm font-bold">
                      {orders.filter(o => status === 'To Do' ? (o.status === 'To Do' || o.status === 'In Progress') : (o.status === 'Done' && new Date(o.created_at).toDateString() === new Date().toDateString())).length}
                    </span>
                  </h3>
                  {orders.filter(o => status === 'To Do' ? (o.status === 'To Do' || o.status === 'In Progress') : (o.status === 'Done' && new Date(o.created_at).toDateString() === new Date().toDateString())).map(o => (
                    <div key={o.id} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-4 shadow-sm">
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-black text-lg">{o.customer_name}</p>
                        <div className="flex flex-col gap-1.5 items-end">
                          <div className="flex gap-1.5">
                            <button onClick={() => handlePrintOrder(o, trackerCashGiven[o.id])} className="text-[11px] bg-blue-100 text-blue-700 px-2 py-1 rounded-lg font-black">🖨️</button>
                            <button onClick={() => { setEditingOrderId(o.id); setCustomerName(o.customer_name); setCart(o.items); setOrderNote(o.order_note); setPaymentMethod(o.payment_method); switchTab('KASIR'); }} className="text-[11px] bg-yellow-400 text-white px-2 py-1 rounded-lg font-bold">Edit</button>
                            <button onClick={() => deleteOrder(o.id)} className="text-[11px] bg-red-500 text-white px-2 py-1 rounded-lg font-bold">Batal</button>
                          </div>
                          <button onClick={() => copyToClipboard(o)} className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded-lg font-black border border-green-200">📋 WA</button>
                        </div>
                      </div>
                      <select value={o.payment_method} onChange={e => updatePayment(o.id, e.target.value)} className={`text-[10px] font-bold p-1.5 rounded-lg border mb-3 outline-none ${o.payment_method === 'Belum Bayar' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                        <option value="Belum Bayar">Belum Lunas</option><option value="Cash">Lunas (Cash)</option>
                        <option value="QRIS Mandiri">Lunas (QRIS Mandiri)</option><option value="QRIS Gopay">Lunas (QRIS Gopay)</option>
                      </select>
                      {o.payment_method === 'Cash' && (
                        <div className="mb-3 p-3 bg-orange-50 rounded-xl border border-orange-100">
                          <p className="text-[10px] font-bold text-orange-800 mb-1">Kalkulator Kembalian</p>
                          <input type="number" placeholder="Nominal uang..." value={trackerCashGiven[o.id] || ''} onChange={e => setTrackerCashGiven({ ...trackerCashGiven, [o.id]: e.target.value })} className="w-full p-2 rounded-lg text-xs font-bold border border-orange-200 outline-none mb-1.5" />
                          <div className="flex gap-1 mb-1.5">
                            {[{ l: 'Pas', v: o.total.toString() }, { l: '50rb', v: '50000' }, { l: '100rb', v: '100000' }].map(b => (
                              <button key={b.l} onClick={() => setTrackerCashGiven({ ...trackerCashGiven, [o.id]: b.v })} className="px-2 py-1 bg-white border border-orange-200 rounded text-[10px] font-black text-orange-700">{b.l}</button>
                            ))}
                          </div>
                          {(parseInt(trackerCashGiven[o.id]) || 0) > 0 && (
                            <div className="flex justify-between bg-white p-2 rounded border border-orange-100">
                              <span className="text-[10px] font-bold text-orange-400">Kembali:</span>
                              <span className="text-sm font-black text-orange-600">Rp {Math.max(0, parseInt(trackerCashGiven[o.id]) - o.total).toLocaleString('id-ID')}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="space-y-1.5 mb-4 bg-white p-3 rounded-xl border border-gray-100">
                        {o.items.map((it, i) => (
                          <div key={i} className="flex items-start gap-2 cursor-pointer" onClick={() => toggleItemDone(o.id, i)}>
                            <input type="checkbox" checked={it.isDone} readOnly className="mt-1 w-4 h-4 rounded pointer-events-none" />
                            <div className="flex-1">
                              <div className="flex justify-between">
                                <p className={`text-sm font-bold ${it.isDone ? 'line-through text-gray-400' : ''}`}>{it.qty}x {it.name}</p>
                                <span className="text-gray-400 text-[11px]">Rp {(Number(it.qty) * (it.finalPrice ?? it.price)).toLocaleString('id-ID')}</span>
                              </div>
                              {it.selectedVariants?.length > 0 && <p className="text-[10px] text-orange-500 font-semibold">{it.selectedVariants.map(v => v.option_name).join(', ')}</p>}
                              <div className="flex gap-1.5 mt-0.5">
                                <span className={`text-[9px] font-bold px-1.5 rounded ${it.orderType === 'Take Away' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>{it.orderType}</span>
                                {it.note && <span className="text-[10px] text-red-400 italic">- {it.note}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center border-t pt-3 mb-3">
                        <span className="text-xs font-black text-gray-400 uppercase">Total</span>
                        <span className="text-base font-black text-orange-600">Rp {o.total.toLocaleString('id-ID')}</span>
                      </div>
                      {(o.status === 'To Do' || o.status === 'In Progress') && (
                        <button onClick={() => updateStatus(o.id, 'Done')} className="w-full bg-green-600 text-white py-2.5 rounded-xl font-black text-xs">Siap Saji ✅</button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* ── REKAP ── */}
          {activeTab === 'REKAP' && (
            <div className="max-w-5xl mx-auto pt-5">
              <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
                <h2 className="font-black text-3xl tracking-tighter">Laporan <span className="text-orange-600">Duit</span></h2>
                <select value={recapFilter} onChange={e => setRecapFilter(e.target.value as typeof recapFilter)} className="bg-white border-2 border-gray-200 p-2.5 rounded-2xl font-black outline-none text-sm">
                  <option value="Hari Ini">Hari Ini</option><option value="Minggu Ini">Minggu Ini</option><option value="Semua">Semua Waktu</option>
                </select>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                {[{ label: 'Total Omzet', value: revenue, color: 'text-green-600' }, { label: 'Cash', value: cash, color: 'text-orange-600' }, { label: 'Mandiri', value: qrisMandiri, color: 'text-blue-600' }, { label: 'Gopay', value: qrisGopay, color: 'text-blue-400' }].map(({ label, value, color }) => (
                  <div key={label} className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 text-center">
                    <p className="text-gray-400 font-bold text-[10px] uppercase mb-1 tracking-widest">{label}</p>
                    <p className={`text-xl font-black ${color}`}>Rp {value.toLocaleString('id-ID')}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto bg-white rounded-3xl border shadow-sm">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-gray-50"><tr className="text-[10px] font-black uppercase text-gray-500 border-b">
                    <th className="p-4">Waktu</th><th className="p-4">Customer</th><th className="p-4">Metode</th><th className="p-4 text-right">Total</th><th className="p-4 text-center">Print</th>
                  </tr></thead>
                  <tbody>
                    {recapOrders.map(o => (
                      <tr key={o.id} className="border-b hover:bg-orange-50/30">
                        <td className="p-4 text-xs font-bold text-gray-400">{new Date(o.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="p-4 relative group cursor-pointer">
                          <span className="font-black text-sm border-b border-dashed border-gray-400">{o.customer_name}</span>
                          <div className="absolute left-4 top-full mt-1 w-60 bg-white border border-gray-200 shadow-xl rounded-2xl p-4 z-50 hidden group-hover:flex flex-col gap-1">
                            {o.items.map((it, i) => (
                              <div key={i} className="flex justify-between text-xs font-bold text-gray-700 whitespace-normal">
                                <span>{it.qty}x {it.name}{it.selectedVariants?.length > 0 ? ` (${it.selectedVariants.map(v => v.option_name).join(', ')})` : ''}</span>
                                <span className="text-gray-400 ml-2 shrink-0">Rp {(Number(it.qty) * (it.finalPrice ?? it.price)).toLocaleString('id-ID')}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="p-4"><span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${o.payment_method.includes('QRIS') ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{o.payment_method}</span></td>
                        <td className="p-4 text-right font-bold text-sm">Rp {o.total.toLocaleString('id-ID')}</td>
                        <td className="p-4 text-center"><button onClick={() => handlePrintOrder(o)} className="text-lg hover:scale-125 transition-transform">🖨️</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── MASTER ── */}
          {activeTab === 'MASTER' && (
            <div className="pt-5">
              <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-2xl w-fit">
                {(['MENU', 'VARIAN'] as const).map(t => (
                  <button key={t} onClick={() => switchMasterSubTab(t)} className={`px-5 py-2.5 rounded-xl font-black text-sm transition-all ${masterSubTab === t ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {t === 'MENU' ? '🍽 Menu Utama' : '🎛 Kategori Varian'}
                  </button>
                ))}
              </div>

              {/* ── MENU ── */}
              {masterSubTab === 'MENU' && (
                <div className="space-y-5">
                  <div className="bg-white p-5 rounded-3xl border shadow-sm">
                    <h3 className="font-black text-lg mb-4">Tambah Menu Baru</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <select value={newMenuCategory} onChange={e => setNewMenuCategory(e.target.value)} className="bg-gray-50 border-2 border-gray-200 rounded-2xl p-3 font-bold outline-none focus:border-orange-600 text-sm">
                        {allCategories.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                      </select>
                      <ModernInput placeholder="Nama Menu" value={newMenuName} onChange={e => setNewMenuName(e.target.value)} className="text-sm" />
                      <ModernInput placeholder="Harga" type="number" value={newMenuPrice} onChange={e => setNewMenuPrice(e.target.value)} className="text-sm" />
                      <button onClick={handleAddMenu} className="bg-orange-600 text-white font-black rounded-2xl py-3 text-sm shadow-md hover:bg-orange-700 active:scale-95">Simpan 💾</button>
                    </div>
                  </div>

                  {/* Tambah Kategori Baru */}
                  <div className="bg-white p-5 rounded-3xl border shadow-sm">
                    <h3 className="font-black text-base mb-3">➕ Tambah Kategori Baru</h3>
                    <div className="flex gap-3">
                      <ModernInput placeholder="Nama kategori baru (misal: Mie, Jus, Paket)" value={newCategoryInput} onChange={e => setNewCategoryInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addCustomCategory()} className="text-sm" />
                      <button onClick={addCustomCategory} className="bg-orange-600 text-white font-black rounded-2xl px-5 py-3 text-sm shadow-md hover:bg-orange-700 shrink-0">Tambah</button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {allCategories.filter(c => c !== 'All').map(c => (
                        <span key={c} className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full font-bold">{c}</span>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl border shadow-sm overflow-hidden">
                    <div className="p-5 border-b flex flex-col md:flex-row gap-3 items-start md:items-center">
                      <h3 className="font-black text-lg shrink-0">Daftar Menu</h3>
                      <div className="flex gap-2 md:ml-auto w-full md:w-auto">
                        <select value={masterCategoryFilter} onChange={e => setMasterCategoryFilter(e.target.value)} className="bg-gray-50 border-2 border-gray-200 rounded-xl p-2 font-bold outline-none text-sm">
                          <option value="All">Semua</option>{allCategories.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                        </select>
                        <ModernInput placeholder="Cari..." value={masterSearch} onChange={e => setMasterSearch(e.target.value)} className="text-sm" />
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left whitespace-nowrap">
                        <thead className="bg-gray-50"><tr className="text-xs font-black text-gray-400 uppercase border-b">
                          <th className="p-4 cursor-pointer" onClick={() => setSortConfig(p => ({ key: 'category', direction: p.key === 'category' && p.direction === 'asc' ? 'desc' : 'asc' }))}>Kategori</th>
                          <th className="p-4 cursor-pointer" onClick={() => setSortConfig(p => ({ key: 'name', direction: p.key === 'name' && p.direction === 'asc' ? 'desc' : 'asc' }))}>Nama</th>
                          <th className="p-4">Harga</th>
                          <th className="p-4 text-center">Varian Aktif</th>
                          <th className="p-4 text-center">Aksi</th>
                        </tr></thead>
                        <tbody>
                          {menuList.filter(m => (masterCategoryFilter === 'All' || m.category === masterCategoryFilter) && m.name.toLowerCase().includes(masterSearch.toLowerCase()))
                            .sort((a, b) => { if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1; if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1; return 0; })
                            .map(m => {
                              const linkedGroups = menuVariantGroups.filter(mvg => mvg.menu_id === m.id).map(mvg => variantGroups.find(g => g.id === mvg.group_id)).filter(Boolean) as VariantGroup[];
                              const isExpanded = expandedMenuVariantId === m.id;
                              const isEditing = editingMenuId === m.id;
                              return (
                                <React.Fragment key={m.id}>
                                  <tr className="border-b hover:bg-gray-50 transition-colors">
                                    <td className="p-4">
                                      {isEditing
                                        ? <select value={editCategory} onChange={e => setEditCategory(e.target.value)} className="border-2 border-orange-300 rounded-lg p-1 outline-none font-bold text-sm">
                                          {allCategories.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                                        </select>
                                        : <span className="text-[10px] font-black bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full uppercase">{m.category}</span>}
                                    </td>
                                    <td className="p-4 font-black text-sm">
                                      {isEditing
                                        ? <input className="border-2 border-orange-300 rounded-lg p-1 w-full outline-none font-bold" value={editName} onChange={e => setEditName(e.target.value)} />
                                        : m.name}
                                    </td>
                                    <td className="p-4 font-bold text-sm text-gray-600">
                                      {isEditing
                                        ? <div className="flex gap-2">
                                          <input type="number" className="border-2 border-orange-300 rounded-lg p-1 w-24 outline-none font-bold" value={editPrice} onChange={e => setEditPrice(e.target.value)} autoFocus />
                                          <button onClick={() => handleUpdateMenu(m.id)} className="bg-green-500 text-white px-2 py-1 rounded-lg text-xs font-black">OK</button>
                                          <button onClick={() => setEditingMenuId(null)} className="bg-gray-400 text-white px-2 py-1 rounded-lg text-xs">✕</button>
                                        </div>
                                        : <div className="flex items-center gap-2">
                                          <span>Rp {m.price.toLocaleString('id-ID')}</span>
                                          <button onClick={() => { setEditingMenuId(m.id); setEditPrice(m.price.toString()); setEditName(m.name); setEditCategory(m.category); }} className="text-blue-500 text-xs font-black hover:underline">✏️</button>
                                        </div>}
                                    </td>
                                    <td className="p-4 text-center">
                                      <button onClick={() => setExpandedMenuVariantId(isExpanded ? null : m.id)} className={`text-xs font-black px-3 py-1.5 rounded-lg transition-colors ${linkedGroups.length > 0 ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                        {linkedGroups.length > 0 ? linkedGroups.map(g => g.name).join(', ') : 'Tidak ada'}
                                      </button>
                                    </td>
                                    <td className="p-4 text-center">
                                      <button onClick={() => handleDeleteMenu(m.id)} className="text-xs font-black px-3 py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200">🗑️</button>
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <tr className="bg-blue-50/40">
                                      <td colSpan={5} className="px-6 py-4">
                                        <p className="text-xs font-black text-blue-700 uppercase tracking-wider mb-3">Hubungkan varian ke: <span className="text-gray-700 normal-case font-bold">{m.name}</span></p>
                                        <div className="flex flex-wrap gap-2">
                                          {variantGroups.length === 0 && <p className="text-xs text-gray-400">Belum ada grup varian.</p>}
                                          {variantGroups.map(g => {
                                            const isLinked = menuVariantGroups.some(mvg => mvg.menu_id === m.id && mvg.group_id === g.id);
                                            const opts = variantOptions.filter(o => o.group_id === g.id);
                                            return (
                                              <button key={g.id} onClick={() => toggleMenuGroupLink(m.id, g.id)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${isLinked ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'}`}>
                                                <span className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isLinked ? 'bg-white border-white' : 'border-gray-400'}`}>
                                                  {isLinked && <span className="text-blue-600 text-[10px] font-black">✓</span>}
                                                </span>
                                                <span>{g.name}</span>
                                                {g.is_required && <span className={`text-[9px] px-1 rounded ${isLinked ? 'bg-blue-500 text-white' : 'bg-red-100 text-red-500'}`}>wajib</span>}
                                                <span className={`text-[9px] ${isLinked ? 'text-blue-200' : 'text-gray-400'}`}>{opts.length} opsi</span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ── VARIAN ── */}
              {masterSubTab === 'VARIAN' && (
                <div className="space-y-5">
                  <div className="bg-white p-5 rounded-3xl border shadow-sm">
                    <h3 className="font-black text-lg mb-1">Tambah Grup Varian Baru</h3>
                    <p className="text-xs text-gray-500 mb-3">Contoh: "Level Gula", "Pilihan Es", "Pilihan Sambal"</p>
                    <div className="flex gap-3 flex-wrap">
                      <ModernInput placeholder="Nama Grup" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="text-sm flex-1 min-w-[200px]" />
                      <div className="flex items-center gap-2 bg-gray-50 border-2 border-gray-200 rounded-2xl px-4">
                        <input type="checkbox" id="req-new" checked={newGroupRequired} onChange={e => setNewGroupRequired(e.target.checked)} className="w-4 h-4" />
                        <label htmlFor="req-new" className="text-sm font-bold text-gray-600 cursor-pointer whitespace-nowrap">Wajib dipilih</label>
                      </div>
                      <button onClick={handleAddGroup} className="bg-orange-600 text-white font-black rounded-2xl px-6 py-3 text-sm shadow-md hover:bg-orange-700 active:scale-95">Buat Grup ✅</button>
                    </div>
                  </div>

                  {variantGroups.length === 0 && (
                    <div className="bg-white p-10 rounded-3xl border shadow-sm text-center text-gray-400">
                      <p className="text-4xl mb-3">🎛</p><p className="font-bold">Belum ada grup varian</p>
                    </div>
                  )}

                  {variantGroups.map(g => {
                    const opts = variantOptions.filter(o => o.group_id === g.id);
                    const linkedMenuCount = menuVariantGroups.filter(mvg => mvg.group_id === g.id).length;
                    const isExpanded = expandedGroupId === g.id;
                    return (
                      <div key={g.id} className="bg-white rounded-3xl border shadow-sm overflow-hidden">
                        <div className="p-5 flex justify-between items-start cursor-pointer hover:bg-gray-50" onClick={() => setExpandedGroupId(isExpanded ? null : g.id)}>
                          <div>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h3 className="font-black text-lg">{g.name}</h3>
                              {/* Toggle wajib/opsional langsung */}
                              <button onClick={e => { e.stopPropagation(); handleToggleRequired(g); }}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded-full transition-all ${g.is_required ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                {g.is_required ? '🔴 Wajib (klik jadi opsional)' : '⚪ Opsional (klik jadi wajib)'}
                              </button>
                            </div>
                            <p className="text-xs text-gray-500">
                              {opts.length > 0 ? opts.map(o => o.option_name).join(', ') : 'Belum ada opsi'} · <span className="text-blue-500 font-bold">{linkedMenuCount} menu terhubung</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                            <button onClick={e => { e.stopPropagation(); handleDeleteGroup(g.id); }} className="bg-red-100 text-red-600 px-3 py-1.5 rounded-xl text-xs font-black hover:bg-red-200">🗑️</button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-gray-100 p-5">
                            <div className="flex flex-wrap gap-2 mb-4">
                              {opts.map(opt => (
                                <div key={opt.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                                  <span className="font-semibold text-sm text-gray-800">{opt.option_name}</span>
                                  {opt.price_add > 0 ? <span className="text-orange-600 font-bold text-xs">+Rp {opt.price_add.toLocaleString('id-ID')}</span> : <span className="text-gray-400 text-xs">Gratis</span>}
                                  <button onClick={() => handleDeleteOption(opt.id)} className="text-red-400 hover:text-red-600 font-black ml-1">×</button>
                                </div>
                              ))}
                              {opts.length === 0 && <p className="text-xs text-gray-400 italic">Belum ada opsi.</p>}
                            </div>
                            <div className="flex gap-2 flex-wrap items-end bg-gray-50 p-4 rounded-2xl">
                              <div className="flex-1 min-w-[150px]">
                                <p className="text-[10px] font-bold text-gray-500 mb-1 uppercase">Nama Opsi</p>
                                <input placeholder="misal: Manis, Tawar..." value={newOptName} onChange={e => setNewOptName(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && handleAddOption(g.id)}
                                  className="w-full border-2 border-gray-200 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-orange-400" />
                              </div>
                              <div className="w-28">
                                <p className="text-[10px] font-bold text-gray-500 mb-1 uppercase">+Harga (Rp)</p>
                                <input type="number" placeholder="0" value={newOptPrice} onChange={e => setNewOptPrice(e.target.value)} className="w-full border-2 border-gray-200 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-orange-400" />
                              </div>
                              <button onClick={() => handleAddOption(g.id)} className="bg-orange-600 text-white font-black px-5 py-2.5 rounded-xl text-sm hover:bg-orange-700">+ Tambah Opsi</button>
                            </div>
                            {linkedMenuCount > 0 && (
                              <div className="mt-4 pt-4 border-t border-gray-100">
                                <p className="text-xs font-black text-gray-500 uppercase tracking-wider mb-2">Menu yang pakai varian ini:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {menuVariantGroups.filter(mvg => mvg.group_id === g.id).map(mvg => {
                                    const menu = menuList.find(m => m.id === mvg.menu_id);
                                    return menu ? <span key={mvg.id} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-semibold border border-blue-100">{menu.name}</span> : null;
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {printStatus && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-5 py-2.5 rounded-full shadow-xl z-[101] flex items-center gap-2 text-sm font-bold">
            <span className="animate-pulse">🖨️</span> {printStatus}
          </div>
        )}
        {toastMessage && (
          <div className="fixed bottom-20 xl:bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-full shadow-xl z-[100] text-sm font-bold animate-bounce">
            {toastMessage}
          </div>
        )}
      </div>
    </>
  );
}