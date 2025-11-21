// Minimal auth microservice implementing the three required user stories:
// 1) Basic login (register + login)
// 2) Invalid login handling (lockout after repeated failures)
// 3) Session persistence (access + refresh tokens)

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');

// Load users from file or initialize empty
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      const users = new Map(JSON.parse(data));
      console.log(`Loaded ${users.size} users from users.json`);
      return users;
    }
  } catch (err) {
    console.warn('Failed to load users.json, starting fresh:', err.message);
  }
  return new Map();
}

// Save users to file
function saveUsers(users) {
  try {
    const data = JSON.stringify(Array.from(users.entries()));
    fs.writeFileSync(USERS_FILE, data, 'utf8');
  } catch (err) {
    console.error('Failed to save users.json:', err.message);
  }
}

// Config
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

// In-memory stores
const users = loadUsers(); // email -> { id, email, name, passwordHash, lastLogin }
const refreshTokens = new Map(); // tokenId -> { token, userId, expiresAt }
const loginAttempts = new Map(); // email -> { count, lastAttempt }

// Helpers
async function verifyPassword(password, stored) {
  return password === stored;
}

function generateTokens(userId, email) {
  const accessToken = jwt.sign({ userId, email, type: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const tokenId = uuidv4();
  const refreshToken = jwt.sign({ userId, email, tokenId, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
  return { accessToken, refreshToken, tokenId };
}

function checkLoginAttempts(email) {
  const attempts = loginAttempts.get(email);
  if (!attempts) return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS };
  if (Date.now() - attempts.lastAttempt > LOCKOUT_TIME) {
    loginAttempts.delete(email);
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS };
  }
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    const minutesLeft = Math.ceil((LOCKOUT_TIME - (Date.now() - attempts.lastAttempt)) / 60000);
    return { allowed: false, remaining: 0, minutesLeft };
  }
  return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - attempts.count };
}

function recordLoginAttempt(email, success) {
  if (success) { loginAttempts.delete(email); return; }
  const prev = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
  prev.count = (prev.count || 0) + 1;
  prev.lastAttempt = Date.now();
  loginAttempts.set(email, prev);
}

// Routes

// Register
app.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password too short (>=6)' });
    if (users.has(email)) return res.status(409).json({ error: 'User exists' });

    const id = uuidv4();
    users.set(email, { id, email, name: name || '', password, lastLogin: null });
    saveUsers(users);
    return res.status(201).json({ message: 'Registered', user: { id, email, name: name || '' } });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Register failed' });
  }
});

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const attempt = checkLoginAttempts(email);
    if (!attempt.allowed) return res.status(429).json({ error: 'Too many attempts', minutesLeft: attempt.minutesLeft });

    const user = users.get(email);
    if (!user) {
      recordLoginAttempt(email, false);
      return res.status(401).json({ error: 'Invalid credentials', attemptsRemaining: attempt.remaining - 1 });
    }

    const ok = await verifyPassword(password, user.password);
    if (!ok) {
      recordLoginAttempt(email, false);
      const a = checkLoginAttempts(email);
      return res.status(401).json({ error: 'Invalid credentials', attemptsRemaining: a.remaining });
    }

    // success
    recordLoginAttempt(email, true);
    const { accessToken, refreshToken, tokenId } = generateTokens(user.id, user.email);
    const decoded = jwt.decode(refreshToken);
    refreshTokens.set(tokenId, { token: refreshToken, userId: user.id, expiresAt: decoded.exp * 1000 });
    user.lastLogin = new Date();
    saveUsers(users);

    return res.json({ message: 'Login successful', accessToken, refreshToken, expiresIn: ACCESS_TOKEN_EXPIRY });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh
app.post('/auth/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    let decoded;
    try { decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET); } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const stored = refreshTokens.get(decoded.tokenId);
    if (!stored || stored.token !== refreshToken) return res.status(401).json({ error: 'Refresh token not found' });

    const newAccess = jwt.sign({ userId: decoded.userId, email: decoded.email, type: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    return res.json({ accessToken: newAccess, expiresIn: ACCESS_TOKEN_EXPIRY });
  } catch (err) {
    console.error('Refresh error', err);
    return res.status(500).json({ error: 'Refresh failed' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Auth microservice (minimal) listening on ${PORT}`);
  console.log('Endpoints: POST /auth/register, POST /auth/login, POST /auth/refresh');
});
