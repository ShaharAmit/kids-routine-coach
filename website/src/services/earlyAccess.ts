import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

type SubmitEarlyAccessLeadResponse = {
  status: 'created' | 'exists';
};

const submitEarlyAccessLeadCallable = httpsCallable<
  { email: string },
  SubmitEarlyAccessLeadResponse
>(functions, 'submitEarlyAccessLead');

export async function submitEarlyAccessLead(email: string): Promise<SubmitEarlyAccessLeadResponse> {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await submitEarlyAccessLeadCallable({ email: normalizedEmail });
  return result.data;
}