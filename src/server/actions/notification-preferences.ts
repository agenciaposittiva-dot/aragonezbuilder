"use server";

import * as prefs from "@/server/services/notification-preferences";
import { orgAction } from "./safe-action";

export const updateNotificationPreferencesAction = orgAction(
  prefs.notificationPrefsInput,
  prefs.updateNotificationPreferences,
  { refresh: false },
);

export const updateChatAlertsAction = orgAction(prefs.chatAlertsInput, prefs.updateChatAlertPrefs, { refresh: false });
