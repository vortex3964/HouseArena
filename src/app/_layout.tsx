import { useEffect } from "react";
import {
  ActivityIndicator,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Drawer, DrawerToggleButton } from "expo-router/drawer";
import { router, useSegments } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { TopBar } from "../components/top_bar";
import { AuthProvider, useAuth } from "../system/AuthProvider";
import { queryClient } from "../system/db";

const AUTH_ROUTES = ["login", "register"];
const SETUP_ROUTE = "household-setup";

function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    sessionUserId,
    initLoading,
    dataLoading,
    households,
    setupSkipped,
  } = useAuth();
  const segments = useSegments();
  const current = segments[segments.length - 1] as string | undefined;

  useEffect(() => {
    if (initLoading || dataLoading) return;
    const onAuthRoute = current && AUTH_ROUTES.includes(current);
    const onSetupRoute = current === SETUP_ROUTE;
    if (!sessionUserId && !onAuthRoute) router.replace("/login");
    else if (sessionUserId && onAuthRoute) router.replace("/");
    // Logged in but homeless: force setup unless skipped this login.
    else if (
      sessionUserId &&
      households.length === 0 &&
      !setupSkipped &&
      !onSetupRoute &&
      !onAuthRoute
    )
      router.replace("/household-setup");
    // Has a household but sits on setup: send home.
    else if (
      sessionUserId &&
      households.length > 0 &&
      onSetupRoute
    )
      router.replace("/");
  }, [sessionUserId, initLoading, dataLoading, households, setupSkipped, current]);

  if (initLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.bgDeep,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }
  return <>{children}</>;
}

function AppDrawer() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.round(width * 0.65);
  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: Colors.bgDeep }}
    >
      <Drawer
        screenOptions={{
          header: () => <TopBar />,

          drawerPosition: "left",
          drawerType: "front",
          swipeEnabled: true,
          swipeEdgeWidth: 60,
          overlayColor: "rgba(6, 6, 12, 0.6)",

          headerLeft: () => <DrawerToggleButton tintColor={Colors.text} />,
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
        <Drawer.Screen
          name="household"
          options={{
            drawerLabel: "Household",
            title: "Household",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="people" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="favourites"
          options={{
            drawerLabel: "Favourites",
            title: "Favourites",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="heart" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="leaderboard"
          options={{
            drawerLabel: "Leaderboard",
            title: "Leaderboard",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="trophy" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="stats"
          options={{
            drawerLabel: "Stats",
            title: "Stats",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="bar-chart" size={size} color={color} />
            ),
          }}
        />
        <Drawer.Screen
          name="logs"
          options={{
            drawerLabel: "Logs",
            title: "Logs",
            drawerIcon: ({ color, size }) => (
              <Ionicons name="list" size={size} color={color} />
            ),
          }}
        />

        {/* Auth routes hidden from the drawer */}
        <Drawer.Screen
          name="login"
          options={{
            drawerItemStyle: { display: "none" },
            headerShown: false,
            swipeEnabled: false,
          }}
        />
        <Drawer.Screen
          name="household-setup"
          options={{
            drawerItemStyle: { display: "none" },
            headerShown: false,
            swipeEnabled: false,
          }}
        />
        <Drawer.Screen
          name="register"
          options={{
            drawerItemStyle: { display: "none" },
            headerShown: false,
            swipeEnabled: false,
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <AppDrawer />
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
