"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameDay, 
  isFuture, 
  addMonths, 
  subMonths, 
  getDay, 
  isToday 
} from 'date-fns';
import { createClient } from '@supabase/supabase-js';

// --- STORAGE ENGINE ---
const STORAGE = {
    save: function(key, val) {
        if (typeof window === 'undefined') return;
        var str = JSON.stringify(val);
        if (window.Android && typeof window.Android.saveData === 'function') {
            try { window.Android.saveData(key, str); } catch(e) { console.error("Android integration failed:", e); }
        }
        localStorage.setItem(key, str);
    },
    load: function(key, def) {
        if (typeof window === 'undefined') return def;
        var data = localStorage.getItem(key);
        if (window.Android && typeof window.Android.loadData === 'function') {
            try { data = window.Android.loadData(key, data || JSON.stringify(def)); } catch(e) { console.error("Android integration failed:", e); }
        }
        try { return data ? JSON.parse(data) : def; } catch(e) { return def; }
    }
};

// --- MATH ENGINE ---
function getDayOfYear() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
};

function calculatePerformance(habit, logs) {
    var currentDay = Math.max(1, getDayOfYear());
    var actual = (logs || []).filter(function(l) { return l.habitId === habit.id; }).length;
    var expected = (habit.target / 365) * currentDay;
    var delta = actual - expected;

    var status = 'On Track';
    var color = 'text-blue-600';
    var bg = 'bg-blue-50';

    if (habit.type === 'do') {
        if (delta > 2) { status = 'Ahead'; color = 'text-emerald-600'; bg = 'bg-emerald-50'; }
        else if (delta < -2) { status = 'Lagging'; color = 'text-rose-600'; bg = 'bg-rose-50'; }
    } else {
        if (delta > 1) { status = 'Over Limit'; color = 'text-rose-600'; bg = 'bg-rose-50'; }
        else if (delta < -1) { status = 'Safe'; color = 'text-emerald-600'; bg = 'bg-emerald-50'; }
    }
    return { actual: actual, delta: Math.abs(delta).toFixed(1), status: status, color: color, bg: bg, percent: (actual/habit.target) };
};

function migrateHabits(list) {
    if (!list) list = [];
    var migrated = false;
    var newList = list.map(function(h) {
        var nameLower = (h.name || '').toLowerCase();
        if ((nameLower.indexOf('exercise') !== -1 || nameLower.indexOf('excercise') !== -1) && nameLower.indexOf('60 mins') !== -1) {
            h.name = 'Exercise Daily';
            migrated = true;
        }
        return h;
    });
    if (newList.length === 0) {
        newList = [{id: 'default_exercise', name: 'Exercise Daily', target: 365, type: 'do', shared: true}];
        migrated = true;
    }
    if (migrated) {
        setTimeout(function() { STORAGE.save('hab_v6_list', newList); }, 0);
    }
    return newList;
}

// --- SUPABASE CONFIG ---
const SUPABASE_URL = 'https://rxhrcdpzvwevvqkwaaus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4aHJjZHB6dndldnZxa3dhYXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzcxMTQsImV4cCI6MjA5NjMxMzExNH0.qX-mYTvleNW-rGjqXISHNpx2Sar7ujsmWeRw3j9P2xo';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const Page = () => {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    const [isAuth, setIsAuth] = useState(function() { return !!STORAGE.load('hab_v6_email', ''); });
    const [habits, setHabits] = useState(function() {
        return migrateHabits(STORAGE.load('hab_v6_list', []));
    });
    const [logs, setLogs] = useState(function() { return STORAGE.load('hab_v6_logs', []); });
    const [friends, setFriends] = useState(function() { return STORAGE.load('hab_v6_friends', []); });
    const [profile, setProfile] = useState(function() { return STORAGE.load('hab_v6_profile', {
        id: '', name: 'New User', avatar: '👋', email: '', is_searchable: true
    }); });
    const [view, setView] = useState('home');
    const [showAdd, setShowAdd] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [viewingHabit, setViewingHabit] = useState(null);
    const [adoptingHabitName, setAdoptingHabitName] = useState(null);
    const [installPrompt, setInstallPrompt] = useState(null);

    // Track PWA install prompt & Register Service Worker
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js').then(
                    function(reg) { console.log('SW success:', reg.scope); },
                    function(err) { console.error('SW failed:', err); }
                );
            });
        }
        const handleBeforeInstall = (e) => {
            e.preventDefault();
            setInstallPrompt(e);
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstall);
        return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    }, []);

    useEffect(function() { STORAGE.save('hab_v6_list', habits); if(isAuth) syncWithSupabase(); }, [habits]);
    useEffect(function() { STORAGE.save('hab_v6_logs', logs); if(isAuth) syncWithSupabase(); }, [logs]);
    useEffect(function() { STORAGE.save('hab_v6_friends', friends); if(isAuth) syncWithSupabase(); }, [friends]);
    useEffect(function() { STORAGE.save('hab_v6_profile', profile); if(isAuth) syncWithSupabase(); }, [profile]);
    useEffect(function() { if(profile.email) STORAGE.save('hab_v6_email', profile.email); }, [profile.email]);

    // Auto-Restore Session
    useEffect(function() {
        async function handleAuth() {
            var sessionResponse = await supabase.auth.getSession();
            var session = sessionResponse.data.session;
            if (session && session.user && session.user.email) {
                var cloudProfileResponse = await supabase.from('profiles').select('*').eq('email', session.user.email).single();
                var cloudProfile = cloudProfileResponse.data;
                if (cloudProfile) {
                    setProfile(cloudProfile);
                    setIsAuth(true);
                    if (habits.length === 0) setHabits(migrateHabits(cloudProfile.habits_data || []));
                    if (logs.length === 0) setLogs(cloudProfile.logs_data || []);
                    if (friends.length === 0 && cloudProfile.friends_data) setFriends(cloudProfile.friends_data);
                }
            }
        }
        handleAuth();
    }, []);

    async function syncWithSupabase() {
        if (!profile.email) return;
        var totalPerf = habits.length > 0 ? habits.reduce(function(acc, h) { return acc + calculatePerformance(h, logs).percent; }, 0) / habits.length : 0;
        var stats = {};
        habits.forEach(function(h) {
            var p = calculatePerformance(h, logs);
            stats[h.name] = { actual: p.actual, target: h.target, percent: p.percent, is_shared: h.shared !== false };
        });
        
        var payload = {
            id: profile.id, name: profile.name, avatar: profile.avatar, email: profile.email,
            is_searchable: profile.is_searchable !== false,
            habits: habits.filter(function(h) { return h.shared !== false; }).map(function(h) { return h.name; }),
            habit_stats: stats, performance: totalPerf, habits_data: habits, logs_data: logs, updated_at: new Date()
        };

        try {
            payload.friends_data = friends;
            const { error } = await supabase.from('profiles').upsert(payload);
            if (error) {
                if (error.message.includes('friends_data') || error.code === '42703') {
                    // Fallback to query without friends_data
                    delete payload.friends_data;
                    await supabase.from('profiles').upsert(payload);
                    console.warn("friends_data column is missing in Supabase. Run: ALTER TABLE profiles ADD COLUMN friends_data JSONB;");
                } else {
                    console.error("Supabase Sync Error:", error);
                }
            }
        } catch (e) {
            console.error("Sync Error:", e);
        }
    }

    function logToday(id, date) {
        var targetDate = date ? (typeof date === 'string' ? date : format(date, 'yyyy-MM-dd')) : format(new Date(), 'yyyy-MM-dd');
        var exists = logs.find(function(l) { return l.habitId === id && l.date === targetDate; });
        if (exists) setLogs(logs.filter(function(l) { return l !== exists; }));
        else setLogs([...logs, { habitId: id, date: targetDate }]);
    }

    const triggerInstall = async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') {
            setInstallPrompt(null);
        }
    };

    if (!mounted) {
        return <div className="min-h-screen bg-white" />;
    }

    if (!isAuth) {
        return <LoginScreen onAuth={function(fullProfile) {
            setProfile(fullProfile);
            setHabits(migrateHabits(fullProfile.habits_data || []));
            setLogs(fullProfile.logs_data || []);
            setIsAuth(true);
        }} />;
    }

    return (
        <div className="min-h-screen pb-32">
            <header className="glass-header sticky top-0 z-30 p-6 flex justify-between items-end border-b border-slate-100/50">
                <div className="flex items-center gap-4">
                    <button onClick={function() { setShowProfile(true); }} className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-slate-100 active:scale-90 transition-all relative overflow-hidden">
                         <div className="absolute inset-0 bg-emerald-500/10"></div>
                         {profile.avatar}
                    </button>
                    <div>
                        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tighter logo-gradient flex items-center gap-2">
                            <img src="/logo.png" className="w-10 h-10 object-contain" alt="logo" onError={function(e){e.target.style.display='none';}} />
                            Habitify
                        </h1>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                            {view === 'home' ? profile.name : 'Community'}
                        </p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    {installPrompt && (
                        <button onClick={triggerInstall} className="bg-emerald-100 text-emerald-700 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider active:scale-90 transition-all">
                            📥 Install App
                        </button>
                    )}
                    {view === 'home' ? (
                        <button onClick={function() { setShowAdd(true); }} className="bg-emerald-600 text-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl shadow-emerald-100 active:scale-90 transition-all">
                            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M14 6v16M6 14h16"/></svg>
                        </button>
                    ) : (
                        <button onClick={function() { setShowSearch(true); }} className="bg-slate-900 text-white w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl shadow-slate-200 active:scale-90 transition-all">
                            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </button>
                    )}
                </div>
            </header>

            <main className="p-6 max-w-2xl mx-auto space-y-12 fade-in">
                {view === 'home' ? (
                    <HabitList habits={habits} logs={logs} onLog={logToday} onSelect={setViewingHabit} />
                ) : (
                    <SocialList profile={profile} friends={friends} habits={habits} logs={logs} onRemoveFriend={function(id) { setFriends(friends.filter(function(f) { return f.id !== id; })); }} onAdopt={setAdoptingHabitName} />
                )}
            </main>

            <nav className="fixed bottom-0 inset-x-0 h-24 bottom-nav flex items-center justify-around px-8 z-40 max-w-2xl mx-auto rounded-t-[2.5rem]">
                <button onClick={function() { setView('home'); }} className={`flex flex-col items-center gap-1 transition-all ${view === 'home' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
                    <svg width="28" height="28" fill="currentColor"><path d="M12 3L4 9v12h5v-7h6v7h5V9l-8-6z"/></svg>
                    <span className="text-[10px] font-bold uppercase tracking-tighter">My Stats</span>
                </button>
                <button onClick={function() { setView('social'); }} className={`flex flex-col items-center gap-1 transition-all ${view === 'social' ? 'text-emerald-600 scale-110' : 'text-slate-300'}`}>
                    <div className="relative">
                        <svg width="28" height="28" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                        {friends.length > 0 && <div className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-white"></div>}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-tighter">Social</span>
                </button>
            </nav>

            {showAdd && <AddModal onSave={function(h) { setHabits([...habits, h]); }} onClose={function() { setShowAdd(false); }} />}
            {adoptingHabitName && <AddModal initialName={adoptingHabitName} onSave={function(h) { setHabits([...habits, h]); setAdoptingHabitName(null); }} onClose={function() { setAdoptingHabitName(null); }} />}
            {showSearch && <SearchModal friends={friends} profile={profile} onAdd={function(u) { if (!friends.find(function(f) { return f.id === u.id; })) setFriends([...friends, u]); }} onClose={function() { setShowSearch(false); }} />}
            {showProfile && <ProfileModal profile={profile} habits={habits} logs={logs} friends={friends} installPrompt={installPrompt} triggerInstall={triggerInstall} onSave={setProfile} onSwitch={function(p, h, l) { setProfile(p); setHabits(h); setLogs(l); }} onClose={function() { setShowProfile(false); }} />}
            {viewingHabit && <CalendarModal habit={viewingHabit} logs={logs} onClose={function() { setViewingHabit(null); }}
                onToggle={logToday}
                onUpdate={function(updated) { setHabits(habits.map(function(h) { return h.id === updated.id ? updated : h; })); setViewingHabit(updated); }}
                onDelete={function(id) { if(window.confirm("Delete?")) { setHabits(habits.filter(function(h) { return h.id !== id; })); setViewingHabit(null); } }}
            />}
        </div>
    );
};

const LoginScreen = (props) => {
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [step, setStep] = useState('email');
    const [loading, setLoading] = useState(false);

    async function handleSendCode() {
        if (!email.includes('@')) { alert("Invalid email"); return; }
        setLoading(true);
        try {
            const res = await fetch('/api/auth/otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            setLoading(false);
            if (res.ok && data.success) {
                setStep('otp');
            } else {
                alert(data.error || "Failed to send code");
            }
        } catch (e) {
            setLoading(false);
            alert("Network error. Please try again.");
            console.error(e);
        }
    }

    async function handleVerify() {
        if (otp.length < 6) { alert("Enter code"); return; }
        setLoading(true);
        try {
            const res = await fetch('/api/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, token: otp })
            });
            const data = await res.json();
            setLoading(false);
            if (res.ok && data.success) {
                if (data.session) {
                    await supabase.auth.setSession(data.session);
                }
                props.onAuth(data.profile);
            } else {
                alert(data.error || "Failed to verify code");
            }
        } catch (e) {
            setLoading(false);
            alert("Network error. Please try again.");
            console.error(e);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-white">
            <div className="w-full max-w-md space-y-12 fade-in text-center">
                <div className="w-24 h-24 bg-emerald-50 rounded-[2.5rem] mx-auto flex items-center justify-center shadow-xl shadow-emerald-100">
                    <img src="/logo.png" className="w-12 h-12 object-contain" alt="logo" onError={function(e){e.target.style.display='none';}} />
                </div>
                <div className="space-y-2">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Habitify</h2>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed">
                        {step === 'email' 
                            ? 'New or existing user? Enter your email ID below to sign up or log in with a secure one-time code.' 
                            : 'Check your inbox for the secure verification code.'}
                    </p>
                </div>

                <div className="space-y-4">
                    {step === 'email' ? (
                        <div className="space-y-4">
                            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="name@example.com" className="w-full p-6 bg-slate-50 border-2 border-transparent focus:border-emerald-100 rounded-3xl outline-none font-bold text-slate-800 text-center" />
                            <button disabled={loading} onClick={handleSendCode} className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-xl">
                                {loading ? 'Sending Code...' : 'Get Login Code'}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <input value={otp} onChange={e => setOtp(e.target.value)} type="text" placeholder="Enter Code" className="w-full p-6 bg-slate-50 border-2 border-transparent focus:border-emerald-100 rounded-3xl outline-none font-black text-3xl text-slate-800 text-center tracking-[0.2em]" />
                            <button disabled={loading} onClick={handleVerify} className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-xl">
                                {loading ? 'Verifying...' : 'Login & Restore'}
                            </button>
                            <button onClick={() => setStep('email')} className="w-full py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">Resend or Change Email</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const HabitList = (props) => (
    <React.Fragment>
        {props.habits.length === 0 && (
            <div className="text-center py-20 space-y-4">
                <div className="w-20 h-20 bg-emerald-50 rounded-3xl mx-auto flex items-center justify-center text-4xl animate-bounce text-emerald-600 font-black">H</div>
                <h2 className="text-xl font-bold text-slate-800">Start tracking today</h2>
            </div>
        )}
        {props.habits.map(function(h) {
            return <HabitItem key={h.id} habit={h} logs={props.logs} onLog={function() { props.onLog(h.id); }} onClick={function() { props.onSelect(h); }} />;
        })}
    </React.Fragment>
);

const SocialList = (props) => {
    const [friendEmail, setFriendEmail] = useState('');
    const [inviting, setInviting] = useState(false);

    const handleEmailInvite = async () => {
        if (!friendEmail || !friendEmail.includes('@')) {
            alert('Please enter a valid email address.');
            return;
        }
        setInviting(true);
        try {
            const inviteLink = "https://habitify-pearl.vercel.app";
            const htmlBody = `<div style="font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif; background-color: #f8fafc; padding: 32px 24px; border-radius: 32px; max-width: 600px; margin: 0 auto; color: #1e293b; border: 1px solid #e2e8f0; text-align: center;">` +
                `<div style="text-align: center; margin-bottom: 20px;"><span style="font-size: 28px; font-weight: 800; color: #10b981; letter-spacing: -1px;">Habitify Social</span></div>` +
                `<h3 style="margin: 20px 0 8px 0; font-size: 20px; font-weight: 800; color: #0f172a;">You have been invited!</h3>` +
                `<p style="margin: 0 0 24px 0; font-size: 14px; color: #64748b; font-weight: 500; line-height: 1.6;">` +
                    `Your friend <strong>${props.profile.name}</strong> (${props.profile.email}) wants to track habits and compare progress with you on Habitify!` +
                `</p>` +
                `<div style="margin: 24px 0;"><a href="${inviteLink}" style="background-color: #10b981; color: #ffffff; padding: 16px 32px; border-radius: 16px; font-weight: bold; text-decoration: none; display: inline-block; font-size: 14px;">Join Habitify Now 🚀</a></div>` +
                `<div style="text-align: center; margin-top: 32px; font-size: 10px; color: #94a3b8; font-weight: 600;">` +
                    `Sent securely via Habitify App` +
                `</div>` +
            `</div>`;

            const response = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    toEmail: friendEmail,
                    htmlBody: htmlBody
                })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                alert("Invitation email sent successfully!");
                setFriendEmail('');
            } else {
                alert("Failed to send invite: " + (result.error || "Unknown error"));
            }
        } catch (err) {
            console.error(err);
            alert("Error sending invite: " + err.message);
        }
        setInviting(false);
    };

    const handleWhatsAppShare = () => {
        const inviteLink = "https://habitify-pearl.vercel.app";
        const message = `Hey! Join me on Habitify to track habits together and compete on the leaderboard! ${inviteLink}`;
        const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    var myPerformance = props.habits.length > 0 ? props.habits.reduce(function(acc, h) { return acc + calculatePerformance(h, props.logs).percent; }, 0) / props.habits.length : 0;
    
    var leaderboard = [
        {
            id: props.profile.id,
            name: props.profile.name + " (You)",
            avatar: props.profile.avatar,
            performance: myPerformance,
            isMe: true
        },
        ...props.friends.map(function(f) {
            return {
                id: f.id,
                name: f.name,
                avatar: f.avatar,
                performance: f.performance || 0,
                isMe: false
            };
        })
    ].sort(function(a, b) { return b.performance - a.performance; });

    return (
        <div className="space-y-8">
            {/* Leaderboard */}
            <div className="bg-slate-900 text-white p-6 rounded-[2.5rem] shadow-xl space-y-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="font-black text-xl tracking-tight flex items-center gap-2">🏆 Leaderboard</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Global Habit Standings</p>
                    </div>
                    <span className="text-xs font-bold bg-slate-800 px-3 py-1.5 rounded-full text-slate-300">Level Rank</span>
                </div>
                <div className="space-y-3">
                    {leaderboard.map(function(user, idx) {
                        var rankMedal = "";
                        if (idx === 0) rankMedal = "🥇";
                        else if (idx === 1) rankMedal = "🥈";
                        else if (idx === 2) rankMedal = "🥉";
                        else rankMedal = "#" + (idx + 1);

                        var level = Math.floor(user.performance * 10);
                        
                        return (
                            <div key={user.id} className={`flex items-center justify-between p-3.5 rounded-2xl transition-all ${user.isMe ? 'bg-emerald-600/20 border border-emerald-500/30' : 'bg-slate-800/40'}`}>
                                <div className="flex items-center gap-3">
                                    <span className="w-6 text-center text-xs font-black text-slate-400">{rankMedal}</span>
                                    <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center text-xl">{user.avatar}</div>
                                    <div>
                                        <p className={`text-sm font-bold ${user.isMe ? 'text-emerald-400' : 'text-slate-200'}`}>{user.name}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <div className="w-16 bg-slate-700 h-1.5 rounded-full overflow-hidden">
                                                <div className="bg-emerald-500 h-full" style={{width: Math.min(100, user.performance * 100) + '%'}}></div>
                                            </div>
                                            <span className="text-[9px] font-bold text-slate-400">{Math.round(user.performance * 100)}%</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">LEVEL</span>
                                    <span className="text-sm font-black text-white">{level}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-emerald-600 p-8 rounded-[2.5rem] text-white space-y-6 shadow-xl shadow-emerald-100/50">
                <div className="text-center">
                    <h3 className="font-black text-xl tracking-tight">Invite your circle 🚀</h3>
                    <p className="text-[10px] text-emerald-200 font-bold uppercase tracking-widest mt-1">Get friends on Habitify</p>
                </div>
                
                <div className="space-y-3">
                    <input 
                        type="email" 
                        placeholder="Friend's Email Address" 
                        value={friendEmail} 
                        onChange={(e) => setFriendEmail(e.target.value)} 
                        className="w-full p-4 bg-emerald-700/50 border border-emerald-500/30 rounded-2xl outline-none font-bold text-white placeholder-emerald-300 text-center text-sm"
                    />
                    
                    <button 
                        disabled={inviting}
                        onClick={handleEmailInvite} 
                        className="bg-white text-emerald-600 w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all shadow-md"
                    >
                        {inviting ? 'Sending Invite...' : 'Send Premium Email Invite ✉️'}
                    </button>
                </div>

                <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-emerald-500/40"></div>
                    <span className="flex-shrink mx-4 text-[10px] text-emerald-300 font-bold uppercase tracking-wider">or</span>
                    <div className="flex-grow border-t border-emerald-500/40"></div>
                </div>

                <button 
                    onClick={handleWhatsAppShare} 
                    className="bg-emerald-900/40 border border-emerald-500/30 hover:bg-emerald-900/60 text-white w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                    Share on WhatsApp 💬
                </button>
            </div>
        {props.friends.map(function(friend) {
            return (
                <div key={friend.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-3xl">{friend.avatar}</div>
                            <div><h3 className="font-bold text-slate-800">{friend.name}</h3><span className="text-[10px] font-black uppercase text-emerald-500">Lv. {Math.floor(friend.performance * 10)} Habit Master</span></div>
                        </div>
                        <button onClick={function() { props.onRemoveFriend(friend.id); }} className="p-2 text-slate-200 hover:text-rose-500"><svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                    </div>
                    <div className="grid gap-2">
                        {Object.entries(friend.habit_stats || {}).filter(function(entry) { return entry[1].is_shared; }).map(function(entry) {
                            var hName = entry[0];
                            var stats = entry[1];
                            var myHabit = props.habits.find(function(h) { return h.name === hName; });
                            var myP = myHabit ? calculatePerformance(myHabit, props.logs).percent : 0;
                            var diff = Math.round((myP - stats.percent) * 100);
                            var diffBadge = null;
                            if (myHabit) {
                                if (diff > 0) {
                                    diffBadge = <span className="text-[9px] font-black uppercase bg-emerald-50 text-emerald-600 px-2 py-1 rounded-md">Leading by {diff}%</span>;
                                } else if (diff < 0) {
                                    diffBadge = <span className="text-[9px] font-black uppercase bg-rose-50 text-rose-600 px-2 py-1 rounded-md">Lagging by {Math.abs(diff)}%</span>;
                                } else {
                                    diffBadge = <span className="text-[9px] font-black uppercase bg-slate-100 text-slate-500 px-2 py-1 rounded-md">Tied</span>;
                                }
                            }

                            return (
                                <div key={hName} className="p-4 rounded-2xl bg-slate-50 space-y-3">
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm font-bold text-slate-700">{hName}</span>
                                        {myHabit ? diffBadge : <button onClick={function() { props.onAdopt(hName); }} className="text-[10px] font-black text-emerald-600 bg-white border border-emerald-100 px-3 py-1.5 rounded-lg">ADOPT</button>}
                                    </div>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[9px] font-black uppercase text-slate-400"><span>{friend.name.split(' ')[0]}</span><span>{Math.round(stats.percent * 100)}%</span></div>
                                        <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-slate-400" style={{width: Math.min(100, stats.percent * 100) + '%'}}></div></div>
                                        {myHabit && (
                                            <React.Fragment>
                                                <div className="flex justify-between text-[9px] font-black uppercase text-emerald-500 pt-1"><span>YOU</span><span>{Math.round(myP * 100)}%</span></div>
                                                <div className="h-1.5 w-full bg-emerald-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{width: Math.min(100, myP * 100) + '%'}}></div></div>
                                            </React.Fragment>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        })}
        </div>
    );
};

const HabitItem = (props) => {
    var perf = calculatePerformance(props.habit, props.logs);
    var isDoneToday = (props.logs || []).some(function(l) { return l.habitId === props.habit.id && l.date === format(new Date(), 'yyyy-MM-dd'); });
    return (
        <div onClick={props.onClick} className="habit-card bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center justify-between relative overflow-hidden mb-4 cursor-pointer">
            <div className="flex-1 pr-4">
                <h3 className="text-lg font-bold text-slate-800 leading-tight">{props.habit.name}</h3>
                <div className="flex items-center gap-2 mt-2">
                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg ${perf.bg} ${perf.color} tracking-tight`}>{perf.status} • {perf.delta}</span>
                    {props.habit.shared === false && <span className="text-[10px] text-slate-300">🔒 PRIVATE</span>}
                </div>
            </div>
            <div className="flex items-center gap-4">
                <div className="text-right flex flex-col items-end"><span className="text-3xl font-black text-slate-900 tabular-nums leading-none">{perf.actual}</span><span className="text-[9px] font-bold text-slate-300 uppercase mt-1">Days</span></div>
                <button onClick={function(e) { e.stopPropagation(); props.onLog(); }} className={`w-14 h-14 rounded-2xl flex items-center justify-center active:scale-90 transition-all shadow-lg ${isDoneToday ? 'bg-emerald-500 text-white shadow-emerald-100' : 'bg-slate-900 text-white shadow-slate-200'}`}>
                    {isDoneToday ? <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="4"><path d="M20 6 9 17l-5-5"/></svg> : <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="M12 8v8M8 12h8"/></svg>}
                </button>
            </div>
        </div>
    );
};

const SearchModal = (props) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    useEffect(function() {
        async function search() {
            if (query.length < 2) { setResults([]); return; }
            setLoading(true);
            var response = await supabase.from('profiles').select('*').ilike('name', '%' + query + '%').eq('is_searchable', true).neq('id', props.profile.id).limit(10);
            if (!response.error) setResults(response.data);
            setLoading(false);
        }
        var timer = setTimeout(search, 500);
        return function() { clearTimeout(timer); };
    }, [query]);
    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 pb-10 space-y-8 slide-up shadow-2xl max-h-[80vh] flex flex-col">
                <input autoFocus value={query} onChange={function(e) { setQuery(e.target.value); }} placeholder="Search community..." className="w-full p-5 bg-slate-50 border-2 border-transparent focus:border-emerald-100 rounded-2xl outline-none font-bold text-slate-800" />
                <div className="flex-1 overflow-y-auto no-scrollbar space-y-4">
                    {loading ? <div className="text-center py-10 animate-pulse text-slate-300 font-black">SEARCHING...</div> :
                    results.map(function(user) { return (
                        <div key={user.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                            <div className="flex items-center gap-4"><div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl shadow-sm">{user.avatar}</div><div><p className="font-bold text-slate-800">{user.name}</p></div></div>
                            <button onClick={function() { props.onAdd(user); props.onClose(); }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg shadow-emerald-100">FOLLOW</button>
                        </div>
                    ); })}
                </div>
                <button onClick={props.onClose} className="w-full py-5 font-bold text-slate-400 shrink-0">Cancel</button>
            </div>
        </div>
    );
};

const ProfileModal = (props) => {
    const [name, setName] = useState(props.profile.name);
    const [avatar, setAvatar] = useState(props.profile.avatar);
    const [isSearchable, setIsSearchable] = useState(props.profile.is_searchable !== false);
    const [isChecking, setIsChecking] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [error, setError] = useState('');
    const icons = ['🏃‍♂️', '🧘‍♀️', '🚴‍♂️', '📖', '🍎', '💦', '⭐', '⚡', '🔥'];

    async function handleSave() {
        if (name.length < 2) { setError('Name too short'); return; }
        setIsChecking(true); setError('');
        var nameCheck = await supabase.from('profiles').select('id').eq('name', name).neq('id', props.profile.id).maybeSingle();
        if (nameCheck.data) { setError('Name taken'); setIsChecking(false); return; }
        props.onSave({ ...props.profile, name: name, avatar: avatar, is_searchable: isSearchable });
        props.onClose();
    }

    const handleShareStats = async () => {
        setIsChecking(true);
        setStatusMessage('Generating stats...');
        try {
            var myPerformance = props.habits.length > 0 ? props.habits.reduce(function(acc, h) { return acc + calculatePerformance(h, props.logs).percent; }, 0) / props.habits.length : 0;
            
            // Generate HTML Stats Email
            var headerHtml = '<div style="font-family: \'Plus Jakarta Sans\', \'Inter\', -apple-system, sans-serif; background-color: #f8fafc; padding: 32px 24px; border-radius: 32px; max-width: 600px; margin: 0 auto; color: #1e293b; border: 1px solid #e2e8f0;">' +
                '<div style="text-align: center; margin-bottom: 24px;">' +
                    '<span style="font-size: 28px; font-weight: 800; color: #10b981; letter-spacing: -1px;">Habitify Stats</span>' +
                    '<p style="margin: 4px 0 0 0; font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;">Your Weekly Performance</p>' +
                '</div>' +
                '<div style="background-color: #ffffff; padding: 20px; border-radius: 24px; border: 1px solid #f1f5f9; margin-bottom: 24px; text-align: center;">' +
                    '<span style="font-size: 32px; line-height: 1;">' + props.profile.avatar + '</span>' +
                    '<h3 style="margin: 8px 0 2px 0; font-size: 18px; font-weight: 800; color: #0f172a;">Hey, ' + props.profile.name + '!</h3>' +
                    '<p style="margin: 0; font-size: 13px; color: #64748b; font-weight: 500;">Here is your current habit progress overview compared with friends.</p>' +
                '</div>';

            var leaderboard = [
                {
                    name: props.profile.name + " (You)",
                    avatar: props.profile.avatar,
                    performance: myPerformance
                },
                ...props.friends.map(function(f) {
                    return {
                        name: f.name,
                        avatar: f.avatar,
                        performance: f.performance || 0
                    };
                })
            ].sort(function(a, b) { return b.performance - a.performance; });

            var leaderboardHtml = '<div style="margin-bottom: 32px;">' +
                '<h4 style="margin: 0 0 12px 0; font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">🏆 Leaderboard Standings</h4>';
            
            leaderboard.forEach(function(u, idx) {
                var medal = (idx === 0) ? "🥇" : ((idx === 1) ? "🥈" : ((idx === 2) ? "🥉" : "#" + (idx + 1)));
                var lvl = Math.floor(u.performance * 10);
                leaderboardHtml += '<div style="background-color: #ffffff; padding: 12px 16px; border-radius: 16px; border: 1px solid #f1f5f9; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">' +
                    '<div style="display: flex; align-items: center; gap: 8px;">' +
                        '<span style="font-size: 13px; font-weight: 800; color: #94a3b8; width: 24px; display: inline-block;">' + medal + '</span>' +
                        '<span style="font-size: 18px; margin-right: 4px;">' + u.avatar + '</span>' +
                        '<span style="font-size: 13px; font-weight: 700; color: #1e293b;">' + u.name + '</span>' +
                    '</div>' +
                    '<span style="font-size: 11px; font-weight: 800; color: #64748b; background-color: #f1f5f9; padding: 4px 8px; border-radius: 6px;">LV. ' + lvl + ' (' + Math.round(u.performance * 100) + '%)</span>' +
                '</div>';
            });
            leaderboardHtml += '</div>';

            var habitsHtml = '<div style="margin-bottom: 32px;">' +
                '<h4 style="margin: 0 0 12px 0; font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">My Progress Summary</h4>';

            props.habits.forEach(function(h) {
                var perf = calculatePerformance(h, props.logs);
                var pct = Math.round(perf.percent * 100);
                var color = h.type === 'do' ? '#10b981' : '#f43f5e';
                var trackColor = h.type === 'do' ? '#ecfdf5' : '#fff1f2';
                
                habitsHtml += '<div style="background-color: #ffffff; padding: 16px; border-radius: 20px; border: 1px solid #f1f5f9; margin-bottom: 12px;">' +
                    '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">' +
                        '<span style="font-weight: 700; font-size: 14px; color: #1e293b;">' + h.name + '</span>' +
                        '<span style="font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px; background-color: ' + trackColor + '; color: ' + color + ';">' + perf.status + ' • ' + perf.actual + '/' + h.target + ' Days</span>' +
                    '</div>' +
                    '<div style="background-color: #f1f5f9; border-radius: 9999px; height: 8px; overflow: hidden; margin-bottom: 4px;">' +
                        '<div style="background-color: ' + color + '; width: ' + Math.min(100, pct) + '%; height: 100%; border-radius: 9999px;"></div>' +
                    '</div>' +
                    '<div style="text-align: right; font-size: 10px; font-weight: bold; color: #64748b;">' + pct + '% Completed</div>' +
                '</div>';
            });
            habitsHtml += '</div>';

            var socialHtml = '';
            if (props.friends && props.friends.length > 0) {
                socialHtml = '<div style="margin-bottom: 24px;">' +
                    '<h4 style="margin: 0 0 12px 0; font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Friend Comparison Stacks</h4>';

                props.habits.forEach(function(h) {
                    var perf = calculatePerformance(h, props.logs);
                    var myPct = Math.round(perf.percent * 100);
                    
                    var comparisonRows = '<div style="background-color: #ffffff; padding: 20px; border-radius: 24px; border: 1px solid #f1f5f9; margin-bottom: 16px;">' +
                        '<span style="font-weight: 800; font-size: 14px; color: #0f172a; display: block; margin-bottom: 12px; border-bottom: 1px dashed #f1f5f9; padding-bottom: 6px;">' + h.name + '</span>' +
                        '<div style="margin-bottom: 12px;">' +
                            '<div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; color: #10b981; margin-bottom: 4px;">' +
                                '<span>YOU</span>' +
                                '<span>' + myPct + '%</span>' +
                            '</div>' +
                            '<div style="background-color: #f1f5f9; border-radius: 9999px; height: 6px; overflow: hidden;">' +
                                '<div style="background-color: #10b981; width: ' + Math.min(100, myPct) + '%; height: 100%; border-radius: 9999px;"></div>' +
                            '</div>' +
                        '</div>';

                    var hasFriendData = false;
                    props.friends.forEach(function(friend) {
                        var stats = (friend.habit_stats || {})[h.name];
                        if (stats && stats.is_shared) {
                            hasFriendData = true;
                            var frPct = Math.round(stats.percent * 100);
                            comparisonRows += '<div style="margin-bottom: 12px;">' +
                                '<div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: 800; color: #64748b; margin-bottom: 4px;">' +
                                    '<span>' + friend.name + '</span>' +
                                    '<span>' + frPct + '%</span>' +
                                '</div>' +
                                '<div style="background-color: #f1f5f9; border-radius: 9999px; height: 6px; overflow: hidden;">' +
                                    '<div style="background-color: #94a3b8; width: ' + Math.min(100, frPct) + '%; height: 100%; border-radius: 9999px;"></div>' +
                                '</div>' +
                            '</div>';
                        }
                    });

                    comparisonRows += '</div>';
                    if (hasFriendData) {
                        socialHtml += comparisonRows;
                    }
                });
                socialHtml += '</div>';
            }

            var footerHtml = '<div style="text-align: center; margin-top: 32px; font-size: 10px; color: #94a3b8; font-weight: 600;">' +
                    '<span>This stats report was sent from your Habitify App.</span>' +
                '</div>' +
            '</div>';

            var htmlBody = headerHtml + leaderboardHtml + habitsHtml + socialHtml + footerHtml;

            setStatusMessage('Sending secure SMTP report from server...');
            
            // POST request to our Next.js Server-side Node API route
            const response = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    toEmail: props.profile.email,
                    htmlBody: htmlBody
                })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                setStatusMessage('Sent!');
                alert("Stats report delivered securely from the server!");
            } else {
                setStatusMessage('Send failed.');
                alert("Failed to send email: " + (result.error || "Unknown error"));
            }
        } catch (err) {
            console.error(err);
            setStatusMessage('Error.');
            alert("Error sending stats report: " + err.message);
        }
        setIsChecking(false);
        setTimeout(() => setStatusMessage(''), 3000);
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 pb-10 space-y-6 slide-up shadow-2xl max-h-[90vh] overflow-y-auto no-scrollbar">
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-black text-slate-900">My Profile</h2>
                    <div className="bg-slate-50 p-3 rounded-2xl flex justify-between items-center">
                         <div className="text-left"><p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Login Email</p><p className="text-xs font-bold text-emerald-600">{props.profile.email}</p></div>
                         <div className="flex items-center gap-2"><span className="text-[9px] font-black text-slate-400 uppercase">Searchable</span><label className="switch-toggle"><input type="checkbox" checked={isSearchable} onChange={function(e){setIsSearchable(e.target.checked);}} /><span className="slider"></span></label></div>
                    </div>
                </div>
                <div className="flex justify-center gap-3 flex-wrap">{icons.map(function(icon) { return <button key={icon} onClick={function(){setAvatar(icon);}} className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${avatar === icon ? 'bg-emerald-600 scale-110 shadow-lg text-white' : 'bg-slate-50'}`}>{icon}</button>; })}</div>
                <div className="space-y-4">
                    <div className="space-y-1"><label className="text-[10px] font-black text-slate-300 uppercase ml-2">Display Name</label><input value={name} onChange={function(e){setName(e.target.value); setError('');}} className="w-full p-4 bg-slate-50 rounded-2xl outline-none font-bold text-slate-800" /></div>
                    {error && <p className="text-rose-500 text-xs font-bold text-center">{error}</p>}
                </div>
                <div className="pt-6 border-t border-slate-100 space-y-4 text-center">
                    {props.installPrompt && (
                        <button onClick={props.triggerInstall} className="w-full py-4 bg-emerald-50 text-emerald-700 rounded-2xl text-xs font-black uppercase tracking-widest shadow-sm">
                            📥 Install App (PWA)
                        </button>
                    )}
                    
                    <button disabled={isChecking} onClick={handleShareStats} className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-2">
                        🚀 {statusMessage || 'Email Stats Report'}
                    </button>
                    <button onClick={function(){ if(window.confirm("Logout?")) { localStorage.clear(); window.location.reload(); } }} className="w-full py-2 text-[10px] font-black text-rose-400 uppercase tracking-widest text-center">Logout</button>
                </div>
                <div className="flex gap-4 pt-2">
                    <button onClick={props.onClose} className="flex-1 py-4 font-bold text-slate-400 text-xs">Cancel</button>
                    <button disabled={isChecking} onClick={handleSave} className="flex-[2] py-4 bg-emerald-600 text-white font-bold rounded-2xl shadow-xl shadow-emerald-100 text-xs uppercase tracking-widest">Save</button>
                </div>
            </div>
        </div>
    );
};

const AddModal = (props) => {
    const [name, setName] = useState(props.initialName || '');
    const [target, setTarget] = useState(props.initialName ? '260' : '');
    const [type, setType] = useState('do');
    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[3rem] p-8 pb-10 space-y-8 slide-up shadow-2xl">
                <h2 className="text-2xl font-black text-slate-900 text-center">{props.initialName ? 'Adopt' : 'New Habit'}</h2>
                <div className="flex p-1.5 bg-slate-100 rounded-2xl">
                    <button onClick={function(){setType('do');}} className={`flex-1 py-4 font-bold rounded-xl ${type === 'do' ? 'bg-white text-emerald-600' : 'text-slate-400'}`}>DO</button>
                    <button onClick={function(){setType('dont');}} className={`flex-1 py-4 font-bold rounded-xl ${type === 'dont' ? 'bg-white text-rose-600' : 'text-slate-400'}`}>DON'T</button>
                </div>
                <div className="space-y-4">
                    <input value={name} readOnly={!!props.initialName} onChange={function(e){setName(e.target.value);}} placeholder="Habit Name" className="w-full p-5 bg-slate-50 rounded-2xl outline-none font-bold text-slate-800" />
                    <input type="number" autoFocus={!!props.initialName} value={target} onChange={function(e){setTarget(e.target.value);}} placeholder="Annual Target" className="w-full p-5 bg-slate-50 rounded-2xl outline-none font-bold text-slate-800" />
                </div>
                <div className="flex gap-4">
                    <button onClick={props.onClose} className="flex-1 py-5 font-bold text-slate-400">Cancel</button>
                    <button onClick={function(){if(name && target){props.onSave({id: Date.now().toString(), name: name, target: parseInt(target), type: type, shared: true}); props.onClose();}}} className="flex-[2] py-5 bg-emerald-600 text-white font-bold rounded-2xl shadow-xl shadow-emerald-100 text-xs uppercase tracking-widest">Create</button>
                </div>
            </div>
        </div>
    );
};

const CalendarModal = (props) => {
    const [mon, setMon] = useState(new Date());
    var days = eachDayOfInterval({ start: startOfMonth(mon), end: endOfMonth(mon) });
    var startIdx = getDay(startOfMonth(mon));
    return (
        <div className="fixed inset-0 z-50 bg-white flex flex-col slide-up overflow-hidden">
            <header className="p-6 border-b flex justify-between items-center bg-white sticky top-0 z-10">
                <button onClick={props.onClose} className="p-4 bg-slate-50 rounded-2xl text-slate-600 active:scale-90 transition-all"><svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="4"><path d="m15 18-6-6 6-6"/></svg></button>
                <div className="text-center">
                    <h2 className="font-black text-slate-900 leading-tight">{props.habit.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                         <span className="text-[9px] font-black text-slate-400 uppercase">Shared with Friends</span>
                         <label className="switch-toggle scale-75"><input type="checkbox" checked={props.habit.shared !== false} onChange={function(e){props.onUpdate({...props.habit, shared: e.target.checked});}} /><span className="slider"></span></label>
                    </div>
                </div>
                <button onClick={function(){props.onDelete(props.habit.id);}} className="p-4 text-rose-500 active:scale-90 transition-all"><svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="3"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
            </header>
            <div className="p-6 flex-1 overflow-y-auto no-scrollbar pb-24">
                <div className="flex justify-between items-center mb-6 bg-slate-50 p-4 rounded-3xl">
                    <button onClick={function(){setMon(subMonths(mon, 1));}} className="p-2 text-slate-400"><svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="4"><path d="m15 18-6-6 6-6"/></svg></button>
                    <span className="text-lg font-black text-slate-800">{format(mon, 'MMMM yyyy')}</span>
                    <button onClick={function(){setMon(addMonths(mon, 1));}} className="p-2 text-slate-400"><svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="4"><path d="m9 18 6-6-6-6"/></svg></button>
                </div>
                <div className="flex justify-between items-center mb-10 bg-slate-50 p-5 rounded-3xl">
                    <div className="text-left">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Annual Target</span>
                        <div className="flex items-center gap-1">
                            <input 
                                type="number" 
                                value={props.habit.target} 
                                onChange={function(e) { 
                                    var val = parseInt(e.target.value) || 0;
                                    props.onUpdate({ ...props.habit, target: val });
                                }} 
                                className="w-16 bg-white border border-slate-200 rounded-lg p-1 text-center outline-none font-black text-sm text-emerald-600 focus:border-emerald-500" 
                            />
                            <span className="text-xs font-bold text-slate-500">Days</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Type</span>
                        <span className={`text-[10px] font-black uppercase px-2.5 py-1.5 rounded-lg tracking-tight ${props.habit.type === 'do' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            {props.habit.type === 'do' ? 'DO' : "DON'T"}
                        </span>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-3">
                    {['S','M','T','W','T','F','S'].map(function(d){ return <div key={d} className="text-center text-[10px] font-black text-slate-200 mb-2 uppercase">{d}</div>; })}
                    {Array(startIdx).fill(0).map(function(_, i){ return <div key={i} />; })}
                    {days.map(function(d) {
                        var dStr = format(d, 'yyyy-MM-dd');
                        var logged = (props.logs || []).some(function(l){ return l.habitId === props.habit.id && l.date === dStr; });
                        var future = isFuture(d);
                        var today = isToday(d);
                        return (
                            <button key={dStr} onClick={function(){if(!future) props.onToggle(props.habit.id, d);}} disabled={future} className={`h-12 w-full rounded-2xl text-sm font-black transition-all flex items-center justify-center ${logged ? (props.habit.type === 'do' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-100' : 'bg-rose-500 text-white shadow-lg shadow-rose-100') : (today ? 'border-2 border-emerald-500 text-emerald-600' : 'bg-slate-50 text-slate-800')} ${future ? 'opacity-5 pointer-events-none' : ''}`}>
                                {format(d, 'd')}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Page;
