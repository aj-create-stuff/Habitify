import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rxhrcdpzvwevvqkwaaus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4aHJjZHB6dndldnZxa3dhYXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzcxMTQsImV4cCI6MjA5NjMxMzExNH0.qX-mYTvleNW-rGjqXISHNpx2Sar7ujsmWeRw3j9P2xo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function POST(request) {
  try {
    const { toEmail, htmlBody } = await request.json();

    if (!toEmail || !htmlBody) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    // Fetch SMTP configurations securely from Supabase database
    const { data: smtpConfig, error: dbErr } = await supabase
      .from('smtp_config')
      .select('*')
      .single();

    if (dbErr || !smtpConfig || Object.keys(smtpConfig).length === 0) {
      return NextResponse.json(
        { success: false, error: 'SMTP Configuration is empty or not found in your Supabase database table "smtp_config". Please ensure a row exists with your host, port, email, and password.' },
        { status: 500 }
      );
    }

    // Set up nodemailer transporter using credentials retrieved securely from the DB
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host || 'smtp.gmail.com',
      port: parseInt(smtpConfig.port) || 587,
      secure: parseInt(smtpConfig.port) === 465, // true for 465, false for 587 or other ports
      auth: {
        user: smtpConfig.email,
        pass: smtpConfig.password, // App Password / Password
      },
    });

    const mailOptions = {
      from: `"Habitify Stats" <${smtpConfig.email}>`,
      to: toEmail,
      subject: 'Habitify Stats Report',
      html: htmlBody,
    };

    // Send email using server-side SMTP
    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('SMTP server-side email send error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
