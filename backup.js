import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = 'https://rxhrcdpzvwevvqkwaaus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4aHJjZHB6dndldnZxa3dhYXVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzcxMTQsImV4cCI6MjA5NjMxMzExNH0.qX-mYTvleNW-rGjqXISHNpx2Sar7ujsmWeRw3j9P2xo';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runBackup() {
    console.log("Fetching profiles from Supabase...");
    const { data, error } = await supabase.from('profiles').select('*');
    
    if (error) {
        console.error("Error fetching profiles:", error);
        process.exit(1);
    }
    
    const backupPath = './backup_profiles.json';
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2));
    console.log(`Successfully backed up ${data.length} profiles to ${backupPath}`);
}

runBackup();
