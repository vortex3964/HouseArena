CREATE TYPE task_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE task_status AS ENUM ('free', 'taken', 'completed');


-- Households that profiles belong to
-- only 1 will be allowed

CREATE TABLE households (
    id SERIAL PRIMARY KEY,
    name VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    check_date DATE
);

-- enforces the "only 1" rule above at the db level
CREATE UNIQUE INDEX one_household_only ON households ((true));


-- Profiles of the users

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(20) NOT NULL UNIQUE,
    avatar_url TEXT,
    household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
    points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    gems INTEGER NOT NULL DEFAULT 0 CHECK (gems >= 0),
    strikes INTEGER NOT NULL DEFAULT 0 CHECK (strikes >= 0 AND strikes <= 3),
    wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER PUBLICATION supabase_realtime ADD TABLE profiles;


-- TASKS
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(20) NOT NULL,
    description TEXT DEFAULT 'no description',
    difficulty task_difficulty NOT NULL DEFAULT 'easy',
    points INTEGER NOT NULL,
    status task_status NOT NULL DEFAULT 'free',
    household_id INTEGER REFERENCES households(id) ON DELETE CASCADE,
    owner UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),

    -- points band per difficulty: easy 100-130, medium 200-260, hard 300-400
    CONSTRAINT points_match_difficulty CHECK (
        (difficulty = 'easy'   AND points >= 100 AND points <= 130) OR
        (difficulty = 'medium' AND points >= 200 AND points <= 260) OR
        (difficulty = 'hard'   AND points >= 300 AND points <= 400)
    ),

    -- status and owner have to agree
    CONSTRAINT owner_matches_status CHECK (
        (status = 'free' AND owner IS NULL) OR
        (status = 'taken' AND owner IS NOT NULL) OR
        (status = 'completed' AND owner IS NOT NULL)
    )
);

ALTER PUBLICATION supabase_realtime ADD TABLE tasks;

-- TRIGGERS & FUNCTIONS

-- Set household.check_date to 7 days after creation
CREATE OR REPLACE FUNCTION set_household_check_date()
RETURNS TRIGGER AS $$
BEGIN
    NEW.check_date := (CURRENT_DATE + INTERVAL '7 days')::DATE;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_household_check_date
BEFORE INSERT ON households
FOR EACH ROW
EXECUTE FUNCTION set_household_check_date();


-- claim_task(task_id, user_id) atomic

CREATE OR REPLACE FUNCTION claim_task(p_task_id INTEGER, p_user_id UUID)
RETURNS tasks AS $$
DECLARE
    claimed tasks;
BEGIN
    UPDATE tasks
    SET status = 'taken',
        owner = p_user_id
    WHERE id = p_task_id
      AND status = 'free'
    RETURNING * INTO claimed;

    IF claimed IS NULL THEN
        RAISE EXCEPTION 'Task % is no longer available', p_task_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN claimed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


--  complete_task(task_id, user_id)
--  Marks a task completed and awards points (as one atomic function)

CREATE OR REPLACE FUNCTION complete_task(p_task_id INTEGER, p_user_id UUID)
RETURNS tasks AS $$
DECLARE
    completed tasks;
    awarded_points INTEGER;
BEGIN
    UPDATE tasks
    SET status = 'completed'
    WHERE id = p_task_id
      AND owner = p_user_id
      AND status = 'taken'
    RETURNING *, points INTO completed, awarded_points;

    IF completed IS NULL THEN
        RAISE EXCEPTION 'Task % cannot be completed by this user (not owned or not taken)', p_task_id
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE profiles
    SET points = points + awarded_points
    WHERE id = p_user_id;

    RETURN completed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Strike penalty trigger.
-- Fires whenever a profile's strikes column increases. Deducts 100
-- points per new strike; at 3 strikes, wipes points and gems entirely.

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

CREATE TRIGGER trg_apply_strike_penalty
BEFORE UPDATE OF strikes ON profiles
FOR EACH ROW
EXECUTE FUNCTION apply_strike_penalty();


-- Weekly strike decay (every week a user with a penalty loses one)

CREATE OR REPLACE FUNCTION decay_strikes()
RETURNS void AS $$
BEGIN
    UPDATE profiles
    SET strikes = GREATEST(strikes - 1, 0)
    WHERE strikes > 0;
END;
$$ LANGUAGE plpgsql;

-- Requires: CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Then schedule it (example: every Monday at 00:00 UTC):
-- SELECT cron.schedule('weekly-strike-decay', '0 0 * * 1', 'SELECT decay_strikes();');

-- Auto-create a profile row when a new auth.users row appears.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, split_part(NEW.email, '@', 1));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_handle_new_user
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION handle_new_user();


-- ROW LEVEL SECURITY
-- only 1 household exists so "same household" = "any authenticated user"

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
ON profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Tasks: viewable by any authenticated user

CREATE POLICY "Tasks are viewable by authenticated users"
ON tasks FOR SELECT
TO authenticated
USING (true);

-- Direct inserts of new tasks by authenticated users

CREATE POLICY "Authenticated users can create tasks"
ON tasks FOR INSERT
TO authenticated
WITH CHECK (true);

-- Households: viewable by authenticated users

CREATE POLICY "Households are viewable by authenticated users"
ON households FOR SELECT
TO authenticated
USING (true);

-- handle Avatars

-- one time insert, private bucket
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false);

-- any authenticated user can view any avatar
create policy "Avatars are viewable by authenticated users"
on storage.objects for select
to authenticated
using ( bucket_id = 'avatars' );

-- users can only upload their own avatar
create policy "Users can upload their own avatar"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );

-- users can only update/replace their own avatar
create policy "Users can update their own avatar"
on storage.objects for update
to authenticated
using ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );

-- users can delete their own avatar
create policy "Users can delete their own avatar"
on storage.objects for delete
to authenticated
using ( bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1] );
