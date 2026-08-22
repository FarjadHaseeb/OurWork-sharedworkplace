
export default function handler(req, res) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        res.status(500).setHeader('Content-Type', 'application/javascript');
        res.send(
            "console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables on the server.');"
        );
        return;
    }

    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(
        `window.SUPABASE_URL = ${JSON.stringify(supabaseUrl)};\n` +
        `window.SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};\n`
    );
}