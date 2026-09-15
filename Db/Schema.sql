-- HouseArena schema

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

-- Profiles come first, households reference them below.
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

-- Households, as many as needed. Invite code is how members join.
CREATE TABLE IF NOT EXISTS households (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    invite_code TEXT NOT NULL UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 6)),
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

-- Tasks, each belongs to exactly one household.
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(20) NOT NULL,
    description TEXT DEFAULT 'no description',
    difficulty task_difficulty NOT NULL DEFAULT 'easy',
    points INTEGER NOT NULL,
    status task_status NOT NULL DEFAULT 'free',
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    owner UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),

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
        (status = 'completed' AND owner IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_tasks_household ON tasks(household_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Activity log, scoped per household.
CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    owner VARCHAR(20),
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_household ON activity_logs(household_id, created_at DESC);

-- Realtime for the live tracking screens, added only when missing.
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
-- Uses the chosen username, or the email prefix when missing.
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
CREATE OR REPLACE FUNCTION create_household(p_name TEXT)
RETURNS households AS $$
DECLARE
    home households;
    clean TEXT;
BEGIN
    clean := trim(p_name);
    IF clean IS NULL OR length(clean) < 2 THEN
        RAISE EXCEPTION 'Household name is too short' USING ERRCODE = 'P0001';
    END IF;
    IF length(clean) > 50 THEN
        RAISE EXCEPTION 'Household name max 50 characters' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.households (name, created_by)
    VALUES (clean, auth.uid())
    RETURNING * INTO home;
    INSERT INTO public.household_members (household_id, profile_id, role)
    VALUES (home.id, auth.uid(), 'owner')
    ON CONFLICT DO NOTHING;
    RETURN home;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Joins a household with its 6-letter invite code.
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

-- Leaves a household, removes the household itself when empty.
CREATE OR REPLACE FUNCTION leave_household(p_household_id INTEGER)
RETURNS void AS $$
BEGIN
    DELETE FROM public.household_members
    WHERE household_id = p_household_id AND profile_id = auth.uid();
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

-- Claims a task for the caller, members of that household only.
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

-- Completes a task and pays its points to the caller.
CREATE OR REPLACE FUNCTION complete_task(p_task_id INTEGER)
RETURNS tasks AS $$
DECLARE
    completed tasks;
    uid UUID := auth.uid();
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.tasks
    SET status = 'completed'
    WHERE id = p_task_id AND owner = uid AND status = 'taken'
    RETURNING * INTO completed;
    IF completed IS NULL THEN
        RAISE EXCEPTION 'Task % cannot be completed by this user (not owned or not taken)', p_task_id
            USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.profiles
    SET points = points + completed.points
    WHERE id = uid;
    RETURN completed;
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

-- Logs for one household, newest first, members only.
CREATE OR REPLACE FUNCTION get_household_logs(p_household_id INTEGER)
RETURNS SETOF activity_logs AS $$
    SELECT * FROM public.activity_logs
    WHERE household_id = p_household_id
      AND is_household_member(p_household_id)
    ORDER BY created_at DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Row level security, members only see their own households.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Profiles are viewable by authenticated users') THEN
    CREATE POLICY "Profiles are viewable by authenticated users"
    ON profiles FOR SELECT TO authenticated USING (true);
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'household_members' AND policyname = 'Users can join as themselves') THEN
    CREATE POLICY "Users can join as themselves"
    ON household_members FOR INSERT TO authenticated
    WITH CHECK (profile_id = auth.uid());
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'Members can create tasks') THEN
    CREATE POLICY "Members can create tasks"
    ON tasks FOR INSERT TO authenticated WITH CHECK (is_household_member(household_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tasks' AND policyname = 'Members can update tasks') THEN
    CREATE POLICY "Members can update tasks"
    ON tasks FOR UPDATE TO authenticated
    USING (is_household_member(household_id))
    WITH CHECK (is_household_member(household_id));
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_logs' AND policyname = 'Members can write logs') THEN
    CREATE POLICY "Members can write logs"
    ON activity_logs FOR INSERT TO authenticated
    WITH CHECK (is_household_member(household_id));
  END IF;
END $$;

-- Function access, email lookup works before login so anon gets it too.
GRANT EXECUTE ON FUNCTION get_email_for_username(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_household(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION join_household_by_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION leave_household(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION claim_task(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_task(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_household_logs(INTEGER) TO authenticated;

-- Private avatar bucket, one folder per user.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Avatars are viewable by authenticated users') THEN
    create policy "Avatars are viewable by authenticated users"
    on storage.objects for select to authenticated using ( bucket_id = 'avatars' );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can upload their own avatar') THEN
    create policy "Users can upload their own avatar"
    on storage.objects for insert to authenticated
    with check ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can update their own avatar') THEN
    create policy "Users can update their own avatar"
    on storage.objects for update to authenticated
    using ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can delete their own avatar') THEN
    create policy "Users can delete their own avatar"
    on storage.objects for delete to authenticated
    using ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );
  END IF;
END $$;

-- SECURITY HARDENING
-- Replaces a few policies with stricter versions and locks down functions.
-- Only policies are dropped and recreated, never tables or data.

-- Membership joins go through the invite-code RPC only. Direct inserts
-- can no longer pick their own role, which closed an owner escalation.
DROP POLICY IF EXISTS "Users can join as themselves" ON household_members;
CREATE POLICY "No direct joins, RPC only"
ON household_members FOR INSERT TO authenticated WITH CHECK (false);

-- Profiles are readable by self or housemates only, not every login.
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON profiles;
CREATE POLICY "Profiles viewable by self or housemates"
ON profiles FOR SELECT TO authenticated USING (
  auth.uid() = id OR EXISTS (
    SELECT 1 FROM household_members m1
    JOIN household_members m2 ON m1.household_id = m2.household_id
    WHERE m1.profile_id = auth.uid() AND m2.profile_id = profiles.id
  )
);

-- Members can add fresh free tasks, but cannot pre-assign owners.
DROP POLICY IF EXISTS "Members can create tasks" ON tasks;
CREATE POLICY "Members can add free tasks"
ON tasks FOR INSERT TO authenticated WITH CHECK (
  is_household_member(household_id) AND status = 'free' AND owner IS NULL
);

-- Task status changes go through the claim and complete RPCs only.
DROP POLICY IF EXISTS "Members can update tasks" ON tasks;
CREATE POLICY "No direct task updates, RPC only"
ON tasks FOR UPDATE TO authenticated USING (false);

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
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_owner_removal') THEN
    CREATE TRIGGER trg_guard_owner_removal
    BEFORE DELETE ON household_members
    FOR EACH ROW EXECUTE FUNCTION guard_owner_removal();
  END IF;
END $$;

-- Remember who created each task, defaults to the caller.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE tasks ALTER COLUMN created_by SET DEFAULT auth.uid();

-- Leaving checks membership first. When the last owner leaves while
-- members remain, the earliest member is promoted so nobody is orphaned.
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

-- Completing needs membership too. Anyone who took a task can finish it.
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
    IF target.owner IS DISTINCT FROM uid OR target.status != 'taken' THEN
        RAISE EXCEPTION 'Task % cannot be completed by this user (not owned or not taken)', p_task_id
            USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.tasks
    SET status = 'completed'
    WHERE id = p_task_id AND owner = uid AND status = 'taken'
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

-- Stronger invite codes, 12 chars from a CSPRNG instead of 6 hex chars.
ALTER TABLE households ALTER COLUMN invite_code
  SET DEFAULT upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));

-- Household creation retries the code on the rare collision.
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

DROP POLICY IF EXISTS "Members can write logs" ON activity_logs;
CREATE POLICY "No direct log writes, RPC only"
ON activity_logs FOR INSERT TO authenticated WITH CHECK (false);

-- Avatars are viewable by self or housemates, writes stay own-folder.
DROP POLICY IF EXISTS "Avatars are viewable by authenticated users" ON storage.objects;
CREATE POLICY "Avatars viewable by self or housemates"
ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'avatars' AND (
    auth.uid()::text = (storage.foldername(name))[1] OR EXISTS (
      SELECT 1 FROM household_members m1
      JOIN household_members m2 ON m1.household_id = m2.household_id
      WHERE m1.profile_id = auth.uid()
        AND m2.profile_id::text = (storage.foldername(name))[1]
    )
  )
);

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE TO authenticated
USING ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] )
WITH CHECK ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );

-- Lock down function execution. Helpers stay usable where RLS needs them.
-- Email lookup keeps anon because username login happens before sign-in.
REVOKE ALL ON FUNCTION decay_strikes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prune_activity_logs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_strike_penalty() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_household_check_date() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION block_currency_selfwrite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION guard_owner_removal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION is_household_member(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION is_household_admin(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION create_household(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION join_household_by_code(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION leave_household(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION claim_task(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION complete_task(INTEGER) FROM PUBLIC, anon;
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
GRANT EXECUTE ON FUNCTION get_household_logs(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION log_activity(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_email_for_username(TEXT) TO anon, authenticated;

-- v2.2. When a member leaves or is removed, their taken tasks go back
-- to free so anyone else can take them. Completed work is untouched.
CREATE OR REPLACE FUNCTION release_tasks_on_leave()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.tasks SET status = 'free', owner = NULL
  WHERE household_id = OLD.household_id
    AND owner = OLD.profile_id
    AND status = 'taken';
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

REVOKE ALL ON FUNCTION release_tasks_on_leave() FROM PUBLIC, anon, authenticated;
