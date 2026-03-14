'use client';
import { useState, useEffect } from 'react';
import { supabase } from './supabase';

// --- CONFIG AESTHETIC GEN Z ---
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

// --- TIPE DATA ---
type MenuItem = { id: string; name: string; price: number; category: string };
type CartItem = MenuItem & { qty: number; note: string; isDone: boolean; isCustom?: boolean; orderType: 'Dine In' | 'Take Away' };
type Order = { 
  id: string; 
  customer_name: string; 
  order_note: string; 
  items: CartItem[]; 
  total: number; 
  status: 'To Do' | 'In Progress' | 'Done';
  payment_method: 'Belum Bayar' | 'Cash' | 'QRIS';
  created_at: string;
};

// PERBAIKAN: Komponen Input di luar fungsi utama agar tidak lose focus
const ModernInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`w-full bg-gray-50 border-gray-200 border-2 ${THEME.secondary} text-base p-3.5 rounded-2xl outline-none focus:border-${THEME.primary} transition-colors placeholder:text-gray-400 ${props.className}`} />
);

export default function KasirWarung() {
  const [activeTab, setActiveTab] = useState<'KASIR' | 'TRACKER' | 'REKAP' | 'MASTER'>('KASIR');
  
  // State Data
  const [menuList, setMenuList] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  
  // State Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [recapFilter, setRecapFilter] = useState<'Hari Ini' | 'Minggu Ini' | 'Semua'>('Hari Ini');

  // FITUR BARU: State Master Menu Edit & Search
  const [masterSearch, setMasterSearch] = useState('');
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');

  // State Kasir
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Belum Bayar' | 'Cash' | 'QRIS'>('Belum Bayar');
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  // State Master Menu Input
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuCategory, setNewMenuCategory] = useState('Nasi');

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- FETCH & REALTIME ---
  useEffect(() => {
    fetchMenus();
    fetchOrders();

    const channel = supabase
      .channel('realtime-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchOrders())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000); // Akan hilang otomatis dalam 3 detik
  };

  const fetchMenus = async () => {
    const { data } = await supabase.from('menus').select('*').order('category', { ascending: true });
    if (data) setMenuList(data);
  };

  const fetchOrders = async () => {
    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (data) setOrders(data);
  };

  // --- FITUR BARU: COPY WA ---
  const copyToClipboard = (order: Order) => {
    const itemText = order.items.map(it => `- ${it.qty}x ${it.name} (Rp ${(it.qty * it.price).toLocaleString('id-ID')})`).join('\n');
    const text = `${itemText}\nTotal Rp ${order.total.toLocaleString('id-ID')}`;
    navigator.clipboard.writeText(text);
    showToast('Pesanan disalin!');
  };

  // --- FUNGSI MASTER MENU ---
  // FITUR BARU: Update Harga
  const handleUpdatePrice = async (id: string) => {
    const { error } = await supabase.from('menus').update({ price: parseInt(editPrice) }).eq('id', id);
    if (!error) {
      setEditingMenuId(null);
      fetchMenus();
    } else {
      showToast('Gagal update harga');
    }
  };

  const handleAddMenuToMaster = async () => {
    if (!newMenuName || !newMenuPrice) return showToast('Nama dan harga menu wajib diisi!');
    const newMenu = { name: newMenuName, price: parseInt(newMenuPrice), category: newMenuCategory };
    const { data, error } = await supabase.from('menus').insert([newMenu]).select();
    if (!error && data) {
      setMenuList([...menuList, data[0]]);
      setNewMenuName(''); setNewMenuPrice('');
    }
  };

  const handleDeleteMenuFromMaster = async (id: string) => {
    if(confirm('Serius mau hapus menu ini?')) {
      const { error } = await supabase.from('menus').delete().eq('id', id);
      if (!error) setMenuList(menuList.filter(m => m.id !== id));
    }
  };

  // --- FUNGSI KASIR ---
  const categories = ['All', ...Array.from(new Set(menuList.map(m => m.category)))];
  
  const filteredMenu = menuList.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = activeCategory === 'All' || m.category === activeCategory;
    return matchSearch && matchCategory;
  });

  const addToCart = (item: MenuItem) => {
    const idx = cart.findIndex(c => c.id === item.id);
    if (idx !== -1) {
      const newCart = [...cart];
      newCart[idx].qty += 1;
      setCart(newCart);
    } else {
      setCart([...cart, { ...item, qty: 1, note: '', isDone: false, orderType: 'Dine In' }]);
    }
  };

  const updateQty = (idx: number, delta: number) => {
    const newCart = [...cart];
    newCart[idx].qty += delta;
    if (newCart[idx].qty <= 0) setCart(newCart.filter((_, i) => i !== idx));
    else setCart(newCart);
  };

  const totalCart = cart.reduce((s, i) => s + (i.price * i.qty), 0);

  const clearKasir = () => {
    setCart([]); setCustomerName(''); setOrderNote(''); setPaymentMethod('Belum Bayar'); setEditingOrderId(null);
  };

  const submitOrder = async () => {
    if (!customerName || cart.length === 0) return showToast('Data belum lengkap!');
    const orderData = {
      customer_name: customerName,
      order_note: orderNote,
      items: cart,
      total: totalCart,
      status: 'To Do',
      payment_method: paymentMethod
    };

    const { error } = editingOrderId 
      ? await supabase.from('orders').update(orderData).eq('id', editingOrderId)
      : await supabase.from('orders').insert([orderData]);

    if (!error) {
      clearKasir();
      setActiveTab('TRACKER');
    } else showToast('Gagal memproses pesanan!');
  };

  // --- FUNGSI TRACKER & REKAP ---
  const updateStatus = async (id: string, s: string) => {
    await supabase.from('orders').update({ status: s }).eq('id', id);
  };

  const updatePayment = async (id: string, p: string) => {
    await supabase.from('orders').update({ payment_method: p }).eq('id', id);
  };

  const deleteOrder = async (id: string) => {
    if (confirm('Batalkan pesanan ini?')) await supabase.from('orders').delete().eq('id', id);
  };

  const toggleItemDone = async (orderId: string, itemIndex: number) => {
    const orderToUpdate = orders.find(o => o.id === orderId);
    if (!orderToUpdate) return;
    const newItems = [...orderToUpdate.items];
    newItems[itemIndex].isDone = !newItems[itemIndex].isDone;
    await supabase.from('orders').update({ items: newItems }).eq('id', orderId);
  };

  // LOGIKA REKAP (TIDAK ADA YANG DIHAPUS)
  const recapOrders = orders.filter(o => {
    const d = new Date(o.created_at);
    const now = new Date();
    if (recapFilter === 'Hari Ini') return d.toDateString() === now.toDateString();
    if (recapFilter === 'Minggu Ini') return d >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return true;
  });

  const revenue = recapOrders.filter(o => o.payment_method !== 'Belum Bayar').reduce((s, o) => s + o.total, 0);
  const cash = recapOrders.filter(o => o.payment_method === 'Cash').reduce((s, o) => s + o.total, 0);
  const qris = recapOrders.filter(o => o.payment_method === 'QRIS').reduce((s, o) => s + o.total, 0);

  return (
    <div className={`min-h-screen ${THEME.bg} ${THEME.secondary} font-sans pb-10`}>
      {/* HEADER NAVBAR */}
      <div className="bg-white/90 backdrop-blur-md sticky top-0 z-50 p-4 border-b border-gray-100 mb-6 shadow-sm">
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
        {/* --- HALAMAN KASIR --- */}
        {activeTab === 'KASIR' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
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

            <div className={`xl:col-span-4 bg-white p-6 rounded-3xl border shadow-sm h-fit xl:sticky top-28`}>
              <h2 className="font-extrabold text-2xl mb-6 border-b pb-4 flex justify-between items-center">
                <span>Check <span className="text-orange-600">Order</span></span>
                {editingOrderId && <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1 rounded-full animate-pulse">Edit Mode</span>}
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
                        <p className="text-sm text-gray-600 font-semibold mt-1">Rp {(item.price * item.qty).toLocaleString('id-ID')}</p>
                      </div>
                      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-1 py-1 shadow-sm shrink-0">
                        <button onClick={() => updateQty(idx, -1)} className="text-gray-500 hover:text-orange-600 font-extrabold w-6 h-6 flex items-center justify-center">-</button>
                        <span className="font-bold text-sm w-4 text-center">{item.qty}</span>
                        <button onClick={() => updateQty(idx, 1)} className="text-gray-500 hover:text-orange-600 font-extrabold w-6 h-6 flex items-center justify-center">+</button>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3 items-center">
                      <select value={item.orderType} onChange={e => { const n = [...cart]; n[idx].orderType = e.target.value as any; setCart(n); }} className={`text-[10px] font-bold p-2 rounded-xl outline-none cursor-pointer border ${item.orderType === 'Take Away' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                        <option value="Dine In">🍽 Makan Sini</option><option value="Take Away">🛍 Bungkus</option>
                      </select>
                      <input placeholder="Catatan item..." className="w-full bg-white border border-gray-200 p-2 rounded-xl text-xs outline-none focus:border-red-400" value={item.note} onChange={e => { const n = [...cart]; n[idx].note = e.target.value; setCart(n); }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-orange-50 p-4 rounded-2xl mb-6 flex justify-between items-center border border-orange-100">
                <span className="text-sm font-bold text-orange-800">Metode Bayar:</span>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as any)} className="text-sm font-bold p-1 rounded-lg border-2 border-orange-200 outline-none">
                  <option value="Belum Bayar">⏳ Nanti</option><option value="Cash">💵 Cash</option><option value="QRIS">📱 QRIS</option>
                </select>
              </div>

              <div className="border-t pt-5">
                <div className="flex justify-between items-end text-3xl font-black mb-6 tracking-tighter">
                  <span className="text-base text-gray-500 font-bold">Total Pay:</span><span className="text-orange-600">Rp {totalCart.toLocaleString('id-ID')}</span>
                </div>
                <div className="flex gap-2">
                   {editingOrderId && <button onClick={clearKasir} className="bg-gray-100 text-gray-500 font-bold px-4 rounded-2xl hover:bg-gray-200">Cancel</button>}
                   <button onClick={submitOrder} className="flex-1 bg-orange-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all">
                    {editingOrderId ? 'Update Pesanan 🔄' : 'Kirim ke Dapur ✅'}
                   </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- HALAMAN TRACKER (DAPUR) --- */}
        {activeTab === 'TRACKER' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {(['To Do', 'In Progress', 'Done'] as const).map(status => (
              <div key={status} className="bg-white p-6 rounded-3xl border min-h-[60vh] shadow-sm">
                <h3 className="font-black text-xl mb-6 border-b pb-4 flex justify-between items-center">
                  {status === 'To Do' ? '📝 Antrean' : status === 'In Progress' ? '🍳 Dimasak' : '✅ Selesai'}
                  <span className="bg-orange-100 text-orange-600 px-3 rounded-full text-sm">
                    {orders.filter(o => {
                      if (status !== 'Done') return o.status === status;
                      return o.status === 'Done' && new Date(o.created_at).toDateString() === new Date().toDateString();
                    }).length}
                  </span>
                </h3>
                {orders
                  .filter(o => {
                    // FILTER SELESAI: Hanya yang hari ini
                    if (status !== 'Done') return o.status === status;
                    return o.status === 'Done' && new Date(o.created_at).toDateString() === new Date().toDateString();
                  })
                  .map(o => (
                  <div key={o.id} className="bg-gray-50 p-5 rounded-3xl border border-gray-100 mb-5 relative group shadow-sm">
                    
                    {/* Tombol Edit, Batal, dan Copy WA ditumpuk di kanan atas */}
                    <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingOrderId(o.id); setCustomerName(o.customer_name); setCart(o.items); setOrderNote(o.order_note); setPaymentMethod(o.payment_method); setActiveTab('KASIR'); }} className="text-[10px] bg-yellow-500 text-white px-2 py-1 rounded-lg font-bold">Edit</button>
                        <button onClick={() => deleteOrder(o.id)} className="text-[10px] bg-red-600 text-white px-2 py-1 rounded-lg font-bold">Batal</button>
                      </div>
                      <button onClick={() => copyToClipboard(o)} className="bg-green-100 text-green-700 px-2 py-1 rounded-lg font-black text-[10px] hover:bg-green-200 transition-colors shrink-0">📋 COPY WA</button>
                    </div>
                    
                    {/* Nama Customer */}
                    <div className="flex justify-between items-start mb-2 pr-20">
                      <p className="font-black text-xl text-gray-900 leading-tight">{o.customer_name}</p>
                    </div>

                    <select value={o.payment_method} onChange={e => updatePayment(o.id, e.target.value)} className={`text-[10px] font-bold p-1 rounded-lg border mt-2 mb-4 outline-none ${o.payment_method === 'Belum Bayar' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                       <option value="Belum Bayar">Belum Lunas</option><option value="Cash">Lunas (Cash)</option><option value="QRIS">Lunas (QRIS)</option>
                    </select>
                    
                    <div className="space-y-2 mb-5 bg-white p-3 rounded-xl border border-gray-100">
                      {o.items.map((it, i) => (
                        <div key={i} className="flex items-start gap-2">
                           <input type="checkbox" checked={it.isDone} onChange={() => toggleItemDone(o.id, i)} className="mt-1 w-4 h-4 rounded text-orange-600 focus:ring-orange-500" />
                           <div className="flex-1">
                             <div className="flex justify-between">
                               <p className={`text-sm font-bold ${it.isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>{it.qty}x {it.name}</p>
                               {/* FITUR BARU: Harga per item di dapur */}
                               <span className="text-gray-400 font-medium text-[11px] mt-0.5">Rp {(it.qty * it.price).toLocaleString('id-ID')}</span>
                             </div>
                             <div className="flex gap-2 items-center mt-1">
                               <span className={`text-[9px] font-bold px-1 rounded ${it.orderType === 'Take Away' ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'}`}>{it.orderType}</span>
                               {it.note && <span className="text-[10px] text-red-500 font-medium italic">-{it.note}</span>}
                             </div>
                           </div>
                        </div>
                      ))}
                    </div>

                    {/* FITUR BARU: Total Harga di dapur */}
                    <div className="flex justify-between items-center mt-3 mb-4 px-1 border-t border-gray-200 pt-3">
                       <span className="text-xs font-black text-gray-400 uppercase">Total Pay:</span>
                       <span className="text-lg font-black text-orange-600">Rp {o.total.toLocaleString('id-ID')}</span>
                    </div>

                    <div className="flex gap-2">
                      {status === 'To Do' && <button onClick={() => updateStatus(o.id, 'In Progress')} className="flex-1 bg-orange-600 text-white py-3 rounded-xl font-black text-xs">Gas Masak 🔥</button>}
                      {status === 'In Progress' && <button onClick={() => updateStatus(o.id, 'Done')} className="flex-1 bg-green-600 text-white py-3 rounded-xl font-black text-xs">Siap Saji ✅</button>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* --- HALAMAN REKAP --- */}
        {activeTab === 'REKAP' && (
          <div className="max-w-5xl mx-auto">
            <div className="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
              <h2 className="font-black text-4xl tracking-tighter">Laporan <span className="text-orange-600">Duit</span></h2>
              <select value={recapFilter} onChange={e => setRecapFilter(e.target.value as any)} className="bg-white border-4 border-gray-100 p-3 rounded-2xl font-black shadow-sm outline-none">
                <option value="Hari Ini">Hari Ini</option><option value="Minggu Ini">Minggu Ini</option><option value="Semua">Semua Waktu</option>
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
              <div className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 text-center flex flex-col items-center">
                <p className="text-gray-400 font-bold text-xs uppercase mb-2 tracking-widest">Total Omzet</p>
                <p className="text-3xl font-black text-green-600">Rp {revenue.toLocaleString('id-ID')}</p>
              </div>
              <div className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 text-center flex flex-col items-center">
                <p className="text-gray-400 font-bold text-xs uppercase mb-2 tracking-widest">Via QRIS</p>
                <p className="text-3xl font-black text-blue-600">Rp {qris.toLocaleString('id-ID')}</p>
              </div>
              <div className="bg-white p-8 rounded-[40px] shadow-sm border border-gray-100 text-center flex flex-col items-center">
                <p className="text-gray-400 font-bold text-xs uppercase mb-2 tracking-widest">Via Cash</p>
                <p className="text-3xl font-black text-orange-600">Rp {cash.toLocaleString('id-ID')}</p>
              </div>
            </div>
            <div className="bg-white rounded-3xl border overflow-hidden shadow-sm">
               <table className="w-full text-left">
                  <thead className="bg-gray-50"><tr className="text-[10px] font-black uppercase text-gray-500"><th className="p-4">Waktu</th><th className="p-4">Customer</th><th className="p-4">Metode</th><th className="p-4 text-right">Total</th></tr></thead>
                  <tbody>
                    {recapOrders.map(o => (
                      <tr key={o.id} className="border-b hover:bg-orange-50/30 transition-colors">
                        <td className="p-4 text-xs font-bold text-gray-400">{new Date(o.created_at).toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'})}</td>
                        <td className="p-4 font-black text-sm">{o.customer_name}</td>
                        <td className="p-4"><span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${o.payment_method === 'QRIS' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{o.payment_method}</span></td>
                        <td className="p-4 text-right font-bold text-sm">Rp {o.total.toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
               </table>
            </div>
          </div>
        )}

        {/* --- HALAMAN MASTER --- */}
        {activeTab === 'MASTER' && (
          <div className="bg-white p-8 rounded-[40px] shadow-sm border w-full">
            {/* FITUR BARU: Search Master Menu */}
            <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
              <h2 className="font-black text-3xl tracking-tighter">Manage <span className="text-orange-600">Master Menu</span></h2>
              <div className="w-full md:max-w-md">
                 <ModernInput placeholder="🔍 Cari nama menu di sini..." value={masterSearch} onChange={e => setMasterSearch(e.target.value)} className="bg-gray-50" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10 bg-gray-50 p-6 rounded-3xl border border-gray-100">
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500 mb-2 block ml-2">Kategori</label>
                <select value={newMenuCategory} onChange={e => setNewMenuCategory(e.target.value)} className="w-full bg-white p-3.5 rounded-2xl border-2 border-gray-200 font-bold outline-none focus:border-orange-600">
                   <option>Nasi</option><option>Ala Carte</option><option>Snack</option><option>Minuman</option><option>Tambahan</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500 mb-2 block ml-2">Nama Menu</label>
                <ModernInput placeholder="Contoh: Es Teh" value={newMenuName} onChange={e => setNewMenuName(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-gray-500 mb-2 block ml-2">Harga</label>
                <ModernInput placeholder="3000" type="number" value={newMenuPrice} onChange={e => setNewMenuPrice(e.target.value)} />
              </div>
              <div className="flex items-end">
                <button onClick={handleAddMenuToMaster} className="w-full h-[54px] bg-orange-600 text-white font-black rounded-2xl shadow-lg hover:bg-orange-700 active:scale-95 transition-all">Simpan Menu 💾</button>
              </div>
            </div>
            <div className="overflow-x-auto bg-white rounded-2xl border border-gray-100">
              <table className="w-full text-left">
                <thead className="bg-gray-50"><tr className="border-b-2 text-xs font-black text-gray-400 uppercase"><th className="p-5">Category</th><th className="p-5">Menu Name</th><th className="p-5">Price</th><th className="p-5 text-center">Action</th></tr></thead>
                <tbody>
                  {/* FITUR BARU: Filter masterSearch sebelum map */}
                  {menuList
                    .filter(m => m.name.toLowerCase().includes(masterSearch.toLowerCase()))
                    .sort((a,b) => a.category.localeCompare(b.category))
                    .map(m => (
                    <tr key={m.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="p-5"><span className="text-[10px] font-black bg-gray-100 text-gray-600 px-3 py-1 rounded-full uppercase">{m.category}</span></td>
                      <td className="p-5 font-black text-gray-900">{m.name}</td>
                      <td className="p-5 font-bold text-gray-600">
                        {/* FITUR BARU: Conditional Render untuk Edit Harga */}
                        {editingMenuId === m.id ? (
                          <div className="flex gap-2">
                             <input type="number" className="border-2 border-orange-300 rounded-lg p-1 w-24 outline-none font-bold" value={editPrice} onChange={e => setEditPrice(e.target.value)} autoFocus />
                             <button onClick={() => handleUpdatePrice(m.id)} className="bg-green-500 text-white px-3 py-1 rounded-lg text-xs font-black shadow-sm">OK</button>
                             <button onClick={() => setEditingMenuId(null)} className="bg-gray-400 text-white px-2 py-1 rounded-lg text-xs">✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                             <span className="text-base">Rp {m.price.toLocaleString('id-ID')}</span>
                             <button onClick={() => { setEditingMenuId(m.id); setEditPrice(m.price.toString()); }} className="text-blue-500 text-[10px] font-black uppercase hover:underline">✏️ Edit</button>
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
    </div>
  );
}