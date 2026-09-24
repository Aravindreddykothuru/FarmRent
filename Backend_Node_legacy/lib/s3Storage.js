const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('./logger');

const bucketName = process.env.AWS_S3_BUCKET || 'farmrent-assets';
const s3Region = process.env.AWS_REGION || 'ap-south-1';

// Initialize S3 client.
// Supports both direct AWS S3 and any S3-compatible service (like Supabase S3 API)
let s3Client;

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const endpoint = process.env.AWS_S3_ENDPOINT; // For S3-compatible services like Supabase

// Where a browser fetches an uploaded file from, which is not always where the SDK writes it. Supabase accepts
// uploads at /storage/v1/s3 and serves them from /storage/v1/object/public/<bucket>; deriving the second from
// the first yields a URL that 404s for every visitor while the upload itself reports success — a listing whose
// photo is permanently broken, with nothing in the logs to say so. Stated outright rather than guessed at,
// because the rule differs per provider and getting it wrong is invisible from the server's side.
const publicBaseUrl = String(process.env.AWS_S3_PUBLIC_URL || '').replace(/\/+$/, '');

if (accessKeyId && secretAccessKey) {
    const s3Config = {
        region: s3Region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    };
    if (endpoint) {
        s3Config.endpoint = endpoint;
        s3Config.forcePathStyle = true; // Required for Supabase/MinIO
    }
    s3Client = new S3Client(s3Config);
    logger.info('[S3] Client successfully initialized', { bucket: bucketName, endpoint: endpoint || 'aws', publicBaseUrl: publicBaseUrl || '(derived)' });
} else if (process.env.NODE_ENV === 'production') {
    // Loud in production. Without storage, every upload below hands back an address on a domain that does not
    // exist, the caller stores it as though it were a photo, and the listing shows a broken image from then on.
    // This ran in production unnoticed precisely because the fallback announced itself at debug level.
    logger.error('[S3] No credentials — every upload will return a placeholder URL and photos will not display. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_ENDPOINT and AWS_S3_PUBLIC_URL.');
} else {
    logger.warn('[S3] Missing credentials. S3 client not initialized. Falling back to mock uploads.');
}

/**
 * Uploads a buffer directly to the S3 bucket.
 */
async function uploadToS3(key, buffer, contentType) {
    if (!s3Client) {
        // A warning, not a debug line: the caller is about to store this placeholder as though it were a photo.
        logger.warn('[S3] No storage configured — returning a placeholder URL that will not load', { key });
        return `https://mock-s3-storage.local/${bucketName}/${key}`;
    }

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    });

    await s3Client.send(command);

    if (publicBaseUrl) return `${publicBaseUrl}/${key}`;
    // Without one configured, the layouts the two supported cases happen to use. The S3-compatible branch holds
    // only where a provider serves files from the same address it accepts them at, which Supabase does not.
    if (endpoint) {
        return `${endpoint}/${bucketName}/${key}`;
    }
    return `https://${bucketName}.s3.${s3Region}.amazonaws.com/${key}`;
}

/**
 * Deletes an object from the S3 bucket.
 */
async function deleteFromS3(key) {
    if (!s3Client) {
        logger.debug('[S3] Mock delete triggered for key:', key);
        return;
    }

    const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
    });

    await s3Client.send(command);
}

/**
 * Generates a presigned PUT URL for client-side direct S3 uploads.
 */
async function getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
    if (!s3Client) {
        return `https://mock-s3-storage.local/upload-presign-mock?key=${key}`;
    }

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Generates a presigned GET URL for secure access to private files (e.g. KYC docs).
 */
async function getPresignedDownloadUrl(key, expiresIn = 3600) {
    if (!s3Client) {
        return `https://mock-s3-storage.local/download-presign-mock?key=${key}`;
    }

    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
    });

    return getSignedUrl(s3Client, command, { expiresIn });
}

module.exports = {
    uploadToS3,
    deleteFromS3,
    getPresignedUploadUrl,
    getPresignedDownloadUrl,
    bucketName,
};
