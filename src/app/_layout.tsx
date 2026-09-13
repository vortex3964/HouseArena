import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useWindowDimensions } from "react-native";
import { Drawer, DrawerToggleButton } from "expo-router/drawer";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { TopBar } from "../components/top_bar";

export default function RootLayout() {
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
      </Drawer>
    </GestureHandlerRootView>
  );
}
