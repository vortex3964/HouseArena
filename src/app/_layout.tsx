import { useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  Drawer,
  DrawerContentScrollView,
  DrawerItem,
  DrawerItemList,
  DrawerToggleButton,
  type DrawerContentComponentProps,
} from "expo-router/drawer";
import { router, useSegments } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { Routes } from "../global/constants";
import { TopBar } from "../components/top_bar";
import { ErrorBanner, PrimaryButton } from "../components/auth_ui";
import { AvatarImage } from "../components/AvatarImage";
import { AuthProvider, useAuth } from "../system/AuthProvider";
import { useAvatarUrl } from "../system/avatars";
import { queryClient } from "../system/db";
import { useLiveHousehold } from "../system/live";
import { setupNotificationHandler } from "../system/push";

const AUTH_ROUTES = ["login", "register"];
const SETUP_ROUTE = "household-setup";

function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    sessionUserId,
    initLoading,
    dataLoading,
    households,
    setupSkipped,
    dataError,
    bootError,
    retryBoot,
  } = useAuth();
  const segments = useSegments();
  const current = segments[segments.length - 1] as string | undefined;

  useEffect(() => {
    if (initLoading || dataLoading) return;
    const onAuthRoute = current && AUTH_ROUTES.includes(current);
    const onSetupRoute = current === SETUP_ROUTE;
    if (!sessionUserId && !onAuthRoute) router.replace(Routes.LOGIN);
    else if (sessionUserId && onAuthRoute) router.replace(Routes.HOME);
    // Logged in but homeless: force setup unless skipped this login.
    // Skipped when data failed to load, empty then means unknown.
    else if (
      sessionUserId &&
      households.length === 0 &&
      !setupSkipped &&
      !dataError &&
      !onSetupRoute &&
      !onAuthRoute
    )
      router.replace(Routes.HOUSEHOLD_SETUP);
    // Has a household but sits on setup: send home.
    else if (
      sessionUserId &&
      households.length > 0 &&
      onSetupRoute
    )
      router.replace(Routes.HOME);
  }, [sessionUserId, initLoading, dataLoading, households, setupSkipped, dataError, current]);

  // Wait for session data too, so protected screens never paint homeless.
  if (initLoading || (sessionUserId && dataLoading)) {
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
  // Boot failed instead of hanging: say so with a way back.
  // Built from auth_ui components only, so this card itself can't crash.
  if (bootError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.bgDeep,
          justifyContent: "center",
          padding: 32,
          gap: 14,
        }}
      >
        <ErrorBanner
          message={`Couldn't start the app. ${bootError}`}
        />
        <PrimaryButton title="Retry" onPress={retryBoot} />
      </View>
    );
  }
  return <>{children}</>;
}

function AppDrawer() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.round(width * 0.65);
  // App-wide live board: one channel for the active household, no UI.
  // Screens just read the TanStack cache through the board hooks.
  const { client, sessionUserId, activeHousehold } = useAuth();
  useLiveHousehold(
    client,
    sessionUserId,
    activeHousehold ? activeHousehold.household.id : null,
  );
  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: Colors.bgDeep }}
    >
      <Drawer
        drawerContent={(props) => <CustomDrawerContent {...props} />}
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
        {/* Hidden screens, reached via buttons not the list */}
        <Drawer.Screen
          name="settings"
          options={{
            drawerItemStyle: { display: "none" },
            title: "Settings",
          }}
        />
        <Drawer.Screen
          name="profile"
          options={{
            drawerItemStyle: { display: "none" },
            title: "Profile",
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}

// Drawer list plus pinned Logout and Settings buttons at the bottom.
function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { signOut, profile, client } = useAuth();
  const active = props.state.routeNames[props.state.index];
  const avatarUrl = useAvatarUrl(client, profile?.avatar_url ?? null);

  function openProfile() {
    props.navigation.closeDrawer();
    router.push(Routes.PROFILE);
  }

  async function onLogout() {
    props.navigation.closeDrawer();
    try {
      await signOut();
    } finally {
      router.replace(Routes.LOGIN);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.mantle }}>
      <Pressable
        onPress={openProfile}
        accessibilityLabel="Open profile"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: 12,
        }}
      >
        <AvatarImage uri={avatarUrl} size={56} />
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: Colors.text, fontSize: 17, fontWeight: "800" }}
            numberOfLines={1}
          >
            {profile?.username ?? "…"}
          </Text>
          <Text
            style={{ color: Colors.subtext0, fontSize: 13 }}
            numberOfLines={1}
          >
            {profile?.email ?? ""}
          </Text>
        </View>
      </Pressable>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={{
          backgroundColor: Colors.mantle,
          paddingTop: 12,
          paddingHorizontal: 8,
        }}
      >
        <DrawerItemList {...props} />
      </DrawerContentScrollView>
      <View
        style={{
          paddingHorizontal: 8,
          paddingBottom: 20,
          borderTopWidth: 1,
          borderTopColor: Colors.border,
          paddingTop: 8,
        }}
      >
        <DrawerItem
          label="Log out"
          activeTintColor={Colors.danger}
          inactiveTintColor={Colors.danger}
          labelStyle={{ fontSize: 15, fontWeight: "600", marginLeft: -4 }}
          style={{ borderRadius: 14, paddingHorizontal: 4 }}
          icon={({ color, size }) => (
            <Ionicons name="log-out" size={size} color={color} />
          )}
          onPress={onLogout}
        />
        <DrawerItem
          label="Settings"
          focused={active === "settings"}
          activeTintColor={Colors.primary}
          inactiveTintColor={Colors.subtext0}
          activeBackgroundColor={Colors.primarySoft}
          labelStyle={{ fontSize: 15, fontWeight: "600", marginLeft: -4 }}
          style={{ borderRadius: 14, paddingHorizontal: 4 }}
          icon={({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          )}
          onPress={() => {
            props.navigation.closeDrawer();
            router.push(Routes.SETTINGS);
          }}
        />
      </View>
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    setupNotificationHandler();
  }, []);
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
