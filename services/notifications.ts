import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { Routine } from '../types';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request push notification permissions from the OS.
 * Returns true if permissions were granted.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    console.warn('Push notifications only work on physical devices.');
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('Notification permission not granted.');
    return false;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('routine-reminders', {
      name: 'Routine Reminders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4A90D9',
      sound: null,
    });
  }

  return true;
}

/**
 * Schedule a daily recurring local notification for a routine.
 * Returns the notification identifier so it can be cancelled later.
 */
export async function scheduleRoutineNotification(routine: Routine): Promise<string> {
  // Cancel any existing notification for this routine
  if (routine.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(routine.notificationId).catch(() => {});
  }

  const [hourStr, minuteStr] = routine.scheduledTime.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: `⏰ Time for ${routine.childName}'s routine!`,
      body: `${routine.childName}, your morning routine is starting now. Tap to begin! 🚀`,
      data: {
        routineId: routine.id,
        url: `kidsroutine://routine/${routine.id}`,
      },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
    },
  });

  return notificationId;
}

/**
 * Cancel all scheduled notifications for a given notification ID.
 */
export async function cancelRoutineNotification(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}

/**
 * Get all currently scheduled notifications (for debugging/display).
 */
export async function getScheduledNotifications() {
  return Notifications.getAllScheduledNotificationsAsync();
}
