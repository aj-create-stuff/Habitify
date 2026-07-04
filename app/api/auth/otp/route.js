import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxhrcdpzvwevvqkwaaus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4aHJjZHB6dndldnZxa3dhYXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzcxMTQsImV4cCI6MjA5NjMxMzExNH0.qX-mYTvleNW-rGjqXISHNpx2Sar7ujsmWeRw3j9P2xo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function POST(request) {
  try {
    const { email } = await request.json();
    const { error } = await supabase.auth.signInWithOtp({ 
      email,
      options: {
        shouldCreateUser: true
      }
    });

    if (error) {
      console.error('OTP Send Error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('OTP Request Exception:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
