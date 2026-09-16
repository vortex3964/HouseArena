-- schema for our db

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums, created only when missing.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_difficulty') THEN
    CREATE TYPE task_difficulty AS ENUM ('easy', 'medium', 'hard');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('free', 'taken', 'completed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role') THEN
    CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');
  END IF;
END $$;

-- Adds the kanban review lane. RUN THIS BLOCK ALONE FIRST if the dashboard
-- complains: ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block, and the dashboard runs whole files transactionally. Any direct
-- Postgres connection (psql, TablePlus, DBeaver) runs it fine standalone.
-- Safe to re-run: the guard skips it once the value exists.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'in_review'
      AND enumtypid = 'task_status'::regtype
  ) THEN
    EXECUTE 'ALTER TYPE public.task_status ADD VALUE ''in_review''';
  END IF;
END $$;

-- Profiles, one row per login user, built by the trigger below.
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(20) NOT NULL UNIQUE,
    email TEXT UNIQUE,
    avatar_url TEXT,
    points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    gems INTEGER NOT NULL DEFAULT 0 CHECK (gems >= 0),
    strikes INTEGER NOT NULL DEFAULT 0 CHECK (strikes >= 0 AND strikes <= 3),
    wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON profiles(lower(username));
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON profiles(lower(email));

-- Households, as many as needed. Invite code is how members join.
CREATE TABLE IF NOT EXISTS households (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    invite_code TEXT NOT NULL UNIQUE DEFAULT upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12)),
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    check_date DATE
);

-- Membership, lets one user belong to many households.
CREATE TABLE IF NOT EXISTS household_members (
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role member_role NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (household_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_members_household ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_members_profile ON household_members(profile_id);

-- Tasks, each belongs to exactly one household. Kanban rules: anyone
-- creates, anyone takes, the taker completes, with an optional review
-- lane (taken -> in_review) in between. Status moves via RPCs.
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(60) NOT NULL,
    description TEXT DEFAULT 'no description',
    difficulty task_difficulty NOT NULL DEFAULT 'easy',
    points INTEGER NOT NULL,
    status task_status NOT NULL DEFAULT 'free',
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    owner UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    -- When the task was completed, for the weekly stats graph.
    -- Nullable so existing rows are unaffected.
    completed_at TIMESTAMPTZ,

    -- Points band per difficulty: easy 100-130, medium 200-260, hard 300-400.
    CONSTRAINT points_match_difficulty CHECK (
        (difficulty = 'easy'   AND points >= 100 AND points <= 130) OR
        (difficulty = 'medium' AND points >= 200 AND points <= 260) OR
        (difficulty = 'hard'   AND points >= 300 AND points <= 400)
    ),

    -- Status and owner must agree with each other.
    CONSTRAINT owner_matches_status CHECK (
        (status = 'free' AND owner IS NULL) OR
        (status = 'taken' AND owner IS NOT NULL) OR
        (status = 'in_review' AND owner IS NOT NULL) OR
        (status = 'completed' AND owner IS NOT NULL)
    )
);
-- Allow the review lane on databases created before it. Drop-and-add is
-- safe here: it only widens which (status, owner) pairs are legal and
-- touches no rows. Requires the in_review enum value above to exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_matches_status') THEN
    ALTER TABLE public.tasks DROP CONSTRAINT owner_matches_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_matches_status') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT owner_matches_status CHECK (
        (status = 'free' AND owner IS NULL) OR
        (status = 'taken' AND owner IS NOT NULL) OR
        (status = 'in_review' AND owner IS NOT NULL) OR
        (status = 'completed' AND owner IS NOT NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tasks_household ON tasks(household_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
-- Backs the stats query (household + completion-week range scan).
CREATE INDEX IF NOT EXISTS idx_tasks_household_completed ON tasks(household_id, completed_at);

-- Adds completed_at on databases created before it. Nullable add,
-- existing rows keep NULL and stay untouched.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks'
      AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Widen titles on databases created before VARCHAR(60). Widening never
-- touches existing data. Matches Lengths.TASK_TITLE in the app.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks'
      AND column_name = 'title' AND character_maximum_length < 60
  ) THEN
    ALTER TABLE public.tasks ALTER COLUMN title TYPE VARCHAR(60);
  END IF;
END $$;

-- Activity log, scoped per household, capped at 30 rows each.
CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    owner VARCHAR(20),
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_household ON activity_logs(household_id, created_at DESC);

-- Push devices, one row per login device for notifications.
CREATE TABLE IF NOT EXISTS push_devices (
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expo_push_token TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, expo_push_token)
);

-- Password reset throttle, service role only, no public access at all.
CREATE TABLE IF NOT EXISTS password_reset_requests (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reset_email_time ON password_reset_requests(email, created_at DESC);

-- Realtime for the live board, feed, members, and counters.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'households') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.households;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'household_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.household_members;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activity_logs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
  END IF;
END $$;

-- Full old rows on DELETE so household_id filters still match server-side.
-- profiles/households filter on id (always present); household_members has
-- a composite PK containing household_id; only tasks and activity_logs
-- need this. Costs extra WAL per delete on these two tables.
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.activity_logs REPLICA IDENTITY FULL;

-- Triggers and functions.

-- Sets household check_date to 7 days after creation.
CREATE OR REPLACE FUNCTION set_household_check_date()
RETURNS TRIGGER AS $$
BEGIN
    NEW.check_date := (CURRENT_DATE + INTERVAL '7 days')::DATE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_household_check_date') THEN
    CREATE TRIGGER trg_set_household_check_date
    BEFORE INSERT ON households
    FOR EACH ROW
    EXECUTE FUNCTION set_household_check_date();
  END IF;
END $$;

-- Builds a profile row for every new login user.
-- Uses the chosen username, falls back to the email prefix on collision.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    base TEXT;
    candidate TEXT;
BEGIN
    base := coalesce(
        NEW.raw_user_meta_data ->> 'username',
        split_part(NEW.email, '@', 1)
    );
    base := regexp_replace(lower(base), '[^a-z0-9_-]', '', 'g');
    IF base IS NULL OR length(base) < 3 THEN
        base := 'user_' || substr(md5(NEW.id::text), 1, 4);
    END IF;
    candidate := base;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate) THEN
        candidate := substr(base, 1, 15) || '_' || substr(md5(NEW.id::text), 1, 4);
    END IF;
    INSERT INTO public.profiles (id, username, email)
    VALUES (NEW.id, candidate, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_handle_new_user') THEN
    CREATE TRIGGER trg_handle_new_user
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();
  END IF;
END $$;

-- Membership checks used by the row level security rules below.
CREATE OR REPLACE FUNCTION is_household_member(hid INTEGER)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.household_members
        WHERE household_id = hid AND profile_id = auth.uid()
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_household_admin(hid INTEGER)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.household_members
        WHERE household_id = hid
          AND profile_id = auth.uid()
          AND role IN ('owner', 'admin')
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Creates a household and makes the caller its owner in one step.
-- Retries the invite code on the rare collision.
CREATE OR REPLACE FUNCTION create_household(p_name TEXT)
RETURNS households AS $$
DECLARE
    home households;
    clean TEXT;
    attempt INTEGER;
BEGIN
    clean := trim(p_name);
    IF clean IS NULL OR length(clean) < 2 THEN
        RAISE EXCEPTION 'Household name is too short' USING ERRCODE = 'P0001';
    END IF;
    IF length(clean) > 50 THEN
        RAISE EXCEPTION 'Household name max 50 characters' USING ERRCODE = 'P0001';
    END IF;
    FOR attempt IN 1..5 LOOP
        BEGIN
            INSERT INTO public.households (name, created_by)
            VALUES (clean, auth.uid())
            RETURNING * INTO home;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF attempt = 5 THEN RAISE; END IF;
        END;
    END LOOP;
    INSERT INTO public.household_members (household_id, profile_id, role)
    VALUES (home.id, auth.uid(), 'owner')
    ON CONFLICT DO NOTHING;
    RETURN home;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Joins a household with its invite code.
CREATE OR REPLACE FUNCTION join_household_by_code(p_code TEXT)
RETURNS households AS $$
DECLARE
    home households;
BEGIN
    SELECT * INTO home FROM public.households
    WHERE invite_code = upper(trim(p_code));
    IF home IS NULL THEN
        RAISE EXCEPTION 'No household uses that code' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.household_members (household_id, profile_id, role)
    VALUES (home.id, auth.uid(), 'member')
    ON CONFLICT DO NOTHING;
    RETURN home;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Leaves a household. Taken tasks go free via trigger below. When the
-- last owner leaves members behind, the earliest member is promoted.
CREATE OR REPLACE FUNCTION leave_household(p_household_id INTEGER)
RETURNS void AS $$
BEGIN
    IF NOT is_household_member(p_household_id) THEN
        RAISE EXCEPTION 'Not a member of this household' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.household_members
    WHERE household_id = p_household_id AND profile_id = auth.uid();
    IF NOT EXISTS (
        SELECT 1 FROM public.household_members
        WHERE household_id = p_household_id AND role = 'owner'
    ) AND EXISTS (
        SELECT 1 FROM public.household_members WHERE household_id = p_household_id
    ) THEN
        UPDATE public.household_members SET role = 'owner'
        WHERE household_id = p_household_id AND (profile_id, joined_at) = (
            SELECT profile_id, joined_at FROM public.household_members
            WHERE household_id = p_household_id ORDER BY joined_at LIMIT 1
        );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.household_members WHERE household_id = p_household_id
    ) THEN
        DELETE FROM public.households WHERE id = p_household_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Turns a login username into its email, works before sign-in.
CREATE OR REPLACE FUNCTION get_email_for_username(p_username TEXT)
RETURNS TEXT AS $$
    SELECT email FROM public.profiles WHERE lower(username) = lower(trim(p_username));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Claims a free task for the caller, members of that household only.
CREATE OR REPLACE FUNCTION claim_task(p_task_id INTEGER)
RETURNS tasks AS $$
DECLARE
    claimed tasks;
    uid UUID := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO claimed FROM public.tasks WHERE id = p_task_id;
    IF claimed IS NULL THEN
        RAISE EXCEPTION 'Task % does not exist', p_task_id USING ERRCODE = 'P0001';
    END IF;
    IF NOT is_household_member(claimed.household_id) THEN
        RAISE EXCEPTION 'Not a member of this household' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.tasks
    SET status = 'taken', owner = uid
    WHERE id = p_task_id AND status = 'free'
    RETURNING * INTO claimed;
    IF claimed IS NULL THEN
        RAISE EXCEPTION 'Task % is no longer available', p_task_id USING ERRCODE = 'P0001';
    END IF;
    RETURN claimed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Completes a taken task and pays its points to the holder.
CREATE OR REPLACE FUNCTION complete_task(p_task_id INTEGER)
RETURNS tasks AS $$
DECLARE
    target tasks;
    completed tasks;
    uid UUID := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO target FROM public.tasks WHERE id = p_task_id;
    IF target IS NULL THEN
        RAISE EXCEPTION 'Task % does not exist', p_task_id USING ERRCODE = 'P0001';
    END IF;
    IF NOT is_household_member(target.household_id) THEN
        RAISE EXCEPTION 'Not a member of this household' USING ERRCODE = 'P0001';
    END IF;
    IF target.owner IS DISTINCT FROM uid OR target.status NOT IN ('taken', 'in_review') THEN
        RAISE EXCEPTION 'Task % cannot be completed by this user (not owned, or not taken/under review)', p_task_id
            USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.tasks
    SET status = 'completed', completed_at = now()
    WHERE id = p_task_id AND owner = uid AND status IN ('taken', 'in_review')
    RETURNING * INTO completed;
    IF completed IS NULL THEN
        RAISE EXCEPTION 'Task % was taken by someone else first', p_task_id USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.profiles
    SET points = points + completed.points
    WHERE id = uid;
    RETURN completed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Submits a taken task for review. Only the holder can submit, and only
-- from taken: free cards have nothing to review, completed ones are done.
-- Completing stays open from both taken and in_review, so review is a
-- lane, not a gate.
CREATE OR REPLACE FUNCTION submit_for_review(p_task_id INTEGER)
RETURNS tasks AS $$
DECLARE
    submitted tasks;
    uid UUID := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO submitted FROM public.tasks WHERE id = p_task_id;
    IF submitted IS NULL THEN
        RAISE EXCEPTION 'Task % does not exist', p_task_id USING ERRCODE = 'P0001';
    END IF;
    IF NOT is_household_member(submitted.household_id) THEN
        RAISE EXCEPTION 'Not a member of this household' USING ERRCODE = 'P0001';
    END IF;
    IF submitted.owner IS DISTINCT FROM uid OR submitted.status != 'taken' THEN
        RAISE EXCEPTION 'Task % cannot be reviewed by this user (not owned or not taken)', p_task_id
            USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.tasks
    SET status = 'in_review'
    WHERE id = p_task_id AND owner = uid AND status = 'taken'
    RETURNING * INTO submitted;
    IF submitted IS NULL THEN
        RAISE EXCEPTION 'Task % changed before it could be reviewed', p_task_id USING ERRCODE = 'P0001';
    END IF;
    RETURN submitted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Strike penalty, minus 100 points per strike, wipe at 3 strikes.
CREATE OR REPLACE FUNCTION apply_strike_penalty()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.strikes > OLD.strikes THEN
        IF NEW.strikes >= 3 THEN
            NEW.points := 0;
            NEW.gems := 0;
        ELSE
            NEW.points := GREATEST(NEW.points - 100, 0);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_apply_strike_penalty') THEN
    CREATE TRIGGER trg_apply_strike_penalty
    BEFORE UPDATE OF strikes ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION apply_strike_penalty();
  END IF;
END $$;

-- Weekly strike decay, one strike forgiven per run.
CREATE OR REPLACE FUNCTION decay_strikes()
RETURNS void AS $$
BEGIN
    UPDATE public.profiles
    SET strikes = GREATEST(strikes - 1, 0)
    WHERE strikes > 0;
END;
$$ LANGUAGE plpgsql;
-- Needs pg_cron, then schedule with the line below.
-- SELECT cron.schedule('weekly-strike-decay', '0 0 * * 1', 'SELECT decay_strikes();');

-- Keeps only the 30 newest logs per household.
CREATE OR REPLACE FUNCTION prune_activity_logs()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.activity_logs a
    WHERE a.household_id = NEW.household_id
      AND a.id NOT IN (
        SELECT id FROM public.activity_logs
        WHERE household_id = NEW.household_id
        ORDER BY created_at DESC
        LIMIT 30
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prune_activity_logs') THEN
    CREATE TRIGGER trg_prune_activity_logs
    AFTER INSERT ON activity_logs
    FOR EACH ROW
    EXECUTE FUNCTION prune_activity_logs();
  END IF;
END $$;

-- Points, gems, strikes and wins change through app actions only.
-- Direct writes from logged-in users are rejected, RPCs still work
-- because they run as definer instead of the authenticated role.
CREATE OR REPLACE FUNCTION block_currency_selfwrite()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user = 'authenticated' AND (
        NEW.points IS DISTINCT FROM OLD.points OR
        NEW.gems IS DISTINCT FROM OLD.gems OR
        NEW.strikes IS DISTINCT FROM OLD.strikes OR
        NEW.wins IS DISTINCT FROM OLD.wins
    ) THEN
        RAISE EXCEPTION 'points, gems, strikes and wins change through app actions only'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_block_currency_selfwrite') THEN
    CREATE TRIGGER trg_block_currency_selfwrite
    BEFORE UPDATE OF points, gems, strikes, wins ON profiles
    FOR EACH ROW EXECUTE FUNCTION block_currency_selfwrite();
  END IF;
END $$;

-- Only owners can remove other owners. Admins can still remove members,
-- and anyone can always remove themselves by leaving.
CREATE OR REPLACE FUNCTION guard_owner_removal()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user = 'authenticated'
        AND OLD.role = 'owner'
        AND OLD.profile_id != auth.uid()
    THEN
        RAISE EXCEPTION 'only the owner can remove themselves'
            USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$ BEGIN
  -- ORDER MATTERS: same-timing triggers fire in name order, so
  -- trg_guard_owner_removal (g) runs before trg_release_tasks_on_leave
  -- (r) below. A blocked removal must never release tasks first.
  -- Keep these names in this alphabetical order if renamed.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_owner_removal') THEN
    CREATE TRIGGER trg_guard_owner_removal
    BEFORE DELETE ON household_members
    FOR EACH ROW EXECUTE FUNCTION guard_owner_removal();
  END IF;
END $$;

-- Frees the held tasks of a departing member so others can take them.
-- Completed work is untouched. Runs on leaves and kicks alike.
CREATE OR REPLACE FUNCTION release_tasks_on_leave()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.tasks SET status = 'free', owner = NULL
    WHERE household_id = OLD.household_id
      AND owner = OLD.profile_id
      AND status IN ('taken', 'in_review');
    INSERT INTO public.activity_logs (household_id, owner, details)
    VALUES (
        OLD.household_id,
        (SELECT username FROM public.profiles WHERE id = OLD.profile_id),
        'left the household, their taken tasks are free again'
    );
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_release_tasks_on_leave') THEN
    CREATE TRIGGER trg_release_tasks_on_leave
    BEFORE DELETE ON household_members
    FOR EACH ROW EXECUTE FUNCTION release_tasks_on_leave();
  END IF;
END $$;

-- Logs for one household, newest first, capped at 30, members only.
CREATE OR REPLACE FUNCTION get_household_logs(p_household_id INTEGER)
RETURNS SETOF activity_logs AS $$
    SELECT * FROM public.activity_logs
    WHERE household_id = p_household_id
      AND is_household_member(p_household_id)
    ORDER BY created_at DESC
    LIMIT 30;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Logs are written through this RPC so the owner name comes from
-- the caller account and cannot be forged by other members.
CREATE OR REPLACE FUNCTION log_activity(p_household_id INTEGER, p_details TEXT)
RETURNS activity_logs AS $$
DECLARE
    entry activity_logs;
BEGIN
    IF NOT is_household_member(p_household_id) THEN
        RAISE EXCEPTION 'Not a member of this household' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.activity_logs (household_id, owner, details)
    VALUES (
        p_household_id,
        (SELECT username FROM public.profiles WHERE id = auth.uid()),
        substr(trim(p_details), 1, 500)
    )
    RETURNING * INTO entry;
    RETURN entry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Row level security, members only see their own households.
-- Old permissive policies are dropped first, the strict ones below win.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON profiles;
DROP POLICY IF EXISTS "Users can join as themselves" ON household_members;
DROP POLICY IF EXISTS "Members can create tasks" ON tasks;
DROP POLICY IF EXISTS "Members can update tasks" ON tasks;
DROP POLICY IF EXISTS "Members can write logs" ON activity_logs;
DROP POLICY IF EXISTS "Avatars are viewable by authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Profiles viewable by self or housemates') THEN
    CREATE POLICY "Profiles viewable by self or housemates"
    ON profiles FOR SELECT TO authenticated USING (
      auth.uid() = id OR EXISTS (
        SELECT 1 FROM household_members m1
        JOIN household_members m2 ON m1.household_id = m2.household_id
        WHERE m1.profile_id = auth.uid() AND m2.profile_id = profiles.id
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Users can update their own profile') THEN
    CREATE POLICY "Users can update their own profile"
    ON profiles FOR UPDATE TO authenticated
    USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'households' AND policyname = 'Members can view their households') THEN
    CREATE POLICY "Members can view their households"
    ON households FOR SELECT TO authenticated USING (is_household_member(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'households' AND policyname = 'Authenticated users can create households') THEN
    CREATE POLICY "Authenticated users can create households"
    ON households FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'households' AND policyname = 'Admins can update their households') THEN
    CREATE POLICY "Admins can update their households"
    ON households FOR UPDATE TO authenticated
    USING (is_household_admin(id)) WITH CHECK (is_household_admin(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'households' AND policyname = 'Admins can delete their households') THEN
    CREATE POLICY "Admins can delete their households"
    ON households FOR DELETE TO authenticated USING (is_household_admin(id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'Members can view memberships') THEN
    CREATE POLICY "Members can view memberships"
    ON household_members FOR SELECT TO authenticated
    USING (is_household_member(household_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'No direct joins, RPC only') THEN
    CREATE POLICY "No direct joins, RPC only"
    ON household_members FOR INSERT TO authenticated WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'Users can leave households') THEN
    CREATE POLICY "Users can leave households"
    ON household_members FOR DELETE TO authenticated
    USING (profile_id = auth.uid() OR is_household_admin(household_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'Members can view tasks') THEN
    CREATE POLICY "Members can view tasks"
    ON tasks FOR SELECT TO authenticated USING (is_household_member(household_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'Members can add free tasks') THEN
    CREATE POLICY "Members can add free tasks"
    ON tasks FOR INSERT TO authenticated WITH CHECK (
      is_household_member(household_id) AND status = 'free' AND owner IS NULL
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'No direct task updates, RPC only') THEN
    CREATE POLICY "No direct task updates, RPC only"
    ON tasks FOR UPDATE TO authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'Admins can delete tasks') THEN
    CREATE POLICY "Admins can delete tasks"
    ON tasks FOR DELETE TO authenticated USING (is_household_admin(household_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'Members can view logs') THEN
    CREATE POLICY "Members can view logs"
    ON activity_logs FOR SELECT TO authenticated
    USING (is_household_member(household_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'No direct log writes, RPC only') THEN
    CREATE POLICY "No direct log writes, RPC only"
    ON activity_logs FOR INSERT TO authenticated WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'push_devices' AND policyname = 'Users manage their own devices') THEN
    CREATE POLICY "Users manage their own devices"
    ON push_devices FOR ALL TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Function access. Email lookup keeps anon because username login
-- happens before sign-in. Maintenance functions leave public entirely.
REVOKE ALL ON FUNCTION decay_strikes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prune_activity_logs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_strike_penalty() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_household_check_date() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION block_currency_selfwrite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION guard_owner_removal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_tasks_on_leave() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION is_household_member(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION is_household_admin(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION create_household(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION join_household_by_code(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION leave_household(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION claim_task(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION complete_task(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION submit_for_review(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION get_household_logs(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION log_activity(INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION get_email_for_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_household_member(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION is_household_admin(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION create_household(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION join_household_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_household(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_task(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_task(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_for_review(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_household_logs(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION log_activity(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_email_for_username(TEXT) TO anon, authenticated;

-- Private avatar bucket, one folder per user, viewable by housemates.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Avatars viewable by self or housemates') THEN
    create policy "Avatars viewable by self or housemates"
    on storage.objects for select to authenticated using (
      bucket_id = 'avatars' AND (
        auth.uid()::text = (storage.foldername(name))[1] OR EXISTS (
          SELECT 1 FROM household_members m1
          JOIN household_members m2 ON m1.household_id = m2.household_id
          WHERE m1.profile_id = auth.uid()
            AND m2.profile_id::text = (storage.foldername(name))[1]
        )
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can upload their own avatar') THEN
    create policy "Users can upload their own avatar"
    on storage.objects for insert to authenticated
    with check ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can update their own avatar') THEN
    create policy "Users can update their own avatar"
    on storage.objects for update to authenticated
    using ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] )
    with check ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can delete their own avatar') THEN
    create policy "Users can delete their own avatar"
    on storage.objects for delete to authenticated
    using ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );
  END IF;
END $$;

-- One-time reset codes for the push password flow. Service role only,
-- no policies on purpose, so anon and logged-in users cannot read them.
CREATE TABLE IF NOT EXISTS password_reset_codes (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reset_codes_email ON password_reset_codes(email, created_at DESC);
ALTER TABLE password_reset_codes ENABLE ROW LEVEL SECURITY;

-- Hourly purge, the backstop behind the function's own sweeping.
-- True zero every hour, even for emails that never come back.
-- If CREATE EXTENSION errors, enable pg_cron under Database, Extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-resets') THEN
    PERFORM cron.unschedule('purge-expired-resets');
  END IF;
END $$;

SELECT cron.schedule(
  'purge-expired-resets',
  '0 * * * *',
  $$DELETE FROM public.password_reset_codes WHERE expires_at < now();
    DELETE FROM public.password_reset_requests WHERE created_at < now() - interval '1 hour';$$
);
