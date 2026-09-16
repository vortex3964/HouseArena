import { useCallback, useRef, useState } from "react";
import { getDevPrefill } from "../system/supabase";
import { Messages } from "../global/constants";
import { BackendConfigFields, BackendRecoveryButtons } from "./auth_ui";

// Serializes async actions: a second tap while one runs is ignored.
// The ref closes the race synchronously, the state drives spinners.
export function useBusyGuard() {
  const ref = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (ref.current) return undefined;
      ref.current = true;
      setBusy(true);
      try {
        return await fn();
      } finally {
        ref.current = false;
        setBusy(false);
      }
    },
    [],
  );
  return { busy, run };
}

// Backend credential state machine shared by login and register.
// Same fields, same validation, same show/hide rules on both screens.
export function useBackendForm(
  backendReady: boolean,
  configureBackend: (url: string, anonKey: string) => Promise<void>,
) {
  const [url, setUrl] = useState(() => getDevPrefill()?.url ?? "");
  const [anonKey, setAnonKey] = useState(() => getDevPrefill()?.anonKey ?? "");
  // True when the user taps "re-enter codes" after a failure.
  const [showBackend, setShowBackend] = useState(false);
  // True only after an auth call fails with a network-like error.
  const [backendDown, setBackendDown] = useState(false);
  const { busy, run } = useBusyGuard();

  // Fresh install shows the code fields, working devices hide them.
  const needsBackend = !backendReady || showBackend;

  // Saves codes and builds the client when needed. Skipped entirely
  // when a working backend is already saved. Returns false when a
  // double-tap lost the race, so callers can stop quietly.
  // Throws on empty or failing codes for the caller to display.
  const ensureBackend = useCallback(async (): Promise<boolean> => {
    let ran = false;
    await run(async () => {
      ran = true;
      if (!needsBackend) return;
      if (!url.trim() || !anonKey.trim())
        throw new Error(Messages.BACKEND_CODES_FIRST);
      await configureBackend(url, anonKey);
      setShowBackend(false);
      setBackendDown(false);
    });
    return ran;
  }, [needsBackend, run, url, anonKey, configureBackend]);

  return {
    url,
    setUrl,
    anonKey,
    setAnonKey,
    backendDown,
    setBackendDown,
    needsBackend,
    busy,
    ensureBackend,
    openBackend: () => setShowBackend(true),
    closeBackend: backendReady ? () => setShowBackend(false) : undefined,
  };
}

export type BackendForm = ReturnType<typeof useBackendForm>;

// The credential UI both auth screens share: code fields on first run,
// recovery buttons after a connection failure, nothing otherwise.
export function BackendGate({
  form,
  backendReady,
}: {
  form: BackendForm;
  backendReady: boolean;
}) {
  if (form.needsBackend) {
    return (
      <BackendConfigFields
        url={form.url}
        setUrl={form.setUrl}
        anonKey={form.anonKey}
        setAnonKey={form.setAnonKey}
        // Let the user back out if a backend was already saved.
        onCancel={form.closeBackend}
      />
    );
  }
  if (form.backendDown) {
    // Only after a connection failure: a way back in.
    return <BackendRecoveryButtons onReenter={form.openBackend} />;
  }
  return null;
}
