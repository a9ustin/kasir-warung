import { NextResponse } from 'next/server';
import { supabase } from '../../supabase'; 

export async function GET() {
  try {
    const { data, error } = await supabase.from('menus').select('id').limit(1);

    if (error) throw error;

    return NextResponse.json({ 
      status: 'Sukses!', 
      message: 'Supabase Kedai Bu Sabar Keep Alive 👀',
      time: new Date().toISOString()
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({ status: 'Error', error: error.message }, { status: 500 });
  }
}