import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Platform, Pressable, useWindowDimensions } from "react-native";
import { Drawer } from "expo-router/drawer";
import { useNavigation } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";

type WebDocument = {
  activeElement?: { blur?: () => void } | null;
  addEventListener?: (
    type: string,
    listener: (e: unknown) => void,
    options?: boolean,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (e: unknown) => void,
    options?: boolean,
  ) => void;
};

function getWebDocument(): WebDocument | undefined {
  if (Platform.OS !== "web") return undefined;
  return (globalThis as unknown as { document?: WebDocument }).document;
}

function blurWebFocus() {
  getWebDocument()?.activeElement?.blur?.();
}

function ThemedDrawerToggle() {
  const navigation = useNavigation() as unknown as {
    toggleDrawer?: () => void;
  };
  return (
    <Pressable
      onPress={() => {
        blurWebFocus(); // blur BEFORE the drawer opens
        navigation.toggleDrawer?.();
      }}
      hitSlop={12}
      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 }}
      accessibilityRole="button"
      accessibilityLabel="Show navigation menu"
    >
      <Ionicons name="menu" size={24} color={Colors.text} />
    </Pressable>
  );
}

export default function RootLayout() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.round(width * 0.65);

  useEffect(() => {
    const doc = getWebDocument();
    if (!doc?.addEventListener || !doc?.removeEventListener) return;
    const onClickCapture = (e: unknown) => {
      const target = (e as { target?: unknown }).target as
        { closest?: (selector: string) => unknown } | null | undefined;
      if (target?.closest?.('[aria-label="Close drawer"]')) {
        blurWebFocus();
      }
    };
    doc.addEventListener("click", onClickCapture, true);
    return () => doc.removeEventListener?.("click", onClickCapture, true);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.bgDeep }}>
      <Drawer
        screenListeners={{
          // Fires synchronously before the drawer closes on item press.
          drawerItemPress: () => blurWebFocus(),
        }}
        screenOptions={{
          drawerPosition: "left",
          drawerType: "front",
          swipeEnabled: true,
          swipeEdgeWidth: 60,
          overlayColor: "rgba(6, 6, 12, 0.6)",

          headerLeft: () => <ThemedDrawerToggle />,
          headerStyle: { backgroundColor: Colors.mantle },
          headerTintColor: Colors.text,
          headerTitleStyle: { color: Colors.text, fontWeight: "600" },
          headerShadowVisible: false,

          drawerStyle: {
            width: drawerWidth,
            backgroundColor: Colors.mantle,
            borderTopRightRadius: 24,
            borderBottomRightRadius: 24,
            borderRightWidth: 1,
            borderRightColor: Colors.border,
            overflow: "hidden",
          },
          drawerContentStyle: {
            backgroundColor: Colors.mantle,
            paddingTop: 12,
            paddingHorizontal: 8,
          },
          drawerActiveTintColor: Colors.primary,
          drawerInactiveTintColor: Colors.subtext0,
          drawerActiveBackgroundColor: Colors.primarySoft,
          drawerLabelStyle: { fontSize: 15, fontWeight: "600", marginLeft: -4 },
          drawerItemStyle: { borderRadius: 14, paddingHorizontal: 4 },
        }}
      >
        <Drawer.Screen
          name="index"
          options={{
            drawerLabel: "Home",
            title: "HouseArena",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}
