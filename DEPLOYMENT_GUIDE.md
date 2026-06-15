# XO Arena - Complete Deployment Guide

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Create Your Bot](#step-1-create-your-telegram-bot)
4. [Step 2: Set Up Supabase](#step-2-set-up-supabase-backend)
5. [Step 3: Deploy to Vercel](#step-3-deploy-frontend-to-vercel)
6. [Step 4: Connect Bot to WebApp](#step-4-connect-bot-to-webapp)
7. [Step 5: Test Your App](#step-5-test-your-app)
8. [Environment Variables Reference](#environment-variables-reference)
9. [Understanding the Architecture](#understanding-the-architecture)
10. [Troubleshooting](#troubleshooting)
11. [Security Checklist](#security-checklist)
12. [Scaling Guide](#scaling-guide)
13. [Custom Domain (Optional)](#custom-domain-optional)

---

## Overview

This guide walks you through deploying XO Arena from zero to production. By the end, you'll have:

- A live Telegram Mini App accessible to anyone with Telegram
- A Supabase backend handling thousands of concurrent games
- Real-time multiplayer Tic-Tac-Toe with matchmaking
- AI opponent for single-player games

**Architecture:**
```
User (Telegram App)
    |
    v
Telegram Mini App SDK  ------>  Vercel (Frontend)
    |                                 |
    |                                 v
    |                         index.html + CSS + JS
    |                                 |
    +------ Supabase Backend <--------+
                |
                +-- PostgreSQL (Database)
                +-- Realtime (WebSocket)
                +-- Edge Functions (Serverless)
```

---

## Prerequisites

Before starting, you need:

1. **Telegram account** - To create a bot and test the app
2. **GitHub account** - For Vercel deployment
3. **Vercel account** - Free tier works fine (vercel.com)
4. **Supabase account** - Free tier works fine (supabase.com)
5. **BotFather on Telegram** - We'll use this to create our bot

All of these are free to set up.

---

## Step 1: Create Your Telegram Bot

### 1.1 Open BotFather
1. Open Telegram on your phone or desktop
2. Search for **"@BotFather"**
3. Start a chat with BotFather

### 1.2 Create a New Bot
1. Send the command: `/newbot`
2. BotFather will ask for a name. Type: `XO Arena`
3. BotFather will ask for a username. Choose something unique like:
   - `yourname_xo_arena_bot`
   - Must end in `bot`
   - Must be globally unique

4. BotFather will give you a **Bot Token**. It looks like:
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

5. **SAVE THIS TOKEN!** You'll need it later. Don't share it with anyone.

### 1.3 Enable Mini App Mode
1. Send: `/mybots`
2. Select your XO Arena bot
3. Tap **"Bot Settings"**
4. Tap **"Menu Button"**
5. Tap **"Configure menu button"**
6. Tap **"Open WebApp"**

This enables the Mini App feature for your bot.

### 1.4 Set Your Bot's Profile Picture (Optional)
1. Send: `/mybots`
2. Select your bot
3. Tap **"Edit Bot"**
4. Tap **"Edit Pic"**
5. Send a nice image for your bot's avatar

---

## Step 2: Set Up Supabase Backend

### 2.1 Create a Supabase Project
1. Go to [supabase.com](https://supabase.com) and sign up/log in
2. Click **"New Project"**
3. Fill in:
   - **Organization:** Your name or create new
   - **Project Name:** `xo-arena`
   - **Database Password:** Create a strong password (SAVE THIS!)
   - **Region:** Choose closest to your users
4. Click **"Create new project"**
5. Wait 2-3 minutes for the project to be created

### 2.2 Get Your Supabase Credentials
Once the project is ready:

1. Go to **Project Settings** (gear icon, bottom left)
2. Click **"API"** in the left sidebar
3. You'll see:
   - **Project URL** - Looks like: `https://xxxxxxxxxxxxxx.supabase.co`
   - **anon public** key - Long string
   - **service_role secret** key - Long string (KEEP SECRET!)

Save all three. You'll need them for the next steps.

### 2.3 Run the Database Schema

This creates all tables, indexes, security policies, and functions.

1. In Supabase Dashboard, click **"SQL Editor"** (left sidebar)
2. Click **"New query"**
3. **Copy the entire contents** of `supabase/schema.sql` from this project
4. **Paste it** into the SQL Editor
5. Click **"Run"** (the green play button)
6. You should see "Success. No rows returned" at the bottom

**What this creates:**
- `users` table - Stores all players
- `waiting_queue` table - Players waiting for a match
- `matches` table - All game matches
- `moves` table - Complete move history
- Row Level Security policies - Protects your data
- Database functions - Win detection, move validation
- Realtime subscriptions - Instant updates

### 2.4 Enable Realtime

1. In Supabase Dashboard, go to **"Database"** (left sidebar)
2. Click **"Replication"** in the dropdown
3. Under **"Source"**, click the pencil/edit icon
4. Toggle **"wal_level"** to `replica` if not already set
5. Click **"Save"**
6. Go to **"Realtime"** in the left sidebar
7. Make sure **"Enable Realtime"** is toggled ON

### 2.5 Set Up Environment Variables for Edge Functions

1. In Supabase Dashboard, open **Edge Function Secrets Management**
2. You can find it in the Dashboard or go directly to **Project Settings > Secrets**
3. Add these secrets:

| Variable | Value | Description |
|----------|-------|-------------|
| `BOT_TOKEN` | Your bot token from Step 1 | Verifies Telegram auth |
| `SUPABASE_URL` | Your project URL | Available to Edge Functions by default |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key | Admin access to DB; use only in Edge Functions |

**Note:** Supabase now exposes some values by default in Edge Functions, including `SUPABASE_URL`. You still need to add custom secrets like `BOT_TOKEN`, and you can manage everything either in the Dashboard or with `supabase secrets set`.

### 2.6 Deploy Edge Functions

These serverless functions handle secure operations.

#### Using Supabase CLI (Recommended):

**Install Supabase CLI:**
```bash
# macOS
brew install supabase

# Windows (with npm)
npm install -g supabase

# Linux
curl -fsSL https://get.supabase.io | bash
```

**Login and Link:**
```bash
# Login to Supabase
supabase login

# Go to your project folder
cd xo-arena

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is the part of your URL: `https://PROJECT_REF.supabase.co`

**Deploy Functions:**
```bash
# Deploy verify-telegram function
supabase functions deploy verify-telegram

# Deploy make-move function
supabase functions deploy make-move

# Deploy join-queue function
supabase functions deploy join-queue
```

#### Alternative: Using Supabase Dashboard (Manual)

1. Go to **"Edge Functions"** in the left sidebar
2. Click **"Deploy a new function"**
3. For each function (`verify-telegram`, `make-move`, `join-queue`):
   - Name it accordingly
   - Copy/paste the code from `supabase/functions/NAME/index.ts`
   - Deploy it

### 2.7 Test Your Edge Functions

In the Supabase Dashboard:
1. Go to **"Edge Functions"**
2. Click on a function
3. Click **"Invoke"**
4. Send a test request to verify it works

---

## Step 3: Deploy Frontend to Vercel

### 3.1 Prepare Your Project

1. Make sure all your files are in the `xo-arena` folder:
   ```
   xo-arena/
   ├── index.html
   ├── css/
   │   └── style.css
   ├── js/
   │   ├── supabase.js
   │   ├── auth.js
   │   ├── matchmaking.js
   │   ├── game.js
   │   ├── ai.js
   │   └── app.js
   ├── supabase/
   │   └── schema.sql
   └── vercel.json
   ```

2. Update `supabase.js` with your credentials:
   ```javascript
   // In js/supabase.js, replace:
   const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
   
   // With your actual values, for example:
   const SUPABASE_URL = 'https://abcdefgh123456.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIs...';
   ```

### 3.2 Push to GitHub

1. Create a new repository on GitHub:
   - Go to github.com
   - Click **"New"**
   - Name: `xo-arena`
   - Make it Public or Private (your choice)
   - Click **"Create repository"**

2. Initialize git and push:
   ```bash
   cd xo-arena
   git init
   git add .
   git commit -m "Initial XO Arena commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/xo-arena.git
   git push -u origin main
   ```

### 3.3 Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up/log in
2. Click **"Add New Project"**
3. Import your GitHub repository:
   - Find `xo-arena` and click **"Import"**
4. Configure project:
   - **Project Name:** `xo-arena` (or your choice)
   - **Framework Preset:** Leave as `Other`
   - **Root Directory:** `./` (leave default)
   - **Build Command:** Leave empty
   - **Output Directory:** Leave empty
5. Click **"Deploy"**
6. Wait 1-2 minutes for deployment
7. Vercel will give you a URL like: `https://xo-arena.vercel.app`

**SAVE THIS URL!** You'll need it for the next step.

### 3.4 Configure Environment Variables (Optional but Recommended)

Instead of hardcoding credentials in `supabase.js`, use Vercel env vars:

1. In Vercel Dashboard, go to your project
2. Click **"Settings"** > **"Environment Variables"**
3. Add:
   - `SUPABASE_URL` = Your Supabase project URL
   - `SUPABASE_ANON_KEY` = Your Supabase anon key

Then update `supabase.js` to read from env:
```javascript
const SUPABASE_URL = window.ENV?.SUPABASE_URL || 'fallback-url';
```

**Note:** For a static site, environment variables need to be injected at build time or use a different approach. For simplicity, you can keep the values in `supabase.js` for now.

---

## Step 4: Connect Bot to WebApp

This is the step that makes your bot open your Mini App.

### 4.1 Set the Menu Button URL

1. Open Telegram and message **@BotFather**
2. Send: `/mybots`
3. Select your **XO Arena** bot
4. Tap **"Menu Button"**
5. Tap **"Configure menu button"**
6. Tap **"Open WebApp"**
7. Send your Vercel URL: `https://your-project.vercel.app`

### 4.2 Set the Start Button (Alternative Method)

You can also set it via BotFather's menu:

1. Message @BotFather: `/mybots`
2. Select your bot
3. Tap **"Bot Settings"**
4. Tap **"Menu Button"**
5. Tap **"Configure menu button URL"**
6. Send your URL

### 4.3 Test Opening the App

1. Find your bot in Telegram (search for its username)
2. Tap **"Start"** or **"Menu"** button
3. Your Mini App should open!

If it doesn't work:
- Check that your Vercel URL is correct
- Make sure `index.html` is accessible at the root URL
- Check browser console for JavaScript errors

---

## Step 5: Test Your App

### 5.1 Basic Functionality Test

1. **Open the Mini App** - Tap your bot's menu button
2. **Check Profile** - You should see your Telegram name and photo
3. **Play vs AI** - Tap "Play vs AI", make moves, verify the AI responds
4. **Check Win Detection** - Try to win, lose, and draw against the AI
5. **Check Results Screen** - After game ends, verify results show correctly

### 5.2 Multiplayer Test

You need two Telegram accounts (or a friend):

1. **Account A** - Open the Mini App, tap "Play Online"
2. **Account B** - Open the Mini App, tap "Play Online" within 30 seconds
3. Both should be matched and a game should start
4. Make moves on both accounts - they should sync in real-time
5. Complete a game and verify the result

### 5.3 Matchmaking Timeout Test

1. Open the Mini App
2. Tap "Play Online"
3. Wait 30 seconds without another player joining
4. You should see "No opponent found yet" with "Play vs AI" option

### 5.4 Security Test

1. Try to make a move when it's not your turn - should be blocked
2. Try to click an already-filled cell - should be blocked
3. Try rapid clicking - only first valid move should count

---

## Environment Variables Reference

### Supabase (set in Supabase Dashboard > Functions)

| Variable | Where to Find | Used By |
|----------|---------------|---------|
| `BOT_TOKEN` | BotFather gave you this | verify-telegram Edge Function |
| `SUPABASE_URL` | Supabase Settings > API | All Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Settings > API | All Edge Functions |

### Vercel (set in Vercel Dashboard > Settings > Environment Variables)

| Variable | Where to Find | Used By |
|----------|---------------|---------|
| `SUPABASE_URL` | Supabase Settings > API | Frontend (supabase.js) |
| `SUPABASE_ANON_KEY` | Supabase Settings > API | Frontend (supabase.js) |

### Frontend (hardcoded in js/supabase.js for static sites)

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
```

---

## Understanding the Architecture

### Data Flow

```
1. USER OPENS APP
   Telegram WebApp -> index.html -> loads JS -> initAuth()
   
2. AUTHENTICATION
   auth.js reads Telegram initData -> getOrCreateUser() -> Supabase users table
   
3. PLAY ONLINE
   User taps "Play Online" -> startMatchmaking()
   -> Check waiting_queue -> If opponent found: createMatch()
   -> If no opponent: addToQueue() -> wait 30s
   
4. MAKING A MOVE
   User clicks cell -> handleCellClick() -> validateMove()
   -> update board_state in Supabase -> Realtime broadcasts
   -> Opponent receives update instantly
   
5. WIN DETECTION
   After each move -> checkGameResult()
   -> If win: completeMatch() -> showResultScreen()
   
6. AI OPPONENT
   Player moves -> setTimeout -> getAIMove() (Minimax)
   -> AI calculates best move -> update board -> back to player
```

### Board State Format

We use a **9-character string** instead of JSON for performance:

```
Position: 0 1 2 | 3 4 5 | 6 7 8
Board:    X - O | - X - | O - X

Stored as: "XO-X--O-X"

Why? 
- JSON: '["X","","O","","X","","O","","X"]' = 37 characters
- Compact: "XO-X--O-X" = 9 characters
- 4x smaller, faster to transmit, easier to compare
```

### Security Layers

```
Layer 1: Telegram initData verification (Edge Function)
  - HMAC-SHA256 signature check
  - Prevents fake identities

Layer 2: Supabase Row Level Security (RLS)
  - Users can only see their own matches
  - Prevents data leaks

Layer 3: Server-side move validation (Edge Function)
  - Every move validated before recording
  - Prevents cheating (wrong turn, illegal moves)

Layer 4: Database constraints
  - Board must be 9 chars of X, O, or -
  - Positions must be 0-8
  - Prevents corrupted data
```

---

## Troubleshooting

### Problem: "Authentication failed" error

**Cause:** Supabase not configured or Telegram not detected

**Solution:**
1. Check that `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set correctly in `supabase.js`
2. Make sure the database schema was run successfully
3. Check browser console for specific errors

### Problem: "Failed to find opponent" / matchmaking never works

**Cause:** Realtime not enabled or RLS policies blocking access

**Solution:**
1. In Supabase Dashboard, go to **"Realtime"** and make sure it's enabled
2. Check that the `waiting_queue` table has proper RLS policies
3. Try manually inserting a test row into `waiting_queue` to verify permissions

### Problem: Moves don't sync between players

**Cause:** Realtime subscription not working

**Solution:**
1. Check browser console for WebSocket errors
2. In Supabase Dashboard, go to **"Database" > "Replication"**
3. Make sure the `matches` table is in the publication
4. Check that `wal_level` is set to `replica`

### Problem: AI doesn't respond

**Cause:** JavaScript error in ai.js or game.js

**Solution:**
1. Open browser developer tools (F12)
2. Check the Console tab for red errors
3. Make sure `ai.js` is loaded before `game.js` in `index.html`

### Problem: "Invalid board_state" error

**Cause:** Board state doesn't match the expected format

**Solution:**
1. Check that moves are updating the board correctly
2. The board must be exactly 9 characters: only X, O, or -
3. Check the `valid_board_state` constraint in the schema

### Problem: App doesn't open in Telegram

**Cause:** URL not configured correctly with BotFather

**Solution:**
1. Verify your Vercel URL works in a browser
2. Check that you set the Menu Button URL correctly with BotFather
3. The URL must be HTTPS (Telegram requires this)
4. Try sending `/setmenubutton` to BotFather and reconfigure

### Problem: "CORS error" in browser console

**Cause:** Cross-origin requests blocked

**Solution:**
1. Our Edge Functions already include CORS headers
2. Check that the Edge Functions are deployed correctly
3. Verify the SUPABASE_URL in your frontend matches your project

---

## Security Checklist

Before going live, verify these:

- [ ] **Bot Token is secret** - Never commit it to GitHub
- [ ] **Service Role Key is secret** - Only used in Edge Functions
- [ ] **Anon Key is public** - Safe to use in frontend
- [ ] **RLS is enabled** on all tables
- [ ] **RLS policies are correct** - Users can't access other users' data
- [ ] **Edge Functions validate moves** - Server-side validation prevents cheating
- [ ] **Telegram initData is verified** - Edge Function checks the signature
- [ ] **HTTPS is enforced** - Vercel provides this automatically
- [ ] **Database constraints are in place** - Invalid data is rejected

---

## Scaling Guide

### Current Capacity (Free Tier)

**Supabase Free Tier:**
- 500MB database (can store ~1 million matches)
- 2GB bandwidth/month
- Up to 200 concurrent Realtime connections
- 500K Edge Function invocations/month

**Vercel Free Tier:**
- 100GB bandwidth/month
- 6,000 build minutes/month
- Serverless functions (if you add any)

### When You Need to Scale

**1. Database Size:**
- Upgrade to Supabase Pro ($25/month)
- 8GB database, 100GB bandwidth
- Add connection pooling for more concurrent users

**2. More Concurrent Games:**
- Upgrade Realtime connections (Pro supports 1000+)
- Add read replicas for faster queries
- Use Redis for session caching (optional)

**3. Performance Optimization:**
- Add more indexes to frequently queried columns
- Use materialized views for leaderboards
- Cache user stats in the users table (avoid counting every time)

**4. Monitoring:**
- Supabase Dashboard shows query performance
- Set up alerts for slow queries
- Use Vercel Analytics for frontend performance

---

## Custom Domain (Optional)

If you want your app on your own domain instead of `.vercel.app`:

### 1. Buy a Domain
- Namecheap, GoDaddy, Cloudflare, or any registrar
- Example: `xoarena.app`

### 2. Add to Vercel
1. In Vercel Dashboard, go to your project
2. Click **"Settings"** > **"Domains"**
3. Enter your domain: `xoarena.app`
4. Vercel will give you DNS records

### 3. Configure DNS
1. Go to your domain registrar's DNS settings
2. Add the records Vercel provided (usually CNAME or A records)
3. Wait 5-60 minutes for DNS to propagate

### 4. Update BotFather
1. Message @BotFather: `/mybots`
2. Select your bot
3. Update the Menu Button URL to your custom domain

---

## Next Steps & Feature Ideas

After deploying, you might want to add:

1. **Leaderboard** - Track top players by wins
2. **Chat during games** - Add a simple chat box
3. **Friend matches** - Invite friends by username
4. **Statistics dashboard** - Detailed win/loss history
5. **Different board sizes** - 4x4 or 5x5 variations
6. **Tournament mode** - Elimination brackets
7. **Timed mode** - Each player has a countdown timer
8. **ELO ranking** - Skill-based matchmaking
9. **Achievements** - Badges for milestones
10. **Spectator mode** - Watch other games

---

## Support

If you encounter issues:

1. Check the **Troubleshooting** section above
2. Look at browser console for JavaScript errors
3. Check Supabase logs in Dashboard > Logs
4. Check Vercel deployment logs
5. Review the code comments for explanations

---

## License

This project is yours to use, modify, and distribute as you wish.

---

**Congratulations!** You now have a fully functional Telegram Mini App running on Supabase and Vercel. Good luck with XO Arena!
