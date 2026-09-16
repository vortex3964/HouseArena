import { router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { Routes } from "../global/constants";
import { HouseholdForm } from "../components/household_form";

// Shown to logged-in users with zero households.
// Same three paths as the register household step.
export default function HouseholdSetup() {
  const { skipHouseholdSetup } = useAuth();

  // Enters the app without a household, asked again next login.
  function onSkip() {
    skipHouseholdSetup();
    router.replace(Routes.HOME);
  }

  return <HouseholdForm onSkip={onSkip} />;
}
