<h1 align="center">HouseArena</h1>
<p align="center">
  <img src="assets/images/appImages/logo-128.png" alt="HouseArena logo" width="128" />
</p>

<p align="center">
  Household chore management app for families and roommates.<br/>
  Supports task crud actions profiles and has a kanaban board.
</p>

---

## What it is

HouseArena is a React Native app that aims to help roomates share household chores.

- **Kanban board** with four lanes: Free, Taken, For Review, Done.
- **Gem boost system** : spend gems to double a task's point value.
- **Review workflow** : submit completed work for household approval (confirm or reject).
- **Favourites** : save quick-access snapshots of your most-used tasks.
- **Leaderboard & stats** : live rankings, weekly comparison, daily bar chart, CSV export.
- **Activity logs** : a full audit trail of every action in the household that involves tasks.

Each household lives on **its own Supabase project** that the user creates to keep your data as private as possible.

---

## How it works

1. Create a free [Supabase](https://supabase.com) project.
2. Run the provided SQL schema in the Supabase SQL Editor.
3. Copy your project URL and anon key into the app.
4. Sign up, create a household, invite your housemates with an invite code.
5. Add tasks, claim them, complete them, and climb the leaderboard.

---

## Getting started (instructions)

### Prerequisites

- A free [Supabase account](https://supabase.com)
- The HouseArena app (see [Releases](../../releases))

### 1. Create your Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Pick a name and password, choose a region close to you.
3. Wait for the project to finish setting up.

### 2. Run the schema

1. In your Supabase dashboard, open the **SQL Editor** (left sidebar).
2. Open the file `Db/Schema.sql` from this repository (or from the release assets).
3. Paste the entire contents into the editor and click **Run**.
4. Wait for the "Success" message. All tables, functions, and row-level security policies are now in place.

### 3. Connect the app

1. Open the HouseArena app.
2. when registering (or via settings) add your credentials.
3. Paste your **Supabase Project URL** and **Anon Key** (found in your Supabase by pressing connect and selecting react native expo option from the dropdown menu).
4. Tap **Save**.
5. Sign up with an email and password, choose a username and thats it.

### 4. Inviting Housemates
1. Go to settings
2. Share the initive code
3. they are in

---

## Getting started (developers)

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- A Supabase project (see step 1 above)

### Clone and run

```bash
git clone https://github.com/vortex3964/HouseArena.git
cd HouseArena
npm install
cp .env.example .env
```

Fill in your Supabase credentials in `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=your-anon-key
```

Then start the dev server:

```bash
npm start
```

Scan the QR code with Expo Go (iOS/Android) or press `w` for web.

### Running tests

```bash
npm test
```

214 tests across 19 suites covering queries, mutations, task board logic, avatar handling, and more.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | [React Native](https://reactnative.dev/) via [Expo SDK 57](https://docs.expo.dev/) |
| Navigation | [Expo Router](https://docs.expo.dev/router/introduction/) (file-based, drawer) |
| Backend | [Supabase](https://supabase.com) (PostgreSQL, Auth, Row-Level Security, Realtime) |
| State | [TanStack Query](https://tanstack.com/query) v5 (cache, mutations, realtime merge) |
| Charts | [react-native-gifted-charts](https://github.com/Abhinandan-Kushwaha/react-native-gifted-charts) + react-native-svg |
| Notifications | [expo-notifications](https://docs.expo.dev/versions/latest/sdk/notifications/) (local scheduled) |
| Image handling | [expo-image-picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/) + [expo-image-manipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/) |
| Language | TypeScript 6 |
| Testing | Jest + @testing-library/react-native |

---

## Project structure

```
HouseArena/
  assets/             # Logo, tab icons, splash screen
  Db/
    Schema.sql        # Full database schema (tables, RPCs, RLS, triggers)
  src/
    app/              # Expo Router screens (index, household, stats, logs, ...)
    components/       # Reusable UI (task cards, modals, leaderboard, stats board)
    system/           # Data layer, auth, live subscriptions, avatar helpers
    global/           # Theme colours, constants, messages
  tests/
    unit/             # Pure logic tests
    integration/      # Supabase RPC tests against a fake client
    fake/             # In-memory fake Supabase client for testing
```

---
