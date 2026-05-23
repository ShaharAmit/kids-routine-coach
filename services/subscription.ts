import AsyncStorage from '@react-native-async-storage/async-storage';

const PAID_STATUS_KEY = 'paid_status_v2';

export async function setPaidStatus(isPaid: boolean): Promise<void> {
  await AsyncStorage.setItem(PAID_STATUS_KEY, isPaid ? '1' : '0');
}

export async function getPaidStatus(): Promise<boolean> {
  // Temporary behavior until paywall integration:
  // always treat user as unpaid on app startup.
  return false;
}
