import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxhrcdpzvwevvqkwaaus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4aHJjZHB6dndldnZxa3dhYXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzcxMTQsImV4cCI6MjA5NjMxMzExNH0.qX-mYTvleNW-rGjqXISHNpx2Sar7ujsmWeRw3j9P2xo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function POST(request) {
  try {
    const { email, token } = await request.json();

    let res = await supabase.auth.verifyOtp({ email, token, type: 'magiclink' });
    if (res.error) res = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    if (res.error) res = await supabase.auth.verifyOtp({ email, token, type: 'login' });

    if (res.error) {
      console.error('OTP Verification Error:', res.error);
      return NextResponse.json({ success: false, error: res.error.message }, { status: 400 });
    }

    // Load or create profile
    const profileResponse = await supabase.from('profiles').select('*').eq('email', email).maybeSingle();
    let cloudProfile = profileResponse.data;

    if (!cloudProfile) {
      const newId = 'u' + Math.random().toString(36).substr(2, 9);
      cloudProfile = { id: newId, name: email.split('@')[0], avatar: '👋', email: email, is_searchable: true };
      const { error: insertErr } = await supabase.from('profiles').insert(cloudProfile);
      if (insertErr) {
        console.error('Failed to create user profile:', insertErr);
      }
    }

    return NextResponse.json({ 
      success: true, 
      profile: cloudProfile, 
      session: res.data.session 
    });
  } catch (err) {
    console.error('OTP Verification Exception:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
