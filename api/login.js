export default function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { username, password } = req.body;

    const validUsers = {
        [process.env.APP_USER_1_NAME]: process.env.APP_USER_1_PASS,
        [process.env.APP_USER_2_NAME]: process.env.APP_USER_2_PASS,
    };

    if (username && password && validUsers[username] === password) {
        return res.status(200).json({ success: true, username });
    }

    return res.status(401).json({ success: false, message: 'Invalid username or password' });
}