// Global test setup: everything runs locally, nothing touches hardware,
// the network, or a real Supabase project.

// AsyncStorage backed by a plain Map (the v3 package no longer ships
// the old jest mock path, so we keep our own tiny one).
const mockAsyncStorage = new Map();
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async (key) => (mockAsyncStorage.has(key) ? mockAsyncStorage.get(key) : null),
    setItem: async (key, value) => {
      mockAsyncStorage.set(key, String(value));
    },
    removeItem: async (key) => {
      mockAsyncStorage.delete(key);
    },
    mergeItem: async (key, value) => {
      const prev = mockAsyncStorage.has(key) ? JSON.parse(mockAsyncStorage.get(key)) : {};
      mockAsyncStorage.set(key, JSON.stringify({ ...prev, ...JSON.parse(value) }));
    },
    clear: async () => {
      mockAsyncStorage.clear();
    },
    getAllKeys: async () => [...mockAsyncStorage.keys()],
    multiGet: async (keys) => keys.map((k) => [k, mockAsyncStorage.has(k) ? mockAsyncStorage.get(k) : null]),
    multiSet: async (pairs) => {
      for (const [k, v] of pairs) mockAsyncStorage.set(k, String(v));
    },
    multiRemove: async (keys) => {
      for (const k of keys) mockAsyncStorage.delete(k);
    },
  },
}));

// SecureStore backed by a plain Map, cleared between tests through
// globalThis.__secureStore.
const mockSecureStore = new Map();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key) => (mockSecureStore.has(key) ? mockSecureStore.get(key) : null),
  setItemAsync: async (key, value) => {
    mockSecureStore.set(key, String(value));
  },
  deleteItemAsync: async (key) => {
    mockSecureStore.delete(key);
  },
}));
globalThis.__secureStore = mockSecureStore;

// Push stays off: no project id configured, permissions denied by default.
// Individual tests flip these stubs when they need the token path.
jest.mock("expo-constants", () => ({
  appOwnership: "standalone",
  expoConfig: {},
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  getExpoPushTokenAsync: jest.fn(async () => ({
    data: "ExponentPushToken[testtoken]",
  })),
  setNotificationHandler: jest.fn(),
}));

// Realtime client construction needs a WebSocket constructor on Node 20.
// The app never opens sockets in tests; this only satisfies construction.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = require("ws");
}

// No real network in tests, ever. Tests that need fetch install
// their own mock and prove the exact URL, headers, and body.
globalThis.fetch = async () => {
  throw new Error("network disabled in tests - mock fetch explicitly");
};
