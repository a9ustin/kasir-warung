'use client';
import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { printReceipt, type PrintData } from './escpos-print'; // PATCH 1: Import fungsi print baru

const THEME = {
  bg: 'bg-[#FAF9F6]',         
  primary: 'orange-600',       
  primaryHover: 'orange-700',
  secondary: 'text-gray-900',  
  cardBg: 'bg-white',
  cardBorder: 'border-gray-100',
  cardShadow: 'shadow-[0_8px_30px_rgb(0,0,0,0.04)]', 
  activeTab: 'bg-orange-600 text-white',
  inactiveTab: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
};

type MenuItem = { id: string; name: string; price: number; category: string };
type CartItem = MenuItem & { qty: number | ''; note: string; isDone: boolean; isCustom?: boolean; orderType: 'Dine In' | 'Take Away' };
type Order = { 
  id: string; customer_name: string; order_note: string; items: CartItem[]; total: number; status: 'To Do' | 'In Progress' | 'Done'; payment_method: 'Belum Bayar' | 'Cash' | 'QRIS Mandiri' | 'QRIS Gopay'; created_at: string;
};

const ModernInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`w-full bg-gray-50 border-gray-200 border-2 ${THEME.secondary} text-base p-3.5 rounded-2xl outline-none focus:border-${THEME.primary} transition-colors placeholder:text-gray-400 ${props.className}`} />
);

export default function KasirWarung() {
  const [activeTab, setActiveTab] = useState<'KASIR' | 'TRACKER' | 'REKAP' | 'MASTER'>('KASIR');
  const [menuList, setMenuList] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [recapFilter, setRecapFilter] = useState<'Hari Ini' | 'Minggu Ini' | 'Semua'>('Hari Ini');
  
  // State Master Menu
  const [masterSearch, setMasterSearch] = useState('');
  const [masterCategoryFilter, setMasterCategoryFilter] = useState('All');
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editName, setEditName] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<{key: keyof MenuItem, direction: 'asc' | 'desc'}>({key: 'category', direction: 'asc'});

  // State Kasir & Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Belum Bayar' | 'Cash' | 'QRIS Mandiri' | 'QRIS Gopay'>('Belum Bayar');
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);

  // State Kalkulator Cash
  const [cashGiven, setCashGiven] = useState<string>('');
  const [trackerCashGiven, setTrackerCashGiven] = useState<Record<string, string>>({});

  // PATCH 2: State khusus untuk Web Bluetooth Print
  const [printStatus, setPrintStatus] = useState<string | null>(null);

  // Custom Modal State
  const [dialog, setDialog] = useState<{isOpen: boolean; message: string; onConfirm: () => void}>({isOpen: false, message: '', onConfirm: () => {}});

  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState('Nasi');
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- FETCH & REALTIME DENGAN DEBOUNCE ---
  useEffect(() => {
    fetchMenus(); 
    fetchOrders();
    let debounceTimer: NodeJS.Timeout;

    const channel = supabase.channel('realtime-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchOrders();
      }, 500);
    }).subscribe();

    return () => { 
      supabase.removeChannel(channel); 
      clearTimeout(debounceTimer);
    };
  }, []);

  // PATCH 3: useEffect bawaan window.print() dihapus

  const showToast = (message: string) => { setToastMessage(message); setTimeout(() => setToastMessage(null), 1500); };
  
  const confirmAction = (message: string, action: () => void) => {
    setDialog({ isOpen: true, message, onConfirm: () => { action(); setDialog(prev => ({...prev, isOpen: false})); } });
  };

  const fetchMenus = async () => { const { data } = await supabase.from('menus').select('*'); if (data) setMenuList(data); };
  const fetchOrders = async () => { const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false }); if (data) setOrders(data); };

  const copyToClipboard = (order: Order) => {
    const itemText = order.items.map(it => {
      const noteText = it.note ? ` (${it.note})` : '';
      return `- ${it.qty}x ${it.name}${noteText} (Rp ${(Number(it.qty) * it.price).toLocaleString('id-ID')})`;
    }).join('\n');
    
    const text = `${itemText}\n\n*Total: Rp ${order.total.toLocaleString('id-ID')}*\n\n*Terima Kasih!* 🙏`;
    navigator.clipboard.writeText(text); 
    showToast('Pesanan disalin!');
  };

  // PATCH 4: Fungsi Print menggunakan escpos-print
  const handlePrintCart = async () => {
    if (!customerName || cart.length === 0) return showToast('Keranjang masih kosong!');
    const data: PrintData = {
      created_at: new Date().toISOString(),
      customer_name: customerName,
      payment_method: paymentMethod,
      order_note: orderNote,
      items: cart.map(c => ({ ...c, qty: Number(c.qty) || 1 })),
      total: totalCart,
      cash_given: parseInt(cashGiven) || 0,
    };
    await printReceipt(data, (msg) => {
      setPrintStatus(msg);
      setTimeout(() => setPrintStatus(null), 3000);
    });
  };

  const handlePrintOrder = async (order: Order, overrideCash?: string) => {
    const data: PrintData = {
      ...order,
      cash_given: parseInt(overrideCash || '0'),
    };
    await printReceipt(data, (msg) => {
      setPrintStatus(msg);
      setTimeout(() => setPrintStatus(null), 3000);
    });
  };

  const handleUpdateMenu = async (id: string) => {
    if (!editName || !editPrice) return showToast('Nama/harga kosong! ⚠️');
    const { error } = await supabase.from('menus').update({ name: editName, price: parseInt(editPrice) || 0 }).eq('id', id);
    if (!error) { setEditingMenuId(null); fetchMenus(); showToast('Menu diupdate! ✅'); } else showToast('Gagal update ❌');
  };

  const handleAddMenuToMaster = async () => {
    if (!newMenuName || !newMenuPrice) return showToast('Isi data lengkap!');
    const newMenu = { name: newMenuName, price: parseInt(newMenuPrice) || 0, category: newMenuCategory };
    const { data, error } = await supabase.from('menus').insert([newMenu]).select();
    if (!error && data) { setMenuList([...menuList, data[0]]); setNewMenuName(''); setNewMenuPrice(''); showToast('Menu ditambah! 💾'); }
  };

  const handleDeleteMenuFromMaster = (id: string) => {
    confirmAction('Yakin ingin menghapus menu ini dari master?', async () => {
      const { error } = await supabase.from('menus').delete().eq('id', id); 
      if (!error) { setMenuList(menuList.filter(m => m.id !== id)); showToast('Dihapus! 🗑️'); }
    });
  };

  const requestSort = (key: keyof MenuItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };
  
  const getSortIcon = (key: keyof MenuItem) => {
    if (sortConfig.key !== key) return '↕️'; return sortConfig.direction === 'asc' ? '🔼' : '🔽';
  };

  const categories = ['All', ...Array.from(new Set(menuList.map(m => m.category)))];
  const filteredMenu = menuList.filter(m => (activeCategory === 'All' || m.category === activeCategory) && m.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const addToCart = (item: MenuItem) => {
    const idx = cart.findIndex(c => c.id === item.id);
    if (idx !== -1) { const newCart = [...cart]; newCart[idx].qty = Number(newCart[idx].qty) + 1; setCart(newCart); }
    else { setCart([...cart, { ...item, qty: 1, note: '', isDone: false, orderType: 'Take Away' }]); }
  };

  const addCustomItemToCart = () => {
    if (!customName || !customPrice) return showToast('Isi data dadakan!');
    setCart([...cart, { id: crypto.randomUUID(), name: customName, price: parseInt(customPrice) || 0, category: 'Dadakan', qty: 1, note: '', isDone: false, isCustom: true, orderType: 'Take Away' }]);
    setCustomName(''); setCustomPrice(''); showToast('Masuk keranjang!');
  };

  const updateQtyDirect = (idx: number, val: string) => {
    const newCart = [...cart]; 
    newCart[idx].qty = val === '' ? '' : Number(val);
    setCart(newCart);
  };
  
  const handleQtyBlur = (idx: number) => {
    const newCart = [...cart]; if (newCart[idx].qty === '' || Number(newCart[idx].qty) <= 0) newCart[idx].qty = 1;
    setCart(newCart);
  };
  
  const updateQty = (idx: number, delta: number) => {
    const newCart = [...cart]; newCart[idx].qty = (Number(newCart[idx].qty) || 0) + delta;
    if (Number(newCart[idx].qty) <= 0) setCart(newCart.filter((_, i) => i !== idx)); else setCart(newCart);
  };

  const totalCart = cart.reduce((s, i) => s + (i.price * (Number(i.qty) || 0)), 0);

  const clearKasir = () => { setCart([]); setCustomerName(''); setOrderNote(''); setPaymentMethod('Belum Bayar'); setCashGiven(''); setEditingOrderId(null); setIsMobileCartOpen(false); };

  const submitOrder = async () => {
    if (!customerName || cart.length === 0) return showToast('Data belum lengkap!');
    const cleanCart = cart.map(c => ({...c, qty: Number(c.qty) || 1}));
    const orderData = { customer_name: customerName, order_note: orderNote, items: cleanCart, total: totalCart, status: 'To Do', payment_method: paymentMethod };
    const { error } = editingOrderId ? await supabase.from('orders').update(orderData).eq('id', editingOrderId) : await supabase.from('orders').insert([orderData]);
    if (!error) { clearKasir(); setActiveTab('TRACKER'); showToast('Dikirim ke dapur! 🍳'); } else showToast('Gagal proses!');
  };

  const updateStatus = async (id: string, s: string) => { 
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: s as any } : o)); 
    await supabase.from('orders').update({ status: s }).eq('id', id); 
  };
  
  const updatePayment = async (id: string, p: string) => { 
    setOrders(prev => prev.map(o => o.id === id ? { ...o, payment_method: p as any } : o));
    await supabase.from('orders').update({ payment_method: p }).eq('id', id); 
  };
  
  const deleteOrder = (id: string) => { 
    confirmAction('Batalkan pesanan ini secara permanen?', async () => {
      setOrders(prev => prev.filter(o => o.id !== id)); 
      await supabase.from('orders').delete().eq('id', id); 
      showToast('Dibatalkan ❌'); 
    });
  };
  
  const toggleItemDone = async (orderId: string, itemIndex: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const newItems = order.items.map((item, i) =>
      i === itemIndex ? { ...item, isDone: !item.isDone } : item
    );

    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, items: newItems } : o
    ));

    const { error } = await supabase
      .from('orders')
      .update({ items: newItems })
      .eq('id', orderId);

    if (error) {
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, items: order.items } : o
      ));
      showToast('Gagal update, coba lagi ❌');
    }
  };

  const recapOrders = orders.filter(o => {
    const d = new Date(o.created_at); const now = new Date();
    if (recapFilter === 'Hari Ini') return d.toDateString() === now.toDateString();
    if (recapFilter === 'Minggu Ini') return d >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return true;
  });

  const revenue = recapOrders.filter(o => o.payment_method !== 'Belum Bayar').reduce((s, o) => s + o.total, 0);
  const cash = recapOrders.filter(o => o.payment_method === 'Cash').reduce((s, o) => s + o.total, 0);
  const qrisMandiri = recapOrders.filter(o => o.payment_method === 'QRIS Mandiri').reduce((s, o) => s + o.total, 0);
  const qrisGopay = recapOrders.filter(o => o.payment_method === 'QRIS Gopay').reduce((s, o) => s + o.total, 0);

  return (
    <>
      {/* CUSTOM DIALOG MODAL */}
      {dialog.isOpen && (
        <div className="fixed inset-0 z-[100] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white p-6 rounded-3xl shadow-2xl w-full max-w-sm border border-gray-100 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="font-black text-xl mb-2 text-gray-900">Konfirmasi</h3>
            <p className="text-gray-600 font-medium mb-6 text-sm">{dialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDialog(prev => ({...prev, isOpen: false}))} className="px-5 py-2.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors">Batal</button>
              <button onClick={dialog.onConfirm} className="px-5 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 shadow-md transition-colors">Ya, Lanjutkan</button>
            </div>
          </div>
        </div>
      )}

      {/* PATCH 5: Struk HTML Gaib (hidden print:block) sudah dihapus dari sini */}

      {/* APLIKASI UTAMA */}
      <div className={`min-h-screen ${THEME.bg} ${THEME.secondary} font-sans pb-10`}>
        {/* NAVBAR */}
        <div className="bg-white/90 backdrop-blur-md sticky top-0 z-40 p-4 border-b border-gray-100 mb-6 shadow-sm">
          <div className="flex flex-wrap gap-4 items-center justify-between w-full px-2 md:px-6">
            <h1 className="font-extrabold text-2xl tracking-tighter cursor-pointer" onClick={() => setActiveTab('KASIR')}>Warung<span className={`text-${THEME.primary}`}>Kasir</span></h1>
            <div className="flex gap-2 bg-gray-100 p-1.5 rounded-2xl overflow-x-auto hide-scrollbar w-full md:w-auto">
              {(['KASIR', 'TRACKER', 'REKAP', 'MASTER'] as const).map(tab => (
                <button key={tab} onClick={() => { setActiveTab(tab); if(tab !== 'KASIR') clearKasir(); }} className={`font-bold px-4 py-2.5 rounded-xl transition-all whitespace-nowrap text-sm md:text-base ${activeTab === tab ? THEME.activeTab + ' shadow-md' : THEME.inactiveTab}`}>
                  {tab === 'KASIR' ? '🛒 Order' : tab === 'TRACKER' ? '🍳 Dapur' : tab === 'REKAP' ? '📈 Rekap' : '⚙️ Menu'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full px-4 md:px-10">
          {/* HALAMAN KASIR */}
          {activeTab === 'KASIR' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start pb-28 xl:pb-0">
              <div className="xl:col-span-8">
                <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-4">
                  <h2 className="font-extrabold text-3xl tracking-tight">Explore Menu</h2>
                  <div className="relative w-full md:max-w-md">
                    <ModernInput type="text" placeholder="🔍 Cari menu..." className="pl-12 bg-white py-3" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-4 mb-2 hide-scrollbar">
                  {categories.map(c => (
                    <button key={c} onClick={() => setActiveCategory(c)} className={`px-5 py-2 rounded-full font-bold whitespace-nowrap border-2 transition-all ${activeCategory === c ? 'bg-orange-600 border-orange-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-600 hover:border-orange-300'}`}>{c}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
                  {filteredMenu.map(m => (
                    <div key={m.id} onClick={() => addToCart(m)} className="bg-white p-5 rounded-3xl border-2 border-gray-100 cursor-pointer hover:border-orange-600 shadow-sm transition-all active:scale-95 group relative flex flex-col justify-between h-full min-h-[140px]">
                      <div>
                        <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-3 py-1 rounded-full">{m.category}</span>
                        <p className="font-bold text-base md:text-lg mt-3 leading-tight group-hover:text-black">{m.name}</p>
                      </div>
                      <p className="text-gray-900 font-bold mt-2">Rp {m.price.toLocaleString('id-ID')}</p>
                      <div className="absolute bottom-4 right-4 bg-orange-600 text-white w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity font-bold">+</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`xl:col-span-4 bg-white p-6 rounded-3xl border shadow-sm xl:sticky top-24 max-h-[85vh] overflow-y-auto ${isMobileCartOpen ? 'fixed inset-0 z-[60] rounded-none w-full h-full max-h-screen overflow-y-auto pb-24' : 'hidden xl:block'}`}>
                <h2 className="font-extrabold text-2xl mb-6 border-b pb-4 flex justify-between items-center">
                  <span>Check <span className="text-orange-600">Order</span></span>
                  <div className="flex gap-2 items-center">
                    {editingOrderId && <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1 rounded-full animate-pulse">Edit Mode</span>}
                    {isMobileCartOpen && <button onClick={() => setIsMobileCartOpen(false)} className="xl:hidden bg-gray-100 text-gray-700 px-4 py-2 rounded-full text-xs font-black shadow-sm">✕ Tutup</button>}
                  </div>
                </h2>
                
                <ModernInput placeholder="Nama Pelanggan" className="mb-3" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                <ModernInput placeholder="Catatan (Misal: Meja 4)" className="mb-4 text-sm" value={orderNote} onChange={e => setOrderNote(e.target.value)} />
                
                <div className="flex flex-col gap-3 mb-6 max-h-[35vh] overflow-y-auto pr-2">
                  {cart.length === 0 && <p className="text-center text-gray-400 py-6 border-2 border-dashed rounded-2xl text-sm">Keranjang kosong</p>}
                  {cart.map((item, idx) => (
                    <div key={idx} className="bg-gray-50/80 p-4 rounded-2xl border border-gray-100 relative group">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1">
                          <span className="font-bold text-sm md:text-base leading-snug block pr-5">{item.name}</span>
                          <p className="text-sm text-gray-600 font-semibold mt-1">Rp {(item.price * (Number(item.qty)||1)).toLocaleString('id-ID')}</p>
                        </div>
                        
                        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-1 py-1 shadow-sm shrink-0">
                          <button onClick={() => updateQty(idx, -1)} className="text-gray-500 hover:text-orange-600 font-extrabold w-6 h-6 flex items-center justify-center">-</button>
                          <input 
                            type="number" 
                            value={item.qty} 
                            onChange={(e) => updateQtyDirect(idx, e.target.value)} 
                            onBlur={() => handleQtyBlur(idx)} 
                            className="w-8 text-center text-sm font-bold bg-transparent outline-none focus:bg-orange-50 rounded" 
                          />
                          <button onClick={() => updateQty(idx, 1)} className="text-gray-500 hover:text-orange-600 font-extrabold w-6 h-6 flex items-center justify-center">+</button>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 items-center">
                        <select value={item.orderType} onChange={e => { const n = [...cart]; n[idx].orderType = e.target.value as any; setCart(n); }} className={`text-[10px] font-bold p-2 rounded-xl outline-none cursor-pointer border ${item.orderType === 'Take Away' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                          <option value="Take Away">🛍 Bungkus</option><option value="Dine In">🍽 Makan Sini</option>
                        </select>
                        <input placeholder="Catatan item..." className="w-full bg-white border border-gray-200 p-2 rounded-xl text-xs outline-none focus:border-red-400" value={item.note} onChange={e => { const n = [...cart]; n[idx].note = e.target.value; setCart(n); }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-white p-3.5 rounded-2xl border-2 border-dashed border-orange-200 mb-4 flex flex-col gap-2">
                  <div className="font-black text-orange-600 text-[10px] uppercase tracking-wider">⚡ Menu Dadakan:</div>
                  <div className="flex gap-2">
                    <input placeholder="Nama item..." value={customName} onChange={e => setCustomName(e.target.value)} className="w-full bg-gray-50 border border-gray-200 text-xs p-2.5 rounded-xl outline-none focus:border-orange-600 font-bold" />
                    <input placeholder="Harga" type="number" value={customPrice} onChange={e => setCustomPrice(e.target.value)} className="w-24 bg-gray-50 border border-gray-200 text-xs p-2.5 rounded-xl outline-none focus:border-orange-600 font-bold" />
                    <button onClick={addCustomItemToCart} className="bg-orange-600 text-white font-black px-4 py-2 rounded-xl hover:bg-orange-700 transition-colors text-xs shadow-sm">+</button>
                  </div>
                </div>

                <div className="bg-orange-50 p-4 rounded-2xl mb-4 flex flex-col gap-3 border border-orange-100">
                  <div className="flex justify-between items-center">
                     <span className="text-sm font-bold text-orange-800">Metode Bayar:</span>
                     <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as any)} className="text-sm font-bold p-1 rounded-lg border-2 border-orange-200 outline-none">
                       <option value="Belum Bayar">⏳ Nanti</option><option value="Cash">💵 Cash</option><option value="QRIS Mandiri">📱 QRIS Mandiri</option><option value="QRIS Gopay">📱 QRIS Gopay</option>
                     </select>
                  </div>

                  {paymentMethod === 'Cash' && (
                    <div className="pt-3 border-t border-orange-200 border-dashed">
                      <div className="flex gap-2 mb-2">
                         <input type="number" placeholder="Nominal uang... (Opsional)" value={cashGiven} onChange={e => setCashGiven(e.target.value)} className="w-full p-2.5 rounded-xl text-sm font-bold border-2 border-orange-200 outline-none focus:border-orange-600" />
                      </div>
                      <div className="flex gap-2 overflow-x-auto hide-scrollbar">
                         <button onClick={() => setCashGiven(totalCart.toString())} className="px-3 py-1.5 bg-white border border-orange-300 rounded-lg text-xs font-black shrink-0 text-orange-700 shadow-sm">Uang Pas</button>
                         <button onClick={() => setCashGiven('50000')} className="px-3 py-1.5 bg-white border border-orange-300 rounded-lg text-xs font-black shrink-0 text-orange-700 shadow-sm">50rb</button>
                         <button onClick={() => setCashGiven('100000')} className="px-3 py-1.5 bg-white border border-orange-300 rounded-lg text-xs font-black shrink-0 text-orange-700 shadow-sm">100rb</button>
                      </div>
                      {(parseInt(cashGiven) || 0) > 0 && (
                        <div className="mt-3 text-right bg-white p-3 rounded-xl border border-orange-100">
                           <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">Kembalian:</p>
                           <p className="text-xl font-black text-orange-600">Rp {Math.max(0, (parseInt(cashGiven) || 0) - totalCart).toLocaleString('id-ID')}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-t pt-5">
                  <div className="flex justify-between items-end text-3xl font-black mb-6 tracking-tighter">
                    <span className="text-base text-gray-500 font-bold">Total Pay:</span>
                    <span className="text-orange-600">Rp {totalCart.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex gap-2">
                     {editingOrderId && <button onClick={clearKasir} className="bg-gray-100 text-gray-500 font-bold px-4 rounded-2xl hover:bg-gray-200">Cancel</button>}
                     <button onClick={handlePrintCart} className="bg-blue-100 text-blue-700 font-black px-4 rounded-2xl hover:bg-blue-200 transition-all text-2xl shadow-sm" title="Print Struk Langsung">🖨️</button>
                     <button onClick={submitOrder} className="flex-1 bg-orange-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all">
                      {editingOrderId ? 'Update Pesanan 🔄' : 'Kirim ke Dapur ✅'}
                     </button>
                  </div>
                </div>
              </div>

              {!isMobileCartOpen && (
                <div className="fixed bottom-0 left-0 right-0 bg-white p-4 border-t border-gray-200 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-50 xl:hidden flex justify-between items-center rounded-t-3xl">
                   <div>
                     <p className="text-xs text-gray-500 font-bold">Total ({cart.reduce((a,c)=>a+(Number(c.qty)||0),0)} item)</p>
                     <p className="text-xl font-black text-orange-600">Rp {totalCart.toLocaleString('id-ID')}</p>
                   </div>
                   <button onClick={() => setIsMobileCartOpen(true)} className="bg-orange-600 text-white font-black px-6 py-3 rounded-2xl shadow-lg active:scale-95 transition-all flex gap-2 items-center">
                     <span>🛒</span><span>Buka Kasir</span>
                   </button>
                </div>
              )}
            </div>
          )}

          {/* HALAMAN TRACKER (DAPUR) */}
          {activeTab === 'TRACKER' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {(['To Do', 'Done'] as const).map(status => (
                <div key={status} className="bg-white p-6 rounded-3xl border min-h-[60vh] shadow-sm">
                  <h3 className="font-black text-xl mb-6 border-b pb-4 flex justify-between items-center">
                    {status === 'To Do' ? '🍳 Dimasak' : '✅ Selesai'}
                    <span className="bg-orange-100 text-orange-600 px-3 rounded-full text-sm">
                      {orders.filter(o => { 
                         if (status === 'To Do') return o.status === 'To Do' || o.status === 'In Progress';
                         return o.status === 'Done' && new Date(o.created_at).toDateString() === new Date().toDateString(); 
                      }).length}
                    </span>
                  </h3>
                  
                  {orders.filter(o => { 
                     if (status === 'To Do') return o.status === 'To Do' || o.status === 'In Progress';
                     return o.status === 'Done' && new Date(o.created_at).toDateString() === new Date().toDateString(); 
                  }).map(o => (
                    <div key={o.id} className="bg-gray-50 p-5 rounded-3xl border border-gray-100 mb-5 relative group shadow-sm">
                      <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-10">
                        <div className="flex gap-2">
                          <button onClick={() => handlePrintOrder(o, trackerCashGiven[o.id])} className="text-[12px] bg-blue-100 text-blue-700 px-2.5 py-1 rounded-lg font-black shadow-sm border border-blue-200">🖨️ Print</button>
                          <button onClick={() => { setEditingOrderId(o.id); setCustomerName(o.customer_name); setCart(o.items); setOrderNote(o.order_note); setPaymentMethod(o.payment_method); setActiveTab('KASIR'); }} className="text-[10px] bg-yellow-500 text-white px-2 py-1 rounded-lg font-bold">Edit</button>
                          <button onClick={() => deleteOrder(o.id)} className="text-[10px] bg-red-600 text-white px-2 py-1 rounded-lg font-bold">Batal</button>
                        </div>
                        <button onClick={() => copyToClipboard(o)} className="bg-green-100 text-green-700 px-2 py-1 rounded-lg font-black text-[10px] hover:bg-green-200 transition-colors shrink-0 border border-green-200">📋 COPY WA</button>
                      </div>
                      
                      <div className="flex justify-between items-start mb-2 pr-20">
                        <p className="font-black text-xl text-gray-900 leading-tight">{o.customer_name}</p>
                      </div>
                      
                      <select value={o.payment_method} onChange={e => updatePayment(o.id, e.target.value)} className={`text-[10px] font-bold p-1 rounded-lg border mt-2 mb-4 outline-none ${o.payment_method === 'Belum Bayar' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                         <option value="Belum Bayar">Belum Lunas</option>
                         <option value="Cash">Lunas (Cash)</option>
                         <option value="QRIS Mandiri">Lunas (QRIS Mandiri)</option>
                         <option value="QRIS Gopay">Lunas (QRIS Gopay)</option>
                      </select>

                      {o.payment_method === 'Cash' && (
                        <div className="mt-2 mb-4 p-3 bg-orange-50 rounded-xl border border-orange-100">
                           <p className="text-[10px] font-bold text-orange-800 mb-1">Kalkulator Kembalian:</p>
                           <div className="flex gap-2 mb-2">
                              <input type="number" placeholder="Nominal uang..." value={trackerCashGiven[o.id] || ''} onChange={e => setTrackerCashGiven({...trackerCashGiven, [o.id]: e.target.value})} className="w-full p-2 rounded-lg text-xs font-bold border border-orange-200 outline-none" />
                           </div>
                           <div className="flex gap-1 overflow-x-auto hide-scrollbar mb-2">
                              <button onClick={() => setTrackerCashGiven({...trackerCashGiven, [o.id]: o.total.toString()})} className="px-2 py-1 bg-white border border-orange-300 rounded text-[10px] font-black text-orange-700">Pas</button>
                              <button onClick={() => setTrackerCashGiven({...trackerCashGiven, [o.id]: '50000'})} className="px-2 py-1 bg-white border border-orange-300 rounded text-[10px] font-black text-orange-700">50rb</button>
                              <button onClick={() => setTrackerCashGiven({...trackerCashGiven, [o.id]: '100000'})} className="px-2 py-1 bg-white border border-orange-300 rounded text-[10px] font-black text-orange-700">100rb</button>
                           </div>
                           {(parseInt(trackerCashGiven[o.id]) > 0) && (
                             <div className="flex justify-between items-center bg-white p-2 rounded border border-orange-100">
                               <span className="text-[10px] font-bold text-orange-400">Kembali:</span>
                               <span className="text-sm font-black text-orange-600">Rp {Math.max(0, parseInt(trackerCashGiven[o.id]) - o.total).toLocaleString('id-ID')}</span>
                             </div>
                           )}
                        </div>
                      )}
                      
                      <div className="space-y-2 mb-5 bg-white p-3 rounded-xl border border-gray-100">
                        {o.items.map((it, i) => (
                          <div key={i} className="flex items-start gap-2 cursor-pointer" onClick={() => toggleItemDone(o.id, i)}>
                             <input type="checkbox" checked={it.isDone} readOnly className="mt-1 w-4 h-4 rounded text-orange-600 focus:ring-orange-500 cursor-pointer pointer-events-none" />
                             <div className="flex-1">
                               <div className="flex justify-between">
                                 <p className={`text-sm font-bold transition-all ${it.isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>{it.qty}x {it.name}</p>
                                 <span className="text-gray-400 font-medium text-[11px] mt-0.5">Rp {(Number(it.qty) * it.price).toLocaleString('id-ID')}</span>
                               </div>
                               <div className="flex gap-2 items-center mt-1">
                                 <span className={`text-[9px] font-bold px-1 rounded ${it.orderType === 'Take Away' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>{it.orderType}</span>
                                 {it.note && <span className="text-[10px] text-red-500 font-medium italic">-{it.note}</span>}
                               </div>
                             </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center mt-3 mb-4 px-1 border-t border-gray-200 pt-3">
                        <span className="text-xs font-black text-gray-400 uppercase">Total Pay:</span>
                        <span className="text-lg font-black text-orange-600">Rp {o.total.toLocaleString('id-ID')}</span>
                      </div>
                      
                      <div className="flex gap-2">
                        {(o.status === 'To Do' || o.status === 'In Progress') && (
                          <button onClick={() => updateStatus(o.id, 'Done')} className="flex-1 bg-green-600 text-white py-3 rounded-xl font-black text-xs">Siap Saji ✅</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* HALAMAN REKAP */}
          {activeTab === 'REKAP' && (
            <div className="max-w-5xl mx-auto">
              <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
                <h2 className="font-black text-4xl tracking-tighter">Laporan <span className="text-orange-600">Duit</span></h2>
                <select value={recapFilter} onChange={e => setRecapFilter(e.target.value as any)} className="bg-white border-4 border-gray-100 p-3 rounded-2xl font-black shadow-sm outline-none w-full md:w-auto">
                  <option value="Hari Ini">Hari Ini</option>
                  <option value="Minggu Ini">Minggu Ini</option>
                  <option value="Semua">Semua Waktu</option>
                </select>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 mb-10">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 text-center flex flex-col items-center"><p className="text-gray-400 font-bold text-[10px] uppercase mb-1 tracking-widest">Total Omzet</p><p className="text-2xl font-black text-green-600">Rp {revenue.toLocaleString('id-ID')}</p></div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 text-center flex flex-col items-center"><p className="text-gray-400 font-bold text-[10px] uppercase mb-1 tracking-widest">Cash</p><p className="text-2xl font-black text-orange-600">Rp {cash.toLocaleString('id-ID')}</p></div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 text-center flex flex-col items-center"><p className="text-gray-400 font-bold text-[10px] uppercase mb-1 tracking-widest">Mandiri</p><p className="text-2xl font-black text-blue-600">Rp {qrisMandiri.toLocaleString('id-ID')}</p></div>
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 text-center flex flex-col items-center"><p className="text-gray-400 font-bold text-[10px] uppercase mb-1 tracking-widest">Gopay</p><p className="text-2xl font-black text-blue-400">Rp {qrisGopay.toLocaleString('id-ID')}</p></div>
              </div>
              
              <div className="overflow-x-auto bg-white rounded-3xl border shadow-sm">
                 <table className="w-full text-left whitespace-nowrap">
                    <thead className="bg-gray-50">
                      <tr className="text-[10px] font-black uppercase text-gray-500 border-b">
                        <th className="p-4 rounded-tl-3xl">Waktu</th>
                        <th className="p-4">Customer</th>
                        <th className="p-4">Metode</th>
                        <th className="p-4 text-right">Total</th>
                        <th className="p-4 text-center rounded-tr-3xl">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recapOrders.map(o => (
                        <tr key={o.id} className="border-b hover:bg-orange-50/30 transition-colors">
                          <td className="p-4 text-xs font-bold text-gray-400">{new Date(o.created_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</td>
                          <td className="p-4 relative group cursor-pointer">
                            <span className="font-black text-sm border-b border-dashed border-gray-400 pb-0.5">{o.customer_name}</span>
                            <div className="absolute left-4 top-full mt-1 w-56 bg-white border border-gray-200 shadow-xl rounded-2xl p-4 z-50 hidden group-hover:flex flex-col gap-1">
                               <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b pb-2 mb-1">Detail Pesanan</p>
                               {o.items.map((it, i) => (<div key={i} className="flex justify-between text-xs font-bold text-gray-700 whitespace-normal"><span>{it.qty}x {it.name}</span><span className="text-gray-400 shrink-0 ml-2">Rp {(Number(it.qty) * it.price).toLocaleString('id-ID')}</span></div>))}
                            </div>
                          </td>
                          <td className="p-4"><span className={`text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap ${o.payment_method.includes('QRIS') ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{o.payment_method}</span></td>
                          <td className="p-4 text-right font-bold text-sm">Rp {o.total.toLocaleString('id-ID')}</td>
                          <td className="p-4 text-center">
                            <button onClick={() => handlePrintOrder(o)} className="text-xl hover:scale-125 transition-transform" title="Print Ulang Nota">🖨️</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                 </table>
              </div>
            </div>
          )}

          {/* HALAMAN MASTER */}
          {activeTab === 'MASTER' && (
            <div className="bg-white p-4 md:p-8 rounded-3xl md:rounded-[40px] shadow-sm border w-full">
              <div className="flex flex-col md:flex-row justify-between items-center mb-6 md:mb-8 gap-4">
                <h2 className="font-black text-3xl tracking-tighter">Manage <span className="text-orange-600">Master Menu</span></h2>
                <div className="w-full md:max-w-xl flex flex-col md:flex-row gap-3">
                   <select value={masterCategoryFilter} onChange={e => setMasterCategoryFilter(e.target.value)} className="bg-gray-50 border-2 border-gray-200 rounded-2xl p-3.5 font-bold outline-none focus:border-orange-600 w-full md:w-1/3 text-sm">
                     <option value="All">Semua Kategori</option>
                     {categories.filter(c => c !== 'All').map(c => ( <option key={c} value={c}>{c}</option> ))}
                   </select>
                   <ModernInput placeholder="🔍 Cari nama menu di sini..." value={masterSearch} onChange={e => setMasterSearch(e.target.value)} className="bg-gray-50 w-full md:w-2/3" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10 bg-gray-50 p-6 rounded-3xl border border-gray-100">
                <div>
                  <label className="text-[10px] font-black uppercase text-gray-500 mb-2 block ml-2">Kategori</label>
                  <select value={newMenuCategory} onChange={e => setNewMenuCategory(e.target.value)} className="w-full bg-white p-3.5 rounded-2xl border-2 border-gray-200 font-bold outline-none focus:border-orange-600">
                     <option>Nasi</option><option>Ala Carte</option><option>Snack</option><option>Minuman</option><option>Tambahan</option><option>Rokok</option><option>Sembako</option>
                  </select>
                </div>
                <div><label className="text-[10px] font-black uppercase text-gray-500 mb-2 block ml-2">Nama Menu</label><ModernInput placeholder="Contoh: Es Teh" value={newMenuName} onChange={e => setNewMenuName(e.target.value)} /></div>
                <div><label className="text-[10px] font-black uppercase text-gray-500 mb-2 block ml-2">Harga</label><ModernInput placeholder="3000" type="number" value={newMenuPrice} onChange={e => setNewMenuPrice(e.target.value)} /></div>
                <div className="flex items-end mt-2 md:mt-0"><button onClick={handleAddMenuToMaster} className="w-full h-[54px] bg-orange-600 text-white font-black rounded-2xl shadow-lg hover:bg-orange-700 active:scale-95 transition-all">Simpan Menu 💾</button></div>
              </div>
              <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100">
                <table className="w-full text-left whitespace-nowrap">
                  <thead className="bg-gray-50">
                    <tr className="border-b-2 text-xs font-black text-gray-400 uppercase select-none">
                      <th className="p-5 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => requestSort('category')}>Category <span className="text-[8px] ml-1">{getSortIcon('category')}</span></th>
                      <th className="p-5 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => requestSort('name')}>Menu Name <span className="text-[8px] ml-1">{getSortIcon('name')}</span></th>
                      <th className="p-5 cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => requestSort('price')}>Price <span className="text-[8px] ml-1">{getSortIcon('price')}</span></th>
                      <th className="p-5 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuList
                      .filter(m => (masterCategoryFilter === 'All' || m.category === masterCategoryFilter) && m.name.toLowerCase().includes(masterSearch.toLowerCase()))
                      .sort((a, b) => {
                        if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
                        if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
                        return 0;
                      })
                      .map(m => (
                      <tr key={m.id} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="p-5"><span className="text-[10px] font-black bg-gray-100 text-gray-600 px-3 py-1 rounded-full uppercase">{m.category}</span></td>
                        <td className="p-5 font-black text-gray-900">
                          {editingMenuId === m.id ? ( <input type="text" className="border-2 border-orange-300 rounded-lg p-1 w-full outline-none font-bold min-w-[150px]" value={editName} onChange={e => setEditName(e.target.value)} /> ) : ( m.name )}
                        </td>
                        <td className="p-5 font-bold text-gray-600">
                          {editingMenuId === m.id ? (
                            <div className="flex gap-2">
                               <input type="number" className="border-2 border-orange-300 rounded-lg p-1 w-24 outline-none font-bold" value={editPrice} onChange={e => setEditPrice(e.target.value)} autoFocus />
                               <button onClick={() => handleUpdateMenu(m.id)} className="bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-black shadow-sm">OK</button>
                               <button onClick={() => setEditingMenuId(null)} className="bg-gray-400 text-white px-2 py-1 rounded-lg text-xs">✕</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                               <span className="text-base">Rp {m.price.toLocaleString('id-ID')}</span>
                               <button onClick={() => { setEditingMenuId(m.id); setEditPrice(m.price.toString()); setEditName(m.name); }} className="text-blue-500 text-[10px] font-black uppercase hover:underline">✏️ Edit</button>
                            </div>
                          )}
                        </td>
                        <td className="p-5 text-center"><button onClick={() => handleDeleteMenuFromMaster(m.id)} className="text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl transition-colors font-black text-xs uppercase">Hapus 🗑️</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* PATCH 6: Notifikasi Status Print ESC/POS Web Bluetooth */}
        {printStatus && (
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl z-[101] flex items-center gap-2">
            <span className="animate-pulse">🖨️</span>
            <span className="font-bold text-sm">{printStatus}</span>
          </div>
        )}

        {/* Notifikasi Toast Biasa */}
        {toastMessage && (
          <div className="fixed bottom-10 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl z-[100] flex items-center gap-2 animate-bounce">
            <span className="font-bold text-sm">{toastMessage}</span>
          </div>
        )}
      </div>
    </>
  );
}