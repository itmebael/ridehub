import supabase from './supabase';

export const REGISTER_ID_DOCUMENT_BUCKETS = [
  'tenant-verification',
  'id-documents',
  'tenant-documents',
];

export const REGISTER_PROFILE_IMAGE_BUCKETS = [
  'tenant-verification',
  'profile-images',
  'tenant-documents',
];

export const VEHICLE_ASSET_BUCKETS = [
  'vehicle-images',
  'tenant-verification',
  'profile-images',
];

interface UploadWithBucketFallbackParams {
  buckets: string[];
  path: string;
  file: File;
  cacheControl?: string;
  upsert?: boolean;
}

interface UploadWithBucketFallbackResult {
  bucket: string;
  path: string;
  publicUrl: string;
}

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown storage error';
};

const isBucketNotFoundError = (message: string) => message.toLowerCase().includes('bucket not found');

const isPolicyError = (message: string) => {
  const lowered = message.toLowerCase();
  return lowered.includes('row-level security') || lowered.includes('policy');
};

const isAuthError = (message: string) => {
  const lowered = message.toLowerCase();
  return lowered.includes('jwt') || lowered.includes('auth');
};

export const isAbsoluteUrl = (value: string) => /^https?:\/\//i.test(value);

export const resolveStoredPublicUrl = (pathOrUrl: string, bucket: string) => {
  if (!pathOrUrl || isAbsoluteUrl(pathOrUrl)) {
    return pathOrUrl;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(pathOrUrl);

  return publicUrl || pathOrUrl;
};

export const uploadFileWithBucketFallback = async ({
  buckets,
  path,
  file,
  cacheControl = '3600',
  upsert = false,
}: UploadWithBucketFallbackParams): Promise<UploadWithBucketFallbackResult> => {
  const uniqueBuckets = Array.from(new Set(buckets.filter(Boolean)));
  const failures: { bucket: string; message: string }[] = [];

  for (const bucket of uniqueBuckets) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl,
      upsert,
    });

    if (!error) {
      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(path);

      return {
        bucket,
        path,
        publicUrl: publicUrl || path,
      };
    }

    failures.push({
      bucket,
      message: getErrorMessage(error),
    });
  }

  const failureMessages = failures.map(({ bucket, message }) => `${bucket}: ${message}`);

  if (failures.length > 0 && failures.every(({ message }) => isBucketNotFoundError(message))) {
    throw new Error(
      `Storage bucket not found. Create at least one of these buckets in Supabase Storage: ${uniqueBuckets.join(', ')}.`
    );
  }

  const policyFailure = failures.find(({ message }) => isPolicyError(message));
  if (policyFailure) {
    throw new Error(
      `Storage access denied for ${policyFailure.bucket}. Check your Supabase Storage policies for: ${uniqueBuckets.join(', ')}.`
    );
  }

  const authFailure = failures.find(({ message }) => isAuthError(message));
  if (authFailure) {
    throw new Error('Authentication error while uploading files. Please log out and log back in, then try again.');
  }

  throw new Error(`Failed to upload file. Tried buckets: ${failureMessages.join(' | ')}`);
};
