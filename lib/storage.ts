import { put, get, head } from '@vercel/blob';
import type { VotingPowerData } from './types';

const BLOB_NAME = 'voting-power-data.json';

/**
 * Stores voting power data in Vercel Blob Storage
 */
export async function storeVotingPowerData(data: VotingPowerData): Promise<void> {
  try {
    const blob = await put(BLOB_NAME, JSON.stringify(data), {
      access: 'public',
      contentType: 'application/json',
    });
    console.log('Data stored in blob:', blob.url);
  } catch (error) {
    console.error('Error storing data in blob storage:', error);
    throw error;
  }
}

/**
 * Retrieves voting power data from Vercel Blob Storage
 */
export async function getVotingPowerData(): Promise<VotingPowerData | null> {
  try {
    // Check if blob exists
    try {
      await head(BLOB_NAME);
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }

    const blob = await get(BLOB_NAME);
    if (!blob) {
      return null;
    }

    const text = await blob.text();
    return JSON.parse(text) as VotingPowerData;
  } catch (error) {
    console.error('Error retrieving data from blob storage:', error);
    return null;
  }
}

